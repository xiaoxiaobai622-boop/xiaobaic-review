let inMemoryAccessToken: string | null = null
let cachedRefreshToken: string | null = null

type TokenChangeListener = (tokens: { accessToken: string | null; refreshToken: string | null }) => void
const listeners = new Set<TokenChangeListener>()

// Use localStorage for PWA persistence (survives app close on iOS)
// sessionStorage would be cleared when iOS closes the PWA
const STORAGE_KEY = 'vitransfer_refresh_token'
const REFRESH_LOCK_KEY = 'vitransfer_auth_refresh_lock'
const REFRESH_LOCK_NAME = 'vitransfer-auth-refresh'
const REFRESH_LOCK_LEASE_MS = 20_000
const LAST_ACTIVITY_KEY = 'vitransfer_admin_last_activity'

function syncRefreshFromStorage(): string | null {
  if (typeof window === 'undefined') return null
  const stored = window.localStorage.getItem(STORAGE_KEY)
  cachedRefreshToken = stored
  return cachedRefreshToken
}

export function getAccessToken(): string | null {
  return inMemoryAccessToken
}

export function getRefreshToken(): string | null {
  return syncRefreshFromStorage()
}

type RefreshLockRecord = {
  owner: string
  expiresAt: number
}

function waitForRefreshLock(timeoutMs: number): Promise<void> {
  return new Promise(resolve => {
    const timeout = window.setTimeout(finish, timeoutMs)

    function finish() {
      window.clearTimeout(timeout)
      window.removeEventListener('storage', onStorage)
      resolve()
    }

    function onStorage(event: StorageEvent) {
      if (event.key === REFRESH_LOCK_KEY) finish()
    }

    window.addEventListener('storage', onStorage)
  })
}

async function withLocalStorageRefreshLock<T>(task: () => Promise<T>): Promise<T> {
  const owner = crypto.randomUUID?.() ?? `refresh-${Date.now()}-${Math.random().toString(36).slice(2)}`

  while (true) {
    const now = Date.now()
    let current: RefreshLockRecord | null = null

    try {
      const raw = window.localStorage.getItem(REFRESH_LOCK_KEY)
      current = raw ? JSON.parse(raw) as RefreshLockRecord : null
    } catch {
      current = null
    }

    if (!current || current.expiresAt <= now) {
      const candidate: RefreshLockRecord = { owner, expiresAt: now + REFRESH_LOCK_LEASE_MS }
      try {
        window.localStorage.setItem(REFRESH_LOCK_KEY, JSON.stringify(candidate))
      } catch {
        return task()
      }

      try {
        const claimed = JSON.parse(window.localStorage.getItem(REFRESH_LOCK_KEY) || 'null') as RefreshLockRecord | null
        if (claimed?.owner === owner) {
          try {
            return await task()
          } finally {
            const latest = JSON.parse(window.localStorage.getItem(REFRESH_LOCK_KEY) || 'null') as RefreshLockRecord | null
            if (latest?.owner === owner) window.localStorage.removeItem(REFRESH_LOCK_KEY)
          }
        }
      } catch {
        // Retry after a short wait if another tab won the race.
      }
    }

    const waitMs = Math.max(50, Math.min(1_000, (current?.expiresAt ?? now + 250) - now))
    await waitForRefreshLock(waitMs)
  }
}

export async function withAuthRefreshLock<T>(task: () => Promise<T>): Promise<T> {
  if (typeof window === 'undefined') return task()

  if (navigator.locks?.request) {
    return navigator.locks.request(REFRESH_LOCK_NAME, task)
  }

  return withLocalStorageRefreshLock(task)
}

export function setTokens(tokens: { accessToken: string; refreshToken: string }) {
  inMemoryAccessToken = tokens.accessToken
  cachedRefreshToken = tokens.refreshToken

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, tokens.refreshToken)
  }

  notifyListeners()
}

export function clearTokens() {
  inMemoryAccessToken = null
  cachedRefreshToken = null

  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(STORAGE_KEY)
    window.localStorage.removeItem(LAST_ACTIVITY_KEY)
  }

  notifyListeners()
}

export function subscribe(listener: TokenChangeListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notifyListeners() {
  const snapshot = { accessToken: inMemoryAccessToken, refreshToken: cachedRefreshToken }
  listeners.forEach(fn => fn(snapshot))
}
