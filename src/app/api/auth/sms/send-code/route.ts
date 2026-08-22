import { NextRequest, NextResponse } from 'next/server'
import { randomInt } from 'crypto'
import { getRedis } from '@/lib/redis'
import { rateLimit } from '@/lib/rate-limit'
import { hashPhoneCode, phoneCodeKey, PHONE_CODE_TTL_SECONDS, PHONE_REGEX, sendPhoneCode } from '@/lib/phone-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : ''
  if (!PHONE_REGEX.test(phone)) {
    return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })
  }

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 3,
    message: 'Too many SMS requests',
  }, 'auth-sms-send', phone)
  if (limited) return limited

  const code = String(randomInt(100000, 1000000))
  const redis = getRedis()
  await redis.setex(phoneCodeKey(phone), PHONE_CODE_TTL_SECONDS, JSON.stringify({
    hash: hashPhoneCode(phone, code),
    attempts: 0,
  }))

  try {
    await sendPhoneCode(phone, code, {
      templateCode: process.env.ALIYUN_SMS_LOGIN_TEMPLATE_CODE || process.env.ALIYUN_SMS_TEMPLATE_CODE,
      min: 5,
    })
  } catch (error) {
    await redis.del(phoneCodeKey(phone))
    const message = error instanceof Error ? error.message : 'SMS_NOT_CONFIGURED'
    if (message === 'SMS_NOT_CONFIGURED') {
      return NextResponse.json({ error: '短信服务尚未配置，请联系管理员' }, { status: 503 })
    }
    const friendly = message.includes('FREQUENCY') || message.includes('frequency')
      ? '发送过于频繁，请稍后再试'
      : '验证码发送失败，请稍后再试'
    return NextResponse.json({ error: friendly }, { status: 502 })
  }

  return NextResponse.json({ success: true })
}
