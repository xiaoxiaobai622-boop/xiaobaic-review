import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getRedis } from '@/lib/redis'
import { rateLimit } from '@/lib/rate-limit'
import { hashPhoneCode, PHONE_CODE_TTL_SECONDS, PHONE_REGEX, phoneCodeKey, sendPhoneCode } from '@/lib/phone-auth'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const phone = typeof body.phone === 'string' ? body.phone.trim() : ''
  if (!PHONE_REGEX.test(phone)) return NextResponse.json({ error: '请输入正确的手机号' }, { status: 400 })
  const smsConfigured = process.env.SMS_PROVIDER === 'aliyun'
    ? Boolean(process.env.ALIYUN_SMS_ACCESS_KEY_ID && process.env.ALIYUN_SMS_SIGN_NAME && process.env.ALIYUN_SMS_TEMPLATE_CODE)
    : Boolean(process.env.SMS_WEBHOOK_URL)
  if (!smsConfigured) {
    return NextResponse.json({ error: '短信服务尚未配置，请联系管理员' }, { status: 503 })
  }

  const limited = await rateLimit(request, { windowMs: 60_000, maxRequests: 3, message: '发送过于频繁，请稍后再试' }, 'portal-phone-send', phone)
  if (limited) return limited

  try {
    const recipient = await prisma.projectRecipient.findFirst({ where: { phone }, select: { id: true } })
    if (recipient) {
      const code = String(crypto.randomInt(100000, 1000000))
      await sendPhoneCode(phone, code, {
        templateCode: process.env.ALIYUN_SMS_LOGIN_TEMPLATE_CODE || process.env.ALIYUN_SMS_TEMPLATE_CODE,
        min: 5,
      })
      await getRedis().setex(phoneCodeKey(phone), PHONE_CODE_TTL_SECONDS, JSON.stringify({ hash: hashPhoneCode(phone, code), attempts: 0 }))
    }
    return NextResponse.json({ success: true, message: '如果该手机号已有访问权限，验证码将发送到你的手机' })
  } catch (error) {
    logError('Failed to send portal phone code:', error)
    return NextResponse.json({ error: '验证码发送失败，请稍后再试' }, { status: 502 })
  }
}
