'use client'

import { useEffect } from 'react'
import { safeReturnUrl } from '@/lib/return-url'

// Accounts are created with a default name and no registration step. Keep the
// old route as a redirect so a stale client cannot bring the form back.
export default function OnboardingRedirect() {
  useEffect(() => {
    const returnUrl = new URLSearchParams(window.location.search).get('returnUrl')
    window.location.replace(safeReturnUrl(returnUrl, '/studio/projects'))
  }, [])

  return null
}
