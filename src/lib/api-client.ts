import { clearTokens, getAccessToken, getRefreshToken, setTokens, withAuthRefreshLock } from './token-store'
import { logError } from './logging'
import { getDeviceAuthHeaders } from './device-id'
import { getActiveTeamId } from './team-store'
import { getPlatformAccessToken } from './platform-token-store'

let redirectGuardUntil = 0
let refreshInFlight: Promise<boolean> | null = null

const REDIRECT_GUARD_MS = 5000

export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const requestInit = withAuthHeader(input, init)

  try {
    const response = await fetch(input, requestInit)

    if (response.status === 401) {
      const refreshed = await attemptRefresh()
      if (refreshed) {
        const retryResponse = await fetch(input, withAuthHeader(input, init))
        if (retryResponse.status !== 401) {
          return retryResponse
        }
      }

      let url: string
      if (typeof input === 'string') {
        url = input
      } else if (input instanceof URL) {
        url = input.href
      } else {
        url = input.url
      }

      const isSharePage = typeof window !== 'undefined' && window.location.pathname.startsWith('/share/')
      const isAuthEndpoint = url.includes('/api/auth')
      // A 401 on the platform console is not the team session expiring: kicking
      // to /login there logs people out of the studio for nothing, and
      // PlatformAuthProvider already owns the redirect to /platform/login.
      if (!isSharePage && !isAuthEndpoint && !isPlatformConsole()) {
        handleSessionExpired()
      }
    }

    return response
  } catch (error) {
    logError('[API] Request failed:', error)
    throw error
  }
}

async function apiJson<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T> {
  const response = await apiFetch(input, init)

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }))
    const baseMessage = error.error || `HTTP ${response.status}`
    const details = Array.isArray(error.details)
      ? error.details.filter((detail: unknown): detail is string => typeof detail === 'string' && detail.length > 0)
      : []
    throw new ApiError(details.length > 0 ? `${baseMessage}: ${details.join('; ')}` : baseMessage, typeof error.code === 'string' ? error.code : undefined)
  }

  return response.json()
}

/**
 * 非 2xx 的统一异常。`message` 的拼法与改动前逐字一致（`error.error` → `HTTP <status>`，
 * 有 `details` 时再拼 `: a; b`），所以只看 `error.message` 的既有调用方行为不变。
 * 多带一枚 `code` 是为了 F-3：服务端写闸门发的 `{ error, code }` 里那枚机器可读码过去在
 * 这一层被压成纯文本，四语界面拿不到它就只能把裸中文贴给客户看。
 */
export class ApiError extends Error {
  readonly code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

export async function apiPost<T = any>(
  url: string,
  data: any,
  init?: RequestInit
): Promise<T> {
  return apiJson<T>(url, {
    ...init,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    body: JSON.stringify(data),
  })
}

export async function apiPatch<T = any>(
  url: string,
  data: any,
  init?: RequestInit
): Promise<T> {
  return apiJson<T>(url, {
    ...init,
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    body: JSON.stringify(data),
  })
}

export async function apiDelete<T = any>(
  url: string,
  init?: RequestInit
): Promise<T> {
  return apiJson<T>(url, {
    ...init,
    method: 'DELETE',
    headers: {
      ...init?.headers,
    },
  })
}

function isPlatformConsole(): boolean {
  return typeof window !== 'undefined' && window.location.pathname.startsWith('/platform/')
}

function withAuthHeader(input: RequestInfo | URL, init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers || {})
  // Only inject the stored admin token when no Authorization header was
  // explicitly provided.  Share-page uploads pass their own bearer token;
  // overwriting it with a stale admin token would break auth.
  if (!headers.has('Authorization')) {
    const isPlatformRoute = typeof input === 'string' && input.startsWith('/api/platform/')
    // The platform console also calls platform-admin endpoints that live outside
    // /api/platform/ (/api/settings, /api/users, /api/security/*). Those must
    // carry the platform token, which is the only credential that page has.
    const token = isPlatformRoute || isPlatformConsole() ? getPlatformAccessToken() : getAccessToken()
    if (token) {
      headers.set('Authorization', `Bearer ${token}`)
    }
  }
  const teamId = getActiveTeamId()
  if (teamId) headers.set('X-Team-Id', teamId)
  return { ...init, headers }
}

export async function attemptRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    try {
      return await withAuthRefreshLock(async () => {
        // Read inside the cross-tab lock so a waiting tab uses the token most
        // recently rotated by the tab that refreshed before it.
        const refreshToken = getRefreshToken()
        if (!refreshToken) return false

        const response = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${refreshToken}`,
            ...getDeviceAuthHeaders(),
          },
        })

        if (!response.ok) {
          if (response.status === 401 && getRefreshToken() === refreshToken) clearTokens()
          return false
        }

        const data = await response.json()
        if (data?.tokens?.accessToken && data?.tokens?.refreshToken) {
          setTokens({
            accessToken: data.tokens.accessToken,
            refreshToken: data.tokens.refreshToken,
          })
          return true
        }

        return false
      })
    } catch (error) {
      logError('[API] Failed to refresh token:', error)
      return false
    } finally {
      refreshInFlight = null
    }
  })()

  return refreshInFlight
}

function handleSessionExpired() {
  // A time-boxed guard, not a "until the next successful response" latch: if the
  // hard navigation never completes, the console must still be able to surface a
  // later 401 instead of swallowing every request forever.
  const now = Date.now()
  if (now < redirectGuardUntil) return
  redirectGuardUntil = now + REDIRECT_GUARD_MS

  try {
    clearTokens()
    localStorage.removeItem('vitransfer_preferences')
    sessionStorage.clear()
  } catch {
    // ignore
  }

  if (typeof window !== 'undefined') {
    window.location.href = '/login?sessionExpired=true'
  }
}
