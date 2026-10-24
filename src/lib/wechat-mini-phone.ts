import { getWechatMiniAccessToken } from './wechat-mini-login'
import { logError } from './logging'
import { PHONE_REGEX } from './phone-auth'

interface PhoneInfo {
  phoneNumber?: string
  purePhoneNumber?: string
  countryCode?: string
}

interface PhoneResponse {
  errcode?: number
  errmsg?: string
  phone_info?: PhoneInfo
}

export class WechatPhoneError extends Error {
  constructor(public readonly code: string) {
    super(code)
    this.name = 'WechatPhoneError'
  }
}

async function requestPhoneNumber(accessToken: string, phoneCode: string): Promise<PhoneResponse> {
  const response = await fetch(
    `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: phoneCode }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    }
  )
  return (await response.json()) as PhoneResponse
}

export async function exchangeWechatPhoneCode(phoneCode: string): Promise<string> {
  const code = typeof phoneCode === 'string' ? phoneCode.trim() : ''
  if (!code) throw new WechatPhoneError('PHONE_CODE_MISSING')

  let lastError: PhoneResponse | null = null
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const accessToken = await getWechatMiniAccessToken(attempt > 0)
      const data = await requestPhoneNumber(accessToken, code)
      if (!data.errcode) {
        const info = data.phone_info || {}
        if (String(info.countryCode || '') !== '86') {
          throw new WechatPhoneError('PHONE_UNSUPPORTED_REGION')
        }
        const phone = String(info.purePhoneNumber || info.phoneNumber || '')
          .replace(/^\+?86/, '')
          .replace(/[\s-]/g, '')
        if (!PHONE_REGEX.test(phone)) throw new WechatPhoneError('PHONE_INVALID')
        return phone
      }

      lastError = data
      if ((data.errcode === 40001 || data.errcode === 42001) && attempt === 0) continue
      break
    }
  } catch (error) {
    if (error instanceof WechatPhoneError) throw error
    logError('Wechat phone exchange exception:', error)
    throw new WechatPhoneError('PHONE_EXCHANGE_FAILED')
  }

  logError('Wechat phone exchange failed:', lastError?.errmsg || lastError?.errcode)
  if (lastError?.errcode === 40029) throw new WechatPhoneError('PHONE_CODE_INVALID')
  throw new WechatPhoneError('PHONE_EXCHANGE_FAILED')
}
