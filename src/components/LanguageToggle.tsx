'use client'

import { Languages } from 'lucide-react'
import { useEffect, useState, useCallback } from 'react'

interface LocaleOption {
  code: string
  name: string
}

interface LanguageToggleProps {
  onChange?: (locale: string) => void
}

export default function LanguageToggle({ onChange }: LanguageToggleProps) {
  const [locale, setLocale] = useState<string>('en')
  const [availableLocales, setAvailableLocales] = useState<LocaleOption[]>([])
  const [mounted, setMounted] = useState(false)

  const fetchLanguageSettings = useCallback(async (): Promise<{ defaultLanguage: string; locales: LocaleOption[] }> => {
    try {
      const response = await fetch('/api/settings/language')
      if (response.ok) {
        const data = await response.json()
        const locales: LocaleOption[] = data.availableLocales || []
        setAvailableLocales(locales)
        return { defaultLanguage: data.defaultLanguage || 'en', locales }
      }
    } catch {
      // Fallback
    }
    return { defaultLanguage: 'en', locales: [] }
  }, [])

  useEffect(() => {
    setMounted(true)

    async function init() {
      const { defaultLanguage, locales } = await fetchLanguageSettings()

      // Priority: localStorage > browser language > admin default
      const saved = localStorage.getItem('shareLanguage')
      if (saved) {
        setLocale(saved)
        onChange?.(saved)
        return
      }

      // Auto-detect from browser language
      const browserLang = navigator.language?.split('-')[0] || 'en'
      if (locales.some(l => l.code === browserLang)) {
        setLocale(browserLang)
        onChange?.(browserLang)
        return
      }

      // Fall back to admin default
      setLocale(defaultLanguage)
      onChange?.(defaultLanguage)
    }

    init()
  }, [fetchLanguageSettings, onChange])

  const changeLanguage = (nextLocale: string) => {
    setLocale(nextLocale)
    localStorage.setItem('shareLanguage', nextLocale)
    onChange?.(nextLocale)

    // Dispatch event for ShareLocaleProvider to pick up
    window.dispatchEvent(new CustomEvent('shareLocaleChange', { detail: nextLocale }))
  }

  // Don't render if only one locale available
  if (!mounted || availableLocales.length <= 1) {
    return null
  }

  return (
    <label className="flex h-9 items-center gap-2 rounded-md border border-border bg-background px-2 shadow-sm transition-colors hover:bg-accent">
      <Languages className="h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />
      <span className="sr-only">{availableLocales.find(option => option.code === locale)?.name}</span>
      <select
        value={locale}
        onChange={(event) => changeLanguage(event.target.value)}
        className="max-w-28 cursor-pointer bg-transparent text-xs font-medium text-foreground outline-none"
        aria-label={availableLocales.find(option => option.code === locale)?.name || 'Language'}
      >
        {availableLocales.map(option => (
          <option key={option.code} value={option.code}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  )
}
