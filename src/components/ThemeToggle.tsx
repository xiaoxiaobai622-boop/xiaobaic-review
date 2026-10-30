'use client'

import { Aperture, ChevronDown, Leaf, Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { applyThemeChoice, readThemeFromDom, type ThemeChoice } from '@/lib/theme'

interface ThemeToggleProps {
  className?: string
}

export default function ThemeToggle({ className, compact = false, row = false }: ThemeToggleProps & { compact?: boolean; row?: boolean }) {
  const t = useTranslations('controls')
  const [theme, setTheme] = useState<ThemeChoice>('light')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    setTheme(readThemeFromDom())

    const observer = new MutationObserver(() => setTheme(readThemeFromDom()))
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    })
    return () => observer.disconnect()
  }, [])

  const Icon = theme === 'mint' ? Leaf : theme === 'frame' ? Aperture : theme === 'dark' ? Moon : Sun
  const labels: Record<ThemeChoice, string> = {
    light: t('themeLight'),
    mint: t('themeMint'),
    frame: t('themeFrame'),
    dark: t('themeDark'),
  }

  if (row) {
    return (
      <label className={cn(
        'relative flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-xs font-medium text-foreground transition-colors hover:bg-foreground/10 focus-within:bg-foreground/10',
        className
      )} title={labels[theme]}>
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-left">{labels[theme]}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <select
          value={theme}
          onChange={(event) => {
            const next = event.target.value as ThemeChoice
            localStorage.setItem('theme', next)
            applyThemeChoice(next)
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label={t('toggleTheme')}
        >
          {(['light', 'mint', 'frame', 'dark'] as ThemeChoice[]).map((choice) => (
            <option key={choice} value={choice}>{labels[choice]}</option>
          ))}
        </select>
      </label>
    )
  }

  if (!mounted) {
    return (
      <button
        className={cn('inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background transition-colors hover:bg-accent', className)}
        aria-label={t('toggleTheme')}
      >
        <div className="h-[18px] w-[18px]" />
      </button>
    )
  }

  if (compact) {
    // 窄栏里它就是一枚图标：不带自己的底色和描边，否则在栏面上又框出一块方框。
    return (
      <label
        className={cn('relative inline-flex h-[44px] w-[44px] cursor-pointer items-center justify-center rounded-lg transition-colors', className)}
        title={labels[theme]}
      >
        <Icon className="h-[20px] w-[20px] shrink-0 text-foreground" aria-hidden="true" />
        <span className="sr-only">{labels[theme]}</span>
        <select
          value={theme}
          onChange={(event) => {
            const next = event.target.value as ThemeChoice
            localStorage.setItem('theme', next)
            applyThemeChoice(next)
          }}
          className="absolute inset-0 cursor-pointer opacity-0 outline-none"
          aria-label={t('toggleTheme')}
        >
          {(['light', 'mint', 'frame', 'dark'] as ThemeChoice[]).map((choice) => (
            <option key={choice} value={choice}>{labels[choice]}</option>
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
      <Icon className="h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />
      <span className="sr-only">{labels[theme]}</span>
      <select
        value={theme}
        onChange={(event) => {
          const next = event.target.value as ThemeChoice
          localStorage.setItem('theme', next)
          applyThemeChoice(next)
        }}
        className="max-w-28 cursor-pointer bg-transparent text-xs font-medium text-foreground outline-none"
        aria-label={t('toggleTheme')}
      >
        {(['light', 'mint', 'frame', 'dark'] as ThemeChoice[]).map((choice) => (
          <option key={choice} value={choice}>
            {labels[choice]}
          </option>
        ))}
      </select>
    </label>
  )
}
