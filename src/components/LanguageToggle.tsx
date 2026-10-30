'use client'

import { ChevronDown, Languages } from 'lucide-react'
import { useEffect, useState, useCallback } from 'react'
import { cn } from '@/lib/utils'

interface LocaleOption {
  code: string
  name: string
}

interface LanguageToggleProps {
  onChange?: (locale: string) => void
  className?: string
  row?: boolean
}

export default function LanguageToggle({ onChange, className, row = false }: LanguageToggleProps) {
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

  if (row) {
    return (
      <label className={cn(
        'relative flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-xs font-medium text-foreground transition-colors hover:bg-foreground/10 focus-within:bg-foreground/10',
        className
      )}>
        <Languages className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-left">{availableLocales.find(option => option.code === locale)?.name}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <select
          value={locale}
          onChange={(event) => changeLanguage(event.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
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

  return (
    <label className={cn(
      'flex h-9 items-center gap-2 rounded-md border border-border bg-background px-2 shadow-sm transition-colors hover:bg-accent',
      className
    )}>
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
