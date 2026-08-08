import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getRedis } from '@/lib/redis'
import { rateLimit } from '@/lib/rate-limit'
import { hashPhoneCode, PHONE_REGEX, phoneCodeKey } from '@/lib/phone-auth'
import { signPortalSession } from '@/lib/portal-token'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const phone = typeof body.phone === 'string' ? body.phone.trim() : ''
  const code = typeof body.code === 'string' ? body.code.trim() : ''
  if (!PHONE_REGEX.test(phone) || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: '手机号或验证码格式不正确' }, { status: 400 })
  }
  const limited = await rateLimit(request, { windowMs: 15 * 60_000, maxRequests: 8, message: '尝试次数过多，请稍后再试' }, 'portal-phone-verify', phone)
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
    return NextResponse.json({ error: '验证码不正确' }, { status: 400 })
  }

  const recipient = await prisma.projectRecipient.findFirst({ where: { phone }, select: { id: true } })
  if (!recipient) return NextResponse.json({ error: '该手机号没有项目访问权限' }, { status: 403 })
  await redis.del(key)
  const session = await signPortalSession({ phone })
  return NextResponse.json({ token: session.token, expiresIn: session.ttlSeconds })
}
