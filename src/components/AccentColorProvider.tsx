'use client'

import { useEffect, useCallback } from 'react'
import { ACCENT_COLORS, AccentColorKey } from '@/components/settings/AppearanceSection'
import { hexToHslTriplet, isCustomAccentColor } from '@/lib/accent'
import { applyThemeChoice, readStoredTheme, resolveDefaultTheme } from '@/lib/theme'

/**
 * Applies the admin's appearance defaults: the accent color CSS variables, and
 * the site-wide theme when the visitor has not picked one themselves.
 * Settings are cached in localStorage so later loads settle without waiting on the API.
 * The pre-paint half of the theme lives in the root layout, which ships
 * THEME_BOOTSTRAP_SCRIPT before this component can even hydrate.
 */
export function AccentColorProvider() {
  const applyAppearanceSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/settings/theme')
      if (response.ok) {
        const data = await response.json()
        const colorKey = data.accentColor || 'blue'
        const defaultTheme = data.defaultTheme || 'auto'

        localStorage.setItem('adminAccentColor', colorKey)
        localStorage.setItem('adminDefaultTheme', defaultTheme)

        applyColorVariables(colorKey)

        if (!readStoredTheme()) {
          applyThemeChoice(resolveDefaultTheme(defaultTheme))
        }
      } else {
        // API failed, use cached value
        const cachedColor = localStorage.getItem('adminAccentColor')
        if (cachedColor) {
          applyColorVariables(cachedColor)
        }
      }
    } catch {
      // On error, try cached value
      const cachedColor = localStorage.getItem('adminAccentColor')
      if (cachedColor) {
        applyColorVariables(cachedColor)
      }
    }
  }, [])

  useEffect(() => {
    applyAppearanceSettings()

    // While no explicit choice is stored, the OS preference keeps driving the app.
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleSystemChange = () => {
      if (!readStoredTheme()) {
        applyThemeChoice(resolveDefaultTheme(localStorage.getItem('adminDefaultTheme')))
      }
    }

    mediaQuery.addEventListener('change', handleSystemChange)
    return () => mediaQuery.removeEventListener('change', handleSystemChange)
  }, [applyAppearanceSettings])

  const applyColorVariables = (colorKey: string) => {
    const preset = ACCENT_COLORS[colorKey as AccentColorKey]
    // A custom pick is painted verbatim in light and dark alike — the admin chose
    // that exact colour, so nothing re-tunes it behind their back. The settings
    // page reports the white-label contrast instead.
    const customTriplet = isCustomAccentColor(colorKey) ? hexToHslTriplet(colorKey) : null
    if (!preset && !customTriplet) return

    const root = document.documentElement

    const write = () => {
      // Mint paints its primary from globals.css; an inline style would outrank
      // that rule, so hand the properties back to the stylesheet while it is on.
      if (root.dataset.theme === 'mint') {
        for (const name of ['--primary', '--ring', '--accent-foreground', '--primary-visible']) {
          root.style.removeProperty(name)
        }
        return
      }

      const isDark = root.classList.contains('dark')
      const hslValue = customTriplet ?? (isDark ? preset?.dark : preset?.light)
      if (!hslValue) return
      const [h, s] = hslValue.split(' ')
      root.style.setProperty('--primary', hslValue)
      root.style.setProperty('--ring', hslValue)
      root.style.setProperty('--accent-foreground', hslValue)
      // Visible background is the same hue pushed to an extreme: a pale wash in
      // light mode, a deep tint in dark, so badges keep contrast against text.
      root.style.setProperty('--primary-visible', isDark ? `${h} ${s} 20%` : `${h} ${s} 95%`)
    }

    write()

    // Re-applies when the theme flips between light/dark, and when mint turns on
    // or off (which is only a data-theme change, not a class change).
    const observer = new MutationObserver(write)
    observer.observe(root, { attributes: true, attributeFilter: ['class', 'data-theme'] })
  }

  return null
}
