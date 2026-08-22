import { clearTokens, getAccessToken, getRefreshToken, setTokens, withAuthRefreshLock } from './token-store'
import { logError } from './logging'
import { getDeviceAuthHeaders } from './device-id'
import { getActiveTeamId } from './team-store'
import { getPlatformAccessToken } from './platform-token-store'

let isRedirecting = false
let refreshInFlight: Promise<boolean> | null = null

export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const requestInit = withAuthHeader(input, init)

  try {
    const response = await fetch(input, requestInit)

    // Reset redirect flag on successful responses so future 401s are handled
    if (response.ok) {
      isRedirecting = false
    }

    if (response.status === 401) {
      const refreshed = await attemptRefresh()
      if (refreshed) {
        const retryResponse = await fetch(input, withAuthHeader(input, init))
        if (retryResponse.status !== 401) {
          return retryResponse
        }
      }

      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const isSharePage = typeof window !== 'undefined' && window.location.pathname.startsWith('/share/')
      const isAuthEndpoint = url.includes('/api/auth')
      if (!isSharePage && !isAuthEndpoint && !isRedirecting) {
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
    throw new Error(details.length > 0 ? `${baseMessage}: ${details.join('; ')}` : baseMessage)
  }

  return response.json()
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

function withAuthHeader(input: RequestInfo | URL, init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers || {})
  // Only inject the stored admin token when no Authorization header was
  // explicitly provided.  Share-page uploads pass their own bearer token;
  // overwriting it with a stale admin token would break auth.
  if (!headers.has('Authorization')) {
    const isPlatformRequest =
      typeof input === 'string' && input.startsWith('/api/platform/')
    const token = isPlatformRequest ? getPlatformAccessToken() : getAccessToken()
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
  if (isRedirecting) return
  isRedirecting = true

  try {
    clearTokens()
    localStorage.removeItem('vitransfer_preferences')
    sessionStorage.clear()
  } catch (error) {
    // ignore
  }

  if (typeof window !== 'undefined') {
    window.location.href = '/login?sessionExpired=true'
  }
}
