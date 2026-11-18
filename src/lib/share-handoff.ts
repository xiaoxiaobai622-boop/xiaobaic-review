// 电脑微信的 UA 里同样带 `Windows NT` / `Macintosh`，所以桌面必须排在手机前面判，
// 否则在电脑微信里点开分享链接会被送进小程序。
const DESKTOP_USER_AGENT = /Windows NT|Macintosh|X11|Linux x86_64/i
const MOBILE_USER_AGENT = /iPhone|iPad|iPod|Android|Mobile|HarmonyOS/i
const WECHAT_USER_AGENT = /MicroMessenger/i

export function isDesktopUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false
  return DESKTOP_USER_AGENT.test(userAgent)
}

export function isMobileHandoffUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent || isDesktopUserAgent(userAgent)) return false
  return MOBILE_USER_AGENT.test(userAgent)
}

/** WeChat on a phone; desktop WeChat reports a desktop UA and stays on the website. */
export function isWechatMobileUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent || isDesktopUserAgent(userAgent)) return false
  return WECHAT_USER_AGENT.test(userAgent)
}

/** Avatars are stored as same-origin paths; the mini program needs an http(s) URL. */
export function toAbsoluteHttpUrl(value: string, baseUrl: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed, baseUrl || undefined)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
}

/** Empty fields are left out: the mini program falls back to its own brand/initial. */
export function buildMiniShareQuery(code: string, owner: string, avatar: string, date: string): string {
  const parts = [`code=${encodeURIComponent(code)}`]
  if (owner) parts.push(`owner=${encodeURIComponent(owner)}`)
  if (avatar) parts.push(`avatar=${encodeURIComponent(avatar)}`)
  if (date) parts.push(`date=${encodeURIComponent(date)}`)
  return parts.join('&')
}
