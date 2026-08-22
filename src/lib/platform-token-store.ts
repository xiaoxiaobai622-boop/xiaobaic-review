const ACCESS_KEY = 'vitransfer_platform_access_token'
const REFRESH_KEY = 'vitransfer_platform_refresh_token'

export function getPlatformAccessToken() {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(ACCESS_KEY)
}

export function getPlatformRefreshToken() {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(REFRESH_KEY)
}

export function setPlatformTokens(tokens: { accessToken: string; refreshToken: string }) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(ACCESS_KEY, tokens.accessToken)
  window.localStorage.setItem(REFRESH_KEY, tokens.refreshToken)
}

export function clearPlatformTokens() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(ACCESS_KEY)
  window.localStorage.removeItem(REFRESH_KEY)
}
