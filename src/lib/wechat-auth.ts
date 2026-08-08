import jwt from 'jsonwebtoken'

export const WECHAT_SESSION_COOKIE = 'vitransfer_wechat_session'
export const WECHAT_STATE_COOKIE = 'vitransfer_wechat_state'
export const WECHAT_RETURN_COOKIE = 'vitransfer_wechat_return'

export interface WechatSessionPayload extends jwt.JwtPayload {
  type: 'wechat_client'
  identityId: string
  nickname?: string
  avatarUrl?: string
}

const sessionSecret = process.env.SHARE_TOKEN_SECRET

export function isWechatWebConfigured(): boolean {
  return Boolean(process.env.WECHAT_WEB_APP_ID && process.env.WECHAT_WEB_APP_SECRET)
}

export function safeWechatReturnUrl(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/portal'
  return value
}

export function signWechatSession(identity: { id: string; nickname?: string | null; avatarUrl?: string | null }): string {
  if (!sessionSecret) throw new Error('SHARE_TOKEN_SECRET missing')
  return jwt.sign({
    type: 'wechat_client',
    identityId: identity.id,
    nickname: identity.nickname || undefined,
    avatarUrl: identity.avatarUrl || undefined,
  } satisfies Omit<WechatSessionPayload, keyof jwt.JwtPayload>, sessionSecret, {
    algorithm: 'HS256',
    expiresIn: '30d',
  })
}

export function verifyWechatSession(token: string): WechatSessionPayload | null {
  if (!sessionSecret) return null
  try {
    const payload = jwt.verify(token, sessionSecret, { algorithms: ['HS256'] }) as WechatSessionPayload
    return payload.type === 'wechat_client' && payload.identityId ? payload : null
  } catch {
    return null
  }
}
