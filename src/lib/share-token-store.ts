'use client'

import { ApiError, attemptRefresh } from './api-client'
import { getAccessToken } from './token-store'
import { SHARE_ERROR_CODES, SHARE_RENEWABLE_CODES } from './share-error-codes'

const PREFIX = 'share_token:'
const EXPIRY_SKEW_SECONDS = 5

type ShareTokenListener = (token: string | null) => void
const listeners = new Map<string, Set<ShareTokenListener>>()
const renewals = new Map<string, Promise<string | null>>()
const expiryNotices = new Set<string>()

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null

  try {
    // Base64url -> base64
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const json = atob(padded)
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

function preCheckShareToken(token: string): { valid: boolean; expired: boolean } {
  const payload = decodeJwtPayload(token)
  if (!payload) return { valid: false, expired: true }

  // Client-side precheck only; JWT signature is validated on the server.
  // Share tokens in this codebase are JWTs with type='share'.
  if (payload.type !== 'share') return { valid: false, expired: true }

  const exp = payload.exp
  if (typeof exp !== 'number') return { valid: false, expired: true }

  const nowSeconds = Math.floor(Date.now() / 1000)
  return {
    valid: true,
    expired: exp <= nowSeconds + EXPIRY_SKEW_SECONDS,
  }
}

function emit(slug: string, token: string | null): void {
  listeners.get(slug)?.forEach((listener) => {
    try {
      listener(token)
    } catch {
      // A broken subscriber must not break the request path.
    }
  })
}

export function readShareTokenRaw(slug: string): string | null {
  if (!slug) return null
  try {
    return sessionStorage.getItem(PREFIX + slug)
  } catch {
    return null
  }
}

export function loadShareToken(slug: string): string | null {
  if (!slug) return null
  try {
    const key = PREFIX + slug
    const token = sessionStorage.getItem(key)
    if (!token) return null

    // Malformed tokens cannot be renewed; an expired one can, so it is kept
    // and handed to the renewal path instead of being dropped on reload.
    const validation = preCheckShareToken(token)
    if (!validation.valid) {
      sessionStorage.removeItem(key)
      return null
    }

    return token
  } catch {
    return null
  }
}

export function saveShareToken(slug: string, token: string | null) {
  if (!slug) return
  try {
    const key = PREFIX + slug
    const previous = sessionStorage.getItem(key)
    if (token) {
      sessionStorage.setItem(key, token)
    } else {
      sessionStorage.removeItem(key)
    }
    if (previous !== token) emit(slug, token)
  } catch {
    // ignore storage failures
  }
}

/** Notify the page when a renewal or an explicit save rotated the bearer. */
export function subscribeShareToken(slug: string, listener: ShareTokenListener): () => void {
  if (!slug) return () => {}
  let bucket = listeners.get(slug)
  if (!bucket) {
    bucket = new Set()
    listeners.set(slug, bucket)
  }
  bucket.add(listener)
  return () => {
    bucket?.delete(listener)
    if (bucket?.size === 0) listeners.delete(slug)
  }
}

export function shareSlugFromToken(token: string | null | undefined): string | null {
  if (!token) return null
  const payload = decodeJwtPayload(token)
  return typeof payload?.shareId === 'string' ? payload.shareId : null
}

export function notifyShareSessionExpired(slug: string): void {
  if (!slug || expiryNotices.has(slug)) return
  expiryNotices.add(slug)
  window.setTimeout(() => expiryNotices.delete(slug), 5000)
  window.dispatchEvent(new CustomEvent('share-session-expired', { detail: { slug } }))
}

/**
 * Single-flight renewal per link. Every caller that saw the same dead bearer
 * waits on one request instead of stampeding the endpoint.
 */
export async function renewShareToken(slug: string, staleToken?: string | null): Promise<string | null> {
  if (!slug) return null
  const existing = renewals.get(slug)
  if (existing) return existing

  const token = staleToken || readShareTokenRaw(slug)
  if (!token) return null

  const request = (async () => {
    try {
      const response = await fetch(`/api/share/${encodeURIComponent(slug)}/renew`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'X-Share-Token': `Bearer ${token}` },
      })
      if (!response.ok) return null
      const data = await response.json().catch(() => null)
      const next = typeof data?.shareToken === 'string' ? data.shareToken : null
      if (next) saveShareToken(slug, next)
      return next
    } catch {
      return null
    } finally {
      renewals.delete(slug)
    }
  })()

  renewals.set(slug, request)
  return request
}

function shareTokenFromInit(init?: RequestInit): string | null {
  const headers = new Headers(init?.headers || {})
  const explicit = headers.get('X-Share-Token')
  if (explicit) {
    const [, value] = explicit.split(' ')
    if (value) return value.trim()
  }
  const authorization = headers.get('Authorization')
  if (authorization) {
    const [, value] = authorization.split(' ')
    if (value) {
      const payload = decodeJwtPayload(value.trim())
      if (payload?.type === 'share') return value.trim()
    }
  }
  return null
}

function isReplayableBody(body: BodyInit | null | undefined): boolean {
  return body === undefined || body === null || typeof body === 'string' ||
    body instanceof URLSearchParams || body instanceof Blob || body instanceof FormData
}

/**
 * Share-page fetch: attaches the current bearer, renews once on a dead one,
 * and replays the request with the replacement. The caller sees a normal
 * Response either way.
 *
 * Requests that also need the signed-in account (comments, uploads) opt into
 * `withAccountAuth`; the visitor bearer still travels in its own header.
 */
export interface ShareFetchOptions {
  withAccountAuth?: boolean
}

export async function shareFetch(
  slug: string,
  input: string,
  init?: RequestInit,
  options: ShareFetchOptions = {},
): Promise<Response> {
  const token = readShareTokenRaw(slug) || shareTokenFromInit(init)
  if (!token) return fetch(input, init)

  const headers = new Headers(init?.headers || {})
  headers.set('X-Share-Token', `Bearer ${token}`)
  const accountToken = options.withAccountAuth ? getAccessToken() : null
  if (accountToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${accountToken}`)
  }
  const requestInit: RequestInit = { ...init, headers }
  const response = await fetch(input, requestInit)

  if (response.status !== 401 || !isReplayableBody(requestInit.body)) return response

  const errorBody = await response.clone().json().catch(() => null)
  const code = typeof errorBody?.code === 'string' ? errorBody.code : null

  if (code && SHARE_RENEWABLE_CODES.has(code)) {
    const next = await renewShareToken(slug, token)
    if (!next) {
      notifyShareSessionExpired(slug)
      return response
    }

    const retryHeaders = new Headers(requestInit.headers)
    retryHeaders.set('X-Share-Token', `Bearer ${next}`)
    const retried = await fetch(input, { ...requestInit, headers: retryHeaders })
    if (retried.status !== 401) return retried

    const retryBody = await retried.clone().json().catch(() => null)
    const retryCode = typeof retryBody?.code === 'string' ? retryBody.code : null

    // The share session was renewed but the account session had also lapsed
    // (a reload leaves the access token empty). Refresh it once and replay.
    if (options.withAccountAuth &&
        (retryCode === SHARE_ERROR_CODES.LOGIN_REQUIRED || retryCode === SHARE_ERROR_CODES.AUTH_REQUIRED)) {
      if (await attemptRefresh()) {
        const accountRetryHeaders = new Headers(retryHeaders)
        const nextAccount = getAccessToken()
        if (nextAccount) accountRetryHeaders.set('Authorization', `Bearer ${nextAccount}`)
        return fetch(input, { ...requestInit, headers: accountRetryHeaders })
      }
    }

    if (!retryCode || SHARE_RENEWABLE_CODES.has(retryCode)) notifyShareSessionExpired(slug)
    return retried
  }

  // A share action that also needs the account session can outlive the
  // in-memory access token (a reload leaves it empty); refresh it once instead
  // of surfacing "please log in" to a visitor who is still signed in.
  if (options.withAccountAuth &&
      (code === SHARE_ERROR_CODES.LOGIN_REQUIRED || code === SHARE_ERROR_CODES.AUTH_REQUIRED || !code)) {
    if (await attemptRefresh()) {
      const retryHeaders = new Headers(requestInit.headers)
      const nextAccount = getAccessToken()
      if (nextAccount) retryHeaders.set('Authorization', `Bearer ${nextAccount}`)
      return fetch(input, { ...requestInit, headers: retryHeaders })
    }
  }

  return response
}

async function parseShareJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
    throw new ApiError(
      typeof error?.error === 'string' ? error.error : `HTTP ${response.status}`,
      typeof error?.code === 'string' ? error.code : undefined,
    )
  }
  return response.json()
}

export async function shareApiPost<T = any>(
  slug: string,
  url: string,
  data: unknown,
  init?: RequestInit,
): Promise<T> {
  const response = await shareFetch(slug, url, {
    ...init,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    body: JSON.stringify(data),
  }, { withAccountAuth: true })
  return parseShareJson<T>(response)
}

export async function shareApiDelete<T = any>(
  slug: string,
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await shareFetch(slug, url, { ...init, method: 'DELETE' }, { withAccountAuth: true })
  return parseShareJson<T>(response)
}
