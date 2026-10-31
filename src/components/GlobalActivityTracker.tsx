'use client'

import { useEffect, useRef } from 'react'
import { apiFetch } from '@/lib/api-client'
import { getRefreshToken } from '@/lib/token-store'

const LAST_ACTIVITY_KEY = 'vitransfer_admin_last_activity'
const WRITE_INTERVAL = 30 * 1000
const HEARTBEAT_INTERVAL = 5 * 60 * 1000

function writeNow() {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()))
}

function heartbeatEligible() {
  return typeof window !== 'undefined'
    && window.location.pathname.startsWith('/studio')
    && !!getRefreshToken()
}

export default function GlobalActivityTracker() {
  const lastHeartbeatRef = useRef(0)

  useEffect(() => {
    let lastWrite = 0

    const sendHeartbeat = () => {
      if (!heartbeatEligible()) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      const now = Date.now()
      if (now - lastHeartbeatRef.current < HEARTBEAT_INTERVAL) return
      lastHeartbeatRef.current = now
      // Server-side lastActiveAt is the only source of truth for team activity;
      // localStorage above is just the session-timeout clock.
      void apiFetch('/api/studio/heartbeat', { method: 'POST', cache: 'no-store' }).catch(() => {})
    }

    const recordActivity = () => {
      const now = Date.now()
      if (now - lastWrite >= WRITE_INTERVAL) {
        lastWrite = now
        writeNow()
      }
      sendHeartbeat()
    }

    writeNow()
    sendHeartbeat()

    const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click']
    activityEvents.forEach((event) => {
      document.addEventListener(event, recordActivity, { passive: true, capture: true })
    })
    window.addEventListener('focus', recordActivity)
    window.addEventListener('pageshow', recordActivity)
    document.addEventListener('visibilitychange', recordActivity)
    // A tab can stay open without input; still date the member at most once
    // per five minutes while it remains visible.
    const heartbeatTimer = window.setInterval(sendHeartbeat, HEARTBEAT_INTERVAL)

    return () => {
      activityEvents.forEach((event) => {
        document.removeEventListener(event, recordActivity, { capture: true } as any)
      })
      window.removeEventListener('focus', recordActivity)
      window.removeEventListener('pageshow', recordActivity)
      document.removeEventListener('visibilitychange', recordActivity)
      window.clearInterval(heartbeatTimer)
    }
  }, [])

  return null
}
