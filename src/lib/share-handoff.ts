// 电脑微信的 UA 里同样带 `Windows NT` / `Macintosh`，所以桌面必须排在手机前面判，
// 否则在电脑微信里点开分享链接会被送进小程序。
const DESKTOP_USER_AGENT = /Windows NT|Macintosh|X11|Linux x86_64/i
const MOBILE_USER_AGENT = /iPhone|iPad|iPod|Android|Mobile|HarmonyOS/i

export function isDesktopUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false
  return DESKTOP_USER_AGENT.test(userAgent)
}

export function isMobileHandoffUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent || isDesktopUserAgent(userAgent)) return false
  return MOBILE_USER_AGENT.test(userAgent)
}
