import crypto from 'crypto'

export const PHONE_REGEX = /^1[3-9]\d{9}$/
export const PHONE_CODE_TTL_SECONDS = 300

export function phoneCodeKey(phone: string): string {
  return `portal_phone_code:${phone}`
}

export function hashPhoneCode(phone: string, code: string): string {
  const secret = process.env.SHARE_TOKEN_SECRET
  if (!secret) throw new Error('SHARE_TOKEN_SECRET missing')
  return crypto.createHmac('sha256', secret).update(`${phone}:${code}`).digest('hex')
}

export async function sendPhoneCode(phone: string, code: string): Promise<void> {
  const url = process.env.SMS_WEBHOOK_URL
  if (!url) throw new Error('SMS_NOT_CONFIGURED')

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.SMS_WEBHOOK_TOKEN
        ? { Authorization: `Bearer ${process.env.SMS_WEBHOOK_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      phone,
      code,
      expiresInSeconds: PHONE_CODE_TTL_SECONDS,
      message: `您的登录验证码是 ${code}，5分钟内有效。请勿泄露给他人。`,
    }),
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) throw new Error(`SMS_PROVIDER_ERROR_${response.status}`)
}
