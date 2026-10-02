'use client'

import { useEffect } from 'react'
import { logError, logMessage } from '@/lib/logging'

/**
 * ServiceWorkerProvider registers the service worker for PWA functionality.
 * Place this component in your layout to enable push notifications.
 */
export function ServiceWorkerProvider() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) {
      logMessage('[SW] Service workers not supported')
      return
    }

    let registration: ServiceWorkerRegistration | null = null
    let cancelled = false

    // Check for updates periodically
    const handleUpdateFound = () => {
      const newWorker = registration?.installing
      if (newWorker) {
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New service worker available
            logMessage('[SW] New service worker available')
          }
        })
      }
    }

    // Register service worker
    const registerServiceWorker = async () => {
      try {
        const result = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
        })

        // The layout can unmount while the registration is still in flight.
        if (cancelled) return

        registration = result
        logMessage('[SW] Service worker registered:', registration.scope)
        registration.addEventListener('updatefound', handleUpdateFound)
      } catch (error) {
        logError('[SW] Service worker registration failed:', error)
      }
    }

    const cleanup = () => {
      cancelled = true
      window.removeEventListener('load', registerServiceWorker)
      registration?.removeEventListener('updatefound', handleUpdateFound)
    }

    // Register on load
    if (document.readyState === 'complete') {
      registerServiceWorker()
      return cleanup
    }

    window.addEventListener('load', registerServiceWorker)
    return cleanup
  }, [])

  // This component doesn't render anything
  return null
}
