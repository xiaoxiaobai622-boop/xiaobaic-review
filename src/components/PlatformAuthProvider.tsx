'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { clearPlatformTokens, getPlatformAccessToken, getPlatformRefreshToken, setPlatformTokens } from '@/lib/platform-token-store'

type PlatformUser = {
  id: string
  email: string
  name: string | null
  role: string
}

type PlatformAuthContextType = {
  user: PlatformUser | null
  loading: boolean
  logout: () => Promise<void>
}

const PlatformAuthContext = createContext<PlatformAuthContextType>({
  user: null,
  loading: true,
  logout: async () => {},
})

export function usePlatformAuth() {
  return useContext(PlatformAuthContext)
}

async function fetchSession() {
  const token = getPlatformAccessToken()
  const response = await fetch('/api/platform/auth/session', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!response.ok) return null
  const data = await response.json()
  return data.authenticated ? data.user : null
}

async function refreshPlatform() {
  const refreshToken = getPlatformRefreshToken()
  if (!refreshToken) return false
  const response = await fetch('/api/platform/auth/refresh', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${refreshToken}`,
    },
  })
  if (!response.ok) return false
  const data = await response.json()
  if (data.tokens) {
    setPlatformTokens(data.tokens)
    return true
  }
  return false
}

export function PlatformAuthProvider({
  children,
  requireAuth = false,
}: {
  children: ReactNode
  requireAuth?: boolean
}) {
  const [user, setUser] = useState<PlatformUser | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let sessionUser = await fetchSession()
      if (!sessionUser && getPlatformRefreshToken()) {
        await refreshPlatform()
        sessionUser = await fetchSession()
      }
      if (!cancelled) {
        setUser(sessionUser)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pathname])

  useEffect(() => {
    if (requireAuth && !loading && !user) {
      router.replace(`/platform/login?returnUrl=${encodeURIComponent(pathname || '/platform')}`)
    }
  }, [requireAuth, loading, user, pathname, router])

  const logout = async () => {
    const token = getPlatformAccessToken()
    try {
      await fetch('/api/platform/auth/logout', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
    } catch {}
    clearPlatformTokens()
    setUser(null)
    window.location.href = '/platform/login'
  }

  if (requireAuth && (loading || !user)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        正在加载平台控制台...
      </div>
    )
  }

  return (
    <PlatformAuthContext.Provider value={{ user, loading, logout }}>
      {children}
    </PlatformAuthContext.Provider>
  )
}
