'use client'

import { Check, ChevronDown, Languages } from 'lucide-react'
import { useEffect, useState, useCallback, useId, useRef } from 'react'
import { cn } from '@/lib/utils'
import ReviewPopup from './ReviewPopup'
import popupStyles from './review-popup.module.css'

interface LocaleOption {
  code: string
  name: string
}

interface LanguageToggleProps {
  onChange?: (locale: string) => void
  className?: string
  row?: boolean
  compact?: boolean
}

export default function LanguageToggle({ onChange, className, row = false, compact = false }: LanguageToggleProps) {
  const [locale, setLocale] = useState<string>('en')
  const [availableLocales, setAvailableLocales] = useState<LocaleOption[]>([])
  const [mounted, setMounted] = useState(false)
  const [compactOpen, setCompactOpen] = useState(false)
  const compactTriggerRef = useRef<HTMLButtonElement>(null)
  const compactMenuId = useId()

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

  const activeLocaleName = availableLocales.find(option => option.code === locale)?.name || 'Language'

  if (compact) {
    return (
      <>
        <button
          ref={compactTriggerRef}
          type="button"
          data-review-popup-trigger
          onClick={() => setCompactOpen((open) => !open)}
          aria-haspopup="menu"
          aria-expanded={compactOpen}
          aria-controls={compactOpen ? compactMenuId : undefined}
          aria-label={activeLocaleName}
          title={activeLocaleName}
          className={cn(
            'inline-flex h-[28px] w-[28px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
            className
          )}
        >
          <Languages className="h-[20px] w-[20px] shrink-0" aria-hidden="true" />
        </button>
        <ReviewPopup
          id={compactMenuId}
          open={compactOpen}
          onOpenChange={setCompactOpen}
          anchor={compactTriggerRef}
          label={activeLocaleName}
          role="menu"
          side="bottom"
          align="end"
          width={180}
        >
          {availableLocales.map(option => (
            <button
              key={option.code}
              type="button"
              role="menuitemradio"
              aria-checked={locale === option.code}
              onClick={() => {
                changeLanguage(option.code)
                setCompactOpen(false)
              }}
              className={popupStyles.item}
            >
              <span className="min-w-0 flex-1 truncate">{option.name}</span>
              {locale === option.code && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
            </button>
          ))}
        </ReviewPopup>
      </>
    )
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
