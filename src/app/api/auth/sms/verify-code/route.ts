import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getRedis } from '@/lib/redis'
import { getCurrentUserFromRequest, issueAdminTokens } from '@/lib/auth'
import { hashPassword } from '@/lib/encryption'
import { hashPhoneCode, phoneCodeKey, PHONE_REGEX } from '@/lib/phone-auth'
import { createPhoneOnlyEmail } from '@/lib/user-contact'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : ''
  const code = typeof body?.code === 'string' ? body.code.trim() : ''
  if (!PHONE_REGEX.test(phone) || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: '手机号或验证码格式不正确' }, { status: 400 })
  }

  const limited = await rateLimit(request, {
    windowMs: 15 * 60 * 1000,
    maxRequests: 8,
    message: '验证码尝试次数过多，请稍后再试',
  }, 'auth-sms-verify', phone)
  if (limited) return limited

  const redis = getRedis()
  const key = phoneCodeKey(phone)
  const raw = await redis.get(key)
  if (!raw) return NextResponse.json({ error: '验证码已过期，请重新获取' }, { status: 400 })
  const stored = JSON.parse(raw) as { hash: string; attempts: number }
  if (stored.attempts >= 5) {
    await redis.del(key)
    return NextResponse.json({ error: '验证码错误次数过多，请重新获取' }, { status: 400 })
  }
  const expected = Buffer.from(stored.hash, 'hex')
  const actual = Buffer.from(hashPhoneCode(phone, code), 'hex')
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    const ttl = await redis.ttl(key)
    await redis.setex(key, Math.max(ttl, 1), JSON.stringify({ ...stored, attempts: stored.attempts + 1 }))
    return NextResponse.json({ error: '验证码错误' }, { status: 400 })
  }
  await redis.del(key)

  const currentUser = await getCurrentUserFromRequest(request)
  const existingPhoneUser = await prisma.user.findUnique({ where: { phone } })

  let user
  let isNewUser = false
  if (currentUser) {
    if (existingPhoneUser && existingPhoneUser.id !== currentUser.id) {
      return NextResponse.json({
        error: 'This phone number is already bound to another account',
        code: 'PHONE_ACCOUNT_CONFLICT',
        conflictUserId: existingPhoneUser.id,
      }, { status: 409 })
    }
    user = await prisma.user.update({
      where: { id: currentUser.id },
      data: { phone },
    })
  } else if (existingPhoneUser) {
    user = existingPhoneUser
  } else {
    const email = createPhoneOnlyEmail(phone)
    isNewUser = true
    user = await prisma.user.create({
      data: {
        email,
        phone,
        password: await hashPassword(crypto.randomBytes(24).toString('hex')),
        role: 'MEMBER',
        projectAccessScope: 'ASSIGNED_ONLY',
        onboardingCompleted: false,
      },
    })
  }

  const tokens = await issueAdminTokens({
    id: user.id,
    email: user.email,
    phone: user.phone,
    name: user.name,
    avatarUrl: user.avatarUrl,
    onboardingCompleted: user.onboardingCompleted,
    role: user.role,
    projectAccessScope: user.projectAccessScope,
  })

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
      name: user.name,
      avatarUrl: user.avatarUrl,
      onboardingCompleted: user.onboardingCompleted,
      role: user.role,
    },
    isNewUser,
    needsOnboarding: user.onboardingCompleted === false,
    tokens,
  })
}
