import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getRedis } from '@/lib/redis'
import { getCurrentUserFromRequest, issueAdminTokens } from '@/lib/auth'
import { hashPassword } from '@/lib/encryption'
import { hashPhoneCode, phoneCodeKey, PHONE_REGEX } from '@/lib/phone-auth'
import { rateLimit } from '@/lib/rate-limit'
import { createPhoneOnlyEmail, normalizePhone, phoneHashField, phoneWhereOrNone, readPhone } from '@/lib/phone-field'
import { logWarn } from '@/lib/logging'
import { WECHAT_SESSION_COOKIE } from '@/lib/wechat-auth'

// 兜底比对只捞「没摘要」那批行，它们按定义就是回填的缺口本身（线上回填后为 0 行），
// 所以给一个够不着的上限，绝不让它退化成每次登录都解密全表。
const UNINDEXED_PHONE_SCAN_LIMIT = 500

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
  // 登录页的短信登录是「以这个号码登录」；只有显式 intent=bind 才是把号码绑到当前会话。
  // 登录页若沿用当前会话的语义，已登录用户换号登录会被当成绑定而 409。
  const intent = body?.intent === 'login' ? 'login' : 'bind'
  const currentUser = intent === 'bind' ? await getCurrentUserFromRequest(request) : null
  const existingPhoneUser = await prisma.user.findFirst({ where: phoneWhereOrNone(phone) })

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
      data: { phone, ...phoneHashField(phone) },
    })
  } else if (existingPhoneUser) {
    user = existingPhoneUser
  } else {
    // 摘要列没回填的老账号在上一行 findFirst 里查不到（加列的迁移不算 HMAC 值，10-13 线上就这么
    // 空着 19 行）。行业口径是「未注册的手机号验证通过即自动建号」，所以不能拦正在登录的人：
    // 改成只捞那批「没摘要」的行解密比一遍——命中就用老账号，并顺手把那行摘要补回去，同一个号
    // 第二次就不会再走这条兜底。
    const normalized = normalizePhone(phone)
    const unindexed = normalized
      ? await prisma.user.findMany({
        where: { phone: { not: null }, phoneHash: null },
        select: { id: true, phone: true },
        take: UNINDEXED_PHONE_SCAN_LIMIT,
      })
      : []
    const legacy = unindexed.find(row => normalizePhone(readPhone(row.phone ?? '')) === normalized)
    if (legacy) {
      user = await prisma.user.update({ where: { id: legacy.id }, data: phoneHashField(legacy.phone) })
    }
    if (!legacy && unindexed.length === UNINDEXED_PHONE_SCAN_LIMIT) {
      // 缺口大到扫不完，这趟仍可能建出重号——留一条运维日志，不把内部缺口说成用户的错误。
      logWarn('SMS 登录兜底比对扫满上限仍未命中：摘要列缺口可能超过上限', { limit: UNINDEXED_PHONE_SCAN_LIMIT })
    }
  }

  if (!user) {
    const email = createPhoneOnlyEmail(phone)
    isNewUser = true
    try {
      user = await prisma.user.create({
      data: {
        email,
        phone,
        ...phoneHashField(phone),
        password: await hashPassword(crypto.randomBytes(24).toString('hex')),
        role: 'MEMBER',
        projectAccessScope: 'ASSIGNED_ONLY',
        onboardingCompleted: false,
      },
      })
    } catch (error) {
      // 同一枚码被并发提交两次（自动重试、脚本、弱网连按）时，两趟都查不到号，后赢的那趟
      // 撞 phone / phoneHash 的唯一索引。撞了就用那个已经存在的账号继续登录，而不是把 500
      // 甩给正在登录的人；真的回查不到才照原样抛出去。
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error
      const raced = await prisma.user.findFirst({ where: phoneWhereOrNone(phone) })
      if (!raced) throw error
      user = raced
      isNewUser = false
    }
  }

  // 一次性码留到「这件事真的要做」之后才烧：前面任何一条岔路（码错、冲突）都不该把它消耗掉。
  await redis.del(key)

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

  const response = NextResponse.json({
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
  // 换号登录后旧微信会话不能再留在 cookie 里，否则只带 cookie 的接口仍按旧账号认人。
  if (intent === 'login') response.cookies.delete(WECHAT_SESSION_COOKIE)
  return response
}
