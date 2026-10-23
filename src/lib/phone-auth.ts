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

function percentEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/\+/g, '%20')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~')
}

function aliyunSignature(params: Record<string, string>, accessKeySecret: string): string {
  const canonicalizedQuery = Object.keys(params)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join('&')
  const stringToSign = `POST&${percentEncode('/')}&${percentEncode(canonicalizedQuery)}`
  return crypto
    .createHmac('sha1', `${accessKeySecret}&`)
    .update(stringToSign)
    .digest('base64')
}

async function sendAliyunSms(
  phone: string,
  code: string,
  options?: { templateCode?: string; min?: number },
): Promise<void> {
  const accessKeyId = process.env.ALIYUN_SMS_ACCESS_KEY_ID
  const accessKeySecret = process.env.ALIYUN_SMS_ACCESS_KEY_SECRET
  // 短信服务（Dysmsapi）的签名与模板都在控制台维护；当前验证码模板
  // “逐帧审阅登录”（SMS_512480754）只声明了 code 一个变量。
  const signName = process.env.ALIYUN_SMS_SIGN_NAME
  const templateCode = options?.templateCode || process.env.ALIYUN_SMS_TEMPLATE_CODE
  const endpoint = process.env.ALIYUN_SMS_ENDPOINT || 'https://dysmsapi.aliyuncs.com'

  if (!accessKeyId || !accessKeySecret || !signName || !templateCode) {
    throw new Error('SMS_NOT_CONFIGURED')
  }

  const commonParams: Record<string, string> = {
    AccessKeyId: accessKeyId,
    Action: 'SendSms',
    Format: 'JSON',
    PhoneNumbers: phone,
    RegionId: 'cn-hangzhou',
    SignName: signName,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: '1.0',
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify({ code }),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: '2017-05-25',
  }

  const params: Record<string, string> = {
    ...commonParams,
    Signature: aliyunSignature(commonParams, accessKeySecret),
  }
  const query = Object.keys(params)
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join('&')

  const response = await fetch(`${endpoint}/?${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(10000),
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(`SMS_PROVIDER_ERROR_${response.status}: ${data?.Code || ''} ${data?.Message || ''}`.trim())
  }
  if (data?.Code !== 'OK') {
    throw new Error(`SMS_PROVIDER_ERROR_${data?.Code || 'UNKNOWN'}: ${data?.Message || ''}`.trim())
  }
}

export async function sendPhoneCode(
  phone: string,
  code: string,
  options?: { templateCode?: string; min?: number },
): Promise<void> {
  if (process.env.SMS_PROVIDER === 'aliyun') {
    await sendAliyunSms(phone, code, options)
    return
  }

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
      templateCode: options?.templateCode || null,
      min: options?.min ?? 5,
    }),
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) throw new Error(`SMS_PROVIDER_ERROR_${response.status}`)
}
