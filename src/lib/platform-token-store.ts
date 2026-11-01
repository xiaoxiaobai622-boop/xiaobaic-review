const ACCESS_KEY = 'vitransfer_platform_access_token'
const REFRESH_KEY = 'vitransfer_platform_refresh_token'

let pwaAccessToken: string | null = null

export function isPlatformPwaMode() {
  if (typeof window === 'undefined') return false
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    )
  } catch {
    return false
  }
}

export function setPlatformPwaAccessToken(token: string | null) {
  pwaAccessToken = token
}

export function getPlatformAccessToken() {
  if (typeof window === 'undefined') return null
  if (isPlatformPwaMode()) return pwaAccessToken
  return window.localStorage.getItem(ACCESS_KEY)
}

export function getPlatformRefreshToken() {
  if (typeof window === 'undefined') return null
  if (isPlatformPwaMode()) return null
  return window.localStorage.getItem(REFRESH_KEY)
}

export function setPlatformTokens(tokens: { accessToken: string; refreshToken?: string }) {
  if (typeof window === 'undefined') return
  if (isPlatformPwaMode()) {
    pwaAccessToken = tokens.accessToken
    window.localStorage.removeItem(ACCESS_KEY)
    window.localStorage.removeItem(REFRESH_KEY)
    return
  }
  window.localStorage.setItem(ACCESS_KEY, tokens.accessToken)
  if (tokens.refreshToken) window.localStorage.setItem(REFRESH_KEY, tokens.refreshToken)
}

export function clearPlatformTokens() {
  if (typeof window === 'undefined') return
  pwaAccessToken = null
  window.localStorage.removeItem(ACCESS_KEY)
  window.localStorage.removeItem(REFRESH_KEY)
}
