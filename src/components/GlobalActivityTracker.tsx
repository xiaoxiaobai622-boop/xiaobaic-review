'use client'

import { useEffect } from 'react'

const LAST_ACTIVITY_KEY = 'vitransfer_admin_last_activity'
const WRITE_INTERVAL = 30 * 1000

function writeNow() {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()))
}

export default function GlobalActivityTracker() {
  useEffect(() => {
    let lastWrite = 0

    const recordActivity = () => {
      const now = Date.now()
      if (now - lastWrite >= WRITE_INTERVAL) {
        lastWrite = now
        writeNow()
      }
    }

    writeNow()

    const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click']
    activityEvents.forEach((event) => {
      document.addEventListener(event, recordActivity, { passive: true, capture: true })
    })
    window.addEventListener('focus', recordActivity)
    window.addEventListener('pageshow', recordActivity)
    document.addEventListener('visibilitychange', recordActivity)

    return () => {
      activityEvents.forEach((event) => {
        document.removeEventListener(event, recordActivity, { capture: true } as any)
      })
      window.removeEventListener('focus', recordActivity)
      window.removeEventListener('pageshow', recordActivity)
      document.removeEventListener('visibilitychange', recordActivity)
    }
  }, [])

  return null
}
