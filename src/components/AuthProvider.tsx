'use client'

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { apiFetch, attemptRefresh } from '@/lib/api-client'
import { clearTokens, getAccessToken, getRefreshToken } from '@/lib/token-store'
import { getDeviceAuthHeaders } from '@/lib/device-id'
import { useTranslations } from 'next-intl'
import { getActiveTeamId, setActiveTeamId } from '@/lib/team-store'

interface User {
  id: string
  email: string
  phone?: string | null
  name: string | null
  avatarUrl?: string | null
  onboardingCompleted?: boolean
  role: string
  projectAccessScope?: string
  teamRole?: 'OWNER' | 'ADMIN' | 'MEMBER'
  isPlatformAdmin?: boolean
  teams?: Array<{
    role: 'OWNER' | 'ADMIN' | 'MEMBER'
    team: {
      id: string
      name: string
      slug: string
      avatarUrl: string | null
      status?: string
      createdBy?: { id: string; name: string | null } | null
    }
  }>
}

interface AuthContextType {
  user: User | null
  loading: boolean
  login: () => void
  logout: () => Promise<void>
  isAuthenticated: boolean
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: () => {},
  logout: async () => {},
  isAuthenticated: false,
})

export function useAuth() {
  return useContext(AuthContext)
}

interface AuthProviderProps {
  children: ReactNode
  requireAuth?: boolean
}

export function AuthProvider({ children, requireAuth = false }: AuthProviderProps) {
  const t = useTranslations('common')
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const pathname = usePathname()

  const checkAuth = useCallback(async () => {
    try {
      const response = await apiFetch('/api/auth/session')
      if (response.ok) {
        const data = await response.json()
        if (data.authenticated && data.user) {
          const teams = Array.isArray(data.user.teams) ? data.user.teams : []
          const storedTeamId = getActiveTeamId()
          const activeTeam = teams.find((item: any) => item.team.id === storedTeamId)
          // Multiple teams with no saved choice must not fall back to the first
          // one: the selection gate below needs to see that the choice is missing.
          const resolvedTeam = activeTeam || (teams.length === 1 ? teams[0] : null)
          if (resolvedTeam?.team?.id) setActiveTeamId(resolvedTeam.team.id)
          const teamRole = resolvedTeam?.role
          setUser({
            ...data.user,
            teams,
            teamRole,
            isPlatformAdmin: Boolean(data.user.isPlatformAdmin),
            avatarUrl: data.user.avatarUrl,
            onboardingCompleted: data.user.onboardingCompleted !== false,
            role: teamRole === 'OWNER' ? 'ADMIN' : teamRole || 'MEMBER',
          })
          return
        }
      }
      // A 5xx from the session service is not a sign-out, and neither is a
      // transport failure. bootstrap re-runs on every navigation, so clearing
      // the identity here bounced active sessions back to /login on a blip.
      if (response.status >= 500) return
      setUser(null)
    } catch (error) {
      return
    } finally{
      setLoading(false)
    }
  }, [])

  const bootstrap = useCallback(async () => {
    setLoading(true)
    const refreshToken = getRefreshToken()
    const hasAccess = getAccessToken()

    if (!hasAccess && refreshToken) {
      await attemptRefresh()
    }

    await checkAuth()
  }, [checkAuth])

  useEffect(() => {
    bootstrap()
  }, [bootstrap, pathname])

  useEffect(() => {
    if (requireAuth && !loading && !user) {
      router.push(`/login?returnUrl=${encodeURIComponent(pathname || '/')}`)
    }
  }, [requireAuth, loading, user, pathname, router])

  useEffect(() => {
    if (!requireAuth || loading || !user || pathname === '/onboarding') return
    if (user.onboardingCompleted === false) {
      router.replace(`/onboarding?returnUrl=${encodeURIComponent(pathname || '/studio/projects')}`)
      return
    }
    if (pathname && pathname.startsWith('/studio') && !user.phone) {
      router.replace(`/profile?requirePhone=1&returnUrl=${encodeURIComponent(pathname || '/studio/projects')}`)
      return
    }
    // A user with no team should land on the create-team screen, not on a
    // team-scoped page whose API answers 403. The team landing, join and invite
    // routes must stay reachable so an invite can still add the first team.
    if (pathname?.startsWith('/studio') && (user.teams?.length ?? 0) === 0) {
      const canEnterTeamOnboarding = pathname === '/studio/team'
        || pathname === '/studio/team/'
        || pathname.startsWith('/studio/team/join')
        || pathname.startsWith('/studio/team/invite/')
        || pathname === '/studio/desktop'
      if (!canEnterTeamOnboarding) {
        router.replace('/studio/team')
        return
      }
    }
    if (pathname?.startsWith('/studio') && (user.teams?.length ?? 0) > 1) {
      const activeTeamId = getActiveTeamId()
      if (!user.teams!.some((item) => item.team.id === activeTeamId)) {
        const target = `${pathname}${typeof window !== 'undefined' ? window.location.search : ''}`
        router.replace(`/select-team?returnUrl=${encodeURIComponent(target)}`)
      }
    }
  }, [requireAuth, loading, user, pathname, router])

  const teams = user?.teams ?? []
  const hasActiveTeam = teams.some((item) => item.team.id === getActiveTeamId())
  const needsTeamSelection = Boolean(
    requireAuth &&
    user &&
    pathname?.startsWith('/studio') &&
    teams.length > 1 &&
    !hasActiveTeam
  )

  async function logout() {
    try {
      const refreshToken = getRefreshToken()
      const accessToken = getAccessToken()

      await fetch('/api/auth/logout', { 
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(refreshToken ? { 'X-Refresh-Token': `Bearer ${refreshToken}` } : {}),
          ...getDeviceAuthHeaders(),
        },
        body: JSON.stringify({ refreshToken }),
      })
    } catch (error) {
      // Continue with local logout even if API call fails
    }

    setUser(null)

    // Clear client-side storage (defense in depth)
    try {
      clearTokens()
      setActiveTeamId(null)
      localStorage.removeItem('vitransfer_preferences')
      sessionStorage.clear()
    } catch (storageError) {
      // Storage might not be available in some contexts
    }

    // Hard redirect to clear all React state and cached pages
    window.location.href = '/login'
  }

  function login() {
    router.push(`/login?returnUrl=${encodeURIComponent(pathname || '/')}`)
  }

  // SECURITY: Show loading state while checking auth OR when unauthenticated (before redirect)
  // This prevents content flash - NO content should render until auth is confirmed
  if (requireAuth && (loading || !user || needsTeamSelection)) {
    return (
      <div className="flex-1 min-h-0 bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">{t('loading')}</p>
        </div>
      </div>
    )
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
