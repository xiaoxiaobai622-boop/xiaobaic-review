'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getAccessToken, getRefreshToken, clearTokens, subscribe } from '@/lib/token-store'
import { getDeviceAuthHeaders } from '@/lib/device-id'

const DEFAULT_INACTIVITY_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000
const CHECK_INTERVAL = 30 * 1000 // 30 seconds
const ACTIVITY_WRITE_INTERVAL = 30 * 1000
const LAST_ACTIVITY_KEY = 'vitransfer_admin_last_activity'

function readLastActivity(): number {
  if (typeof window === 'undefined') return Date.now()
  const parsed = Number(window.localStorage.getItem(LAST_ACTIVITY_KEY))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now()
}

export default function SessionMonitor() {
  const router = useRouter()
  const t = useTranslations('session')
  const [showWarning, setShowWarning] = useState(false)
  const [timeRemaining, setTimeRemaining] = useState(0)
  const lastActivityRef = useRef<number>(0)
  const lastActivityWriteRef = useRef<number>(0)
  const loggingOutRef = useRef(false)
  const inactivityTimeoutRef = useRef<number>(DEFAULT_INACTIVITY_TIMEOUT_MS)

  useEffect(() => {
    const stored = window.localStorage.getItem(LAST_ACTIVITY_KEY)
    const initialActivity = readLastActivity()
    lastActivityRef.current = initialActivity
    lastActivityWriteRef.current = initialActivity
    if (!stored) window.localStorage.setItem(LAST_ACTIVITY_KEY, String(initialActivity))
  }, [])

  useEffect(() => {
    let cancelled = false
    let loaded = false

    async function loadAdminTimeout(accessToken?: string | null) {
      const token = accessToken || getAccessToken()
      if (!token) return

      try {
        const response = await fetch('/api/settings/security', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })
        if (!response.ok) return

        const data = await response.json()
        const value = Number.parseInt(String(data?.adminSessionTimeoutValue ?? '7'), 10)
        const unit = String(data?.adminSessionTimeoutUnit ?? 'DAYS')
        if (!Number.isFinite(value) || value <= 0) return

        const seconds = unit === 'DAYS'
          ? value * 24 * 60 * 60
          : unit === 'HOURS'
            ? value * 60 * 60
            : unit === 'MINUTES'
              ? value * 60
              : null
        if (!seconds || seconds <= 0) return

        if (cancelled) return
        inactivityTimeoutRef.current = Math.min(seconds, 30 * 24 * 60 * 60) * 1000
        loaded = true
      } catch {
        // ignore and keep defaults
      }
    }

    loadAdminTimeout()
    const unsubscribe = subscribe(({ accessToken }) => {
      if (!loaded && accessToken) {
        loadAdminTimeout(accessToken)
      }
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const handleLogout = useCallback(async () => {
    if (loggingOutRef.current) return
    loggingOutRef.current = true
    const accessToken = getAccessToken()
    const refreshToken = getRefreshToken()
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(refreshToken ? { 'X-Refresh-Token': `Bearer ${refreshToken}` } : {}),
          ...getDeviceAuthHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken }),
      })
    } catch (error) {
      // ignore
    } finally {
      clearTokens()
      window.localStorage.removeItem(LAST_ACTIVITY_KEY)
      router.push('/login?sessionExpired=true')
    }
  }, [router])

  useEffect(() => {
    const onActivity = () => {
      const now = Date.now()
      const latestActivity = Math.max(lastActivityRef.current, readLastActivity())
      if (now - latestActivity >= inactivityTimeoutRef.current) {
        void handleLogout()
        return
      }

      lastActivityRef.current = now
      setShowWarning(false)
      if (now - lastActivityWriteRef.current >= ACTIVITY_WRITE_INTERVAL) {
        lastActivityWriteRef.current = now
        window.localStorage.setItem(LAST_ACTIVITY_KEY, String(now))
      }
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key !== LAST_ACTIVITY_KEY || !event.newValue) return
      const activity = Number(event.newValue)
      if (Number.isFinite(activity) && activity > lastActivityRef.current) {
        lastActivityRef.current = activity
        setShowWarning(false)
      }
    }

    const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click']
    activityEvents.forEach(event => {
      document.addEventListener(event, onActivity, { passive: true, capture: true })
    })
    window.addEventListener('storage', onStorage)

    const checkInactivity = () => {
      const sharedLastActivity = readLastActivity()
      lastActivityRef.current = Math.max(lastActivityRef.current, sharedLastActivity)
      const timeSinceActivity = Date.now() - lastActivityRef.current
      const timeUntilLogout = inactivityTimeoutRef.current - timeSinceActivity

      if (timeUntilLogout <= 0) {
        void handleLogout()
      } else if (timeUntilLogout <= 2 * 60 * 1000) {
        setShowWarning(true)
        setTimeRemaining(Math.ceil(timeUntilLogout / 1000))
      } else {
        setShowWarning(false)
      }
    }

    checkInactivity()
    const inactivityTimer = setInterval(checkInactivity, CHECK_INTERVAL)

    return () => {
      activityEvents.forEach(event => {
        document.removeEventListener(event, onActivity, { capture: true } as any)
      })
      window.removeEventListener('storage', onStorage)
      clearInterval(inactivityTimer)
    }
  }, [handleLogout])

  if (!showWarning) {
    return null
  }

  const minutes = Math.floor(timeRemaining / 60)
  const seconds = timeRemaining % 60

  return (
    <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-5">
      <div className="bg-warning-visible border-2 border-warning-visible rounded-lg shadow-lg p-4 max-w-sm">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <svg
              className="w-6 h-6 text-warning"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-warning">
              {t('inactivityWarning')}
            </h3>
            <p className="text-sm text-warning font-medium mt-1">
              {t('logoutCountdown', { time: `${minutes}:${seconds.toString().padStart(2, '0')}` })}
            </p>
            <p className="text-xs text-warning font-medium mt-2">
              {t('stayLoggedIn')}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
