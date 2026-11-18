import crypto from 'crypto'
import { getRedis } from './redis'
import { logError } from './logging'

const ACCESS_TOKEN_KEY = 'wechat:js-sdk:access_token:v1'
const JSAPI_TICKET_KEY = 'wechat:js-sdk:jsapi_ticket:v1'
// 微信给 7200 秒，留 200 秒余量，避免拿到一个刚好在签名路上过期的票据。
const CACHE_TTL_SECONDS = 7000
const INVALID_TOKEN_CODES = new Set([40001, 40014, 42001])

interface TokenResponse {
  access_token?: string
  expires_in?: number
  errcode?: number
  errmsg?: string
}

interface TicketResponse {
  errcode?: number
  errmsg?: string
  ticket?: string
  expires_in?: number
}

export function isWechatJsSdkConfigured(): boolean {
  return Boolean(process.env.WECHAT_WEB_APP_ID?.trim() && process.env.WECHAT_WEB_APP_SECRET?.trim())
}

function credentials() {
  return {
    appId: process.env.WECHAT_WEB_APP_ID!.trim(),
    secret: process.env.WECHAT_WEB_APP_SECRET!.trim(),
  }
}

async function fetchAccessToken(forceRefresh: boolean): Promise<string> {
  const redis = getRedis()
  if (!forceRefresh) {
    const cached = await redis.get(ACCESS_TOKEN_KEY)
    if (cached) return cached
  }

  const { appId, secret } = credentials()
  const params = new URLSearchParams({
    grant_type: 'client_credential',
    appid: appId,
    secret,
  })
  const response = await fetch(`https://api.weixin.qq.com/cgi-bin/token?${params.toString()}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  })
  const data = (await response.json().catch(() => null)) as TokenResponse | null
  if (!response.ok || !data?.access_token) {
    // 这里只记 errcode/errmsg；请求 URL 里带着 secret，绝不能整条打出去。
    logError('WeChat JS-SDK access_token failed:', data?.errmsg || data?.errcode || response.status)
    throw new Error('WeChat JS-SDK access_token failed')
  }

  await redis.set(ACCESS_TOKEN_KEY, data.access_token, 'EX', CACHE_TTL_SECONDS)
  return data.access_token
}

async function fetchJsapiTicket(forceRefresh: boolean): Promise<string> {
  const redis = getRedis()
  if (!forceRefresh) {
    const cached = await redis.get(JSAPI_TICKET_KEY)
    if (cached) return cached
  }

  if (forceRefresh) {
    await Promise.all([
      redis.del(ACCESS_TOKEN_KEY).catch(() => {}),
      redis.del(JSAPI_TICKET_KEY).catch(() => {}),
    ])
  }

  const accessToken = await fetchAccessToken(forceRefresh)
  const response = await fetch(
    `https://api.weixin.qq.com/cgi-bin/ticket/getticket?access_token=${encodeURIComponent(accessToken)}&type=jsapi`,
    { cache: 'no-store', signal: AbortSignal.timeout(10_000) },
  )
  const data = (await response.json().catch(() => null)) as TicketResponse | null

  if (response.ok && data?.errcode === 0 && data.ticket) {
    await redis.set(JSAPI_TICKET_KEY, data.ticket, 'EX', CACHE_TTL_SECONDS)
    return data.ticket
  }

  if (!forceRefresh && data && INVALID_TOKEN_CODES.has(data.errcode ?? -1)) {
    return fetchJsapiTicket(true)
  }

  logError('WeChat JS-SDK jsapi_ticket failed:', data?.errmsg || data?.errcode || response.status)
  throw new Error('WeChat JS-SDK jsapi_ticket failed')
}

export async function getWechatJsSdkConfig(url: string) {
  const ticket = await fetchJsapiTicket(false)
  const { appId } = credentials()
  const nonceStr = crypto.randomBytes(8).toString('hex')
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = crypto
    .createHash('sha1')
    .update(`jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url}`)
    .digest('hex')

  return { appId, timestamp, nonceStr, signature }
}
