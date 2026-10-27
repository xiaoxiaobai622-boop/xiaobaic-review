'use client'

import { useEffect, useCallback } from 'react'
import { applyThemeChoice, readStoredTheme, resolveDefaultTheme } from '@/lib/theme'

/**
 * Applies the site-wide default theme when the visitor has not picked one.
 * Brand colors are owned by globals.css for every theme (light and dark are
 * fixed to Frame.io violet), so this no longer writes --primary/--ring/...
 */
export function AccentColorProvider() {
  const applyAppearanceSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/settings/theme')
      if (response.ok) {
        const data = await response.json()
        const defaultTheme = data.defaultTheme || 'auto'

        localStorage.setItem('adminDefaultTheme', defaultTheme)

        if (!readStoredTheme()) {
          applyThemeChoice(resolveDefaultTheme(defaultTheme))
        }
      }
    } catch {
      // Keep the pre-paint theme from THEME_BOOTSTRAP_SCRIPT.
    }
  }, [])

  useEffect(() => {
    // Clear inline brand overrides left by earlier builds; the stylesheet wins now.
    for (const name of ['--primary', '--ring', '--accent-foreground', '--primary-visible']) {
      document.documentElement.style.removeProperty(name)
    }

    applyAppearanceSettings()

    // While no explicit choice is stored, the OS preference keeps driving the app.
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleSystemChange = () => {
      if (!readStoredTheme()) {
        applyThemeChoice(resolveDefaultTheme(localStorage.getItem('adminDefaultTheme')))
      }
    }

    mediaQuery.addEventListener('change', handleSystemChange)
    return () => {
      mediaQuery.removeEventListener('change', handleSystemChange)
    }
  }, [applyAppearanceSettings])

  return null
}
