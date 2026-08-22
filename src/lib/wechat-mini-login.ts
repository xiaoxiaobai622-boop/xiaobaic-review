import crypto from 'crypto'
import { getRedis } from './redis'
import { logError } from './logging'

export const WECHAT_QR_COOKIE = 'vitransfer_wechat_qr'
const WECHAT_ACCESS_TOKEN_KEY = 'wechat:mini:access_token'
const WECHAT_QR_KEY_PREFIX = 'wechat:mini:qr:'

interface WechatTokenResponse {
  access_token?: string
  expires_in?: number
  errcode?: number
  errmsg?: string
}

export function isWechatMiniConfigured(): boolean {
  return Boolean(process.env.WECHAT_MINI_APP_ID && process.env.WECHAT_MINI_APP_SECRET)
}

export function createWechatQrId(): string {
  return crypto.randomBytes(16).toString('hex')
}

export function getWechatQrKey(qrId: string): string {
  return `${WECHAT_QR_KEY_PREFIX}${qrId}`
}

export async function getWechatMiniAccessToken(forceRefresh = false): Promise<string> {
  const redis = getRedis()
  if (!forceRefresh) {
    const cached = await redis.get(WECHAT_ACCESS_TOKEN_KEY)
    if (cached) return cached
  }

  const response = await fetch('https://api.weixin.qq.com/cgi-bin/stable_token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credential',
      appid: process.env.WECHAT_MINI_APP_ID!,
      secret: process.env.WECHAT_MINI_APP_SECRET!,
      force_refresh: forceRefresh,
    }),
    cache: 'no-store',
  })
  const data = (await response.json()) as WechatTokenResponse
  if (!response.ok || !data.access_token) {
    if (!forceRefresh && (data.errcode === 40001 || data.errcode === 42001)) {
      await redis.del(WECHAT_ACCESS_TOKEN_KEY).catch(() => {})
      return getWechatMiniAccessToken(true)
    }
    logError('Wechat mini access_token failed:', data.errmsg || data.errcode)
    throw new Error('Wechat mini access_token failed')
  }

  const ttlSeconds = Math.max(300, Math.min(7100, (data.expires_in || 7200) - 300))
  await redis.set(WECHAT_ACCESS_TOKEN_KEY, data.access_token, 'EX', ttlSeconds)
  return data.access_token
}

export async function generateWechatMiniQrCode(scene: string, page: string): Promise<Buffer> {
  let lastError: string | null = null

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const accessToken = attempt === 0
      ? await getWechatMiniAccessToken()
      : await getWechatMiniAccessToken(true)
    const url = `https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(accessToken)}`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scene,
        page,
        check_path: false,
        env_version: 'release',
        width: 280,
      }),
      cache: 'no-store',
    })

    const contentType = response.headers.get('content-type') || ''
    const body = Buffer.from(await response.arrayBuffer())
    if (contentType.includes('image')) return body

    let detail = body.toString('utf8').slice(0, 300)
    try {
      detail = JSON.stringify(await response.json())
    } catch {
      // Keep the raw body for non-JSON errors.
    }

    lastError = detail
    if (attempt === 0 && /40001|42001/.test(detail)) {
      continue
    }
    break
  }

  logError('Wechat getwxacodeunlimit failed:', lastError || 'unknown error')
  throw new Error('Wechat mini program QR code generation failed')
}
