'use client'

import { Aperture, Check, ChevronDown, Leaf, Moon, Sun } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { applyThemeChoice, readThemeFromDom, type ThemeChoice } from '@/lib/theme'
import ReviewPopup from './ReviewPopup'
import popupStyles from './review-popup.module.css'

interface ThemeToggleProps {
  className?: string
}

export default function ThemeToggle({ className, compact = false, row = false }: ThemeToggleProps & { compact?: boolean; row?: boolean }) {
  const t = useTranslations('controls')
  const [theme, setTheme] = useState<ThemeChoice>('light')
  const [mounted, setMounted] = useState(false)
  const [compactOpen, setCompactOpen] = useState(false)
  const compactTriggerRef = useRef<HTMLButtonElement>(null)
  const compactMenuId = useId()

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

  const chooseTheme = (next: ThemeChoice) => {
    localStorage.setItem('theme', next)
    applyThemeChoice(next)
    setCompactOpen(false)
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
        className={cn(
          compact
            ? 'inline-flex h-[28px] w-[28px] items-center justify-center rounded-[6px] transition-colors hover:bg-accent'
            : 'inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background transition-colors hover:bg-accent',
          className
        )}
        aria-label={t('toggleTheme')}
      >
        <div className={compact ? 'h-[20px] w-[20px]' : 'h-[18px] w-[18px]'} />
      </button>
    )
  }

  if (compact) {
    // 顶栏图标态：无底色/描边，和语言、视图切换保持同一枚 28px 点击区。
    const ThemeIcon = Icon
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
          aria-label={labels[theme]}
          title={labels[theme]}
          className={cn(
            'inline-flex h-[28px] w-[28px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
            className
          )}
        >
          <ThemeIcon className="h-[20px] w-[20px] shrink-0" aria-hidden="true" />
        </button>
        <ReviewPopup
          id={compactMenuId}
          open={compactOpen}
          onOpenChange={setCompactOpen}
          anchor={compactTriggerRef}
          label={t('toggleTheme')}
          role="menu"
          side="bottom"
          align="end"
          width={190}
        >
          <p className={popupStyles.heading}>{t('toggleTheme')}</p>
          {(['light', 'mint', 'frame', 'dark'] as ThemeChoice[]).map((choice) => {
            const ChoiceIcon = choice === 'mint' ? Leaf : choice === 'frame' ? Aperture : choice === 'dark' ? Moon : Sun
            return (
              <button
                key={choice}
                type="button"
                role="menuitemradio"
                aria-checked={theme === choice}
                onClick={() => chooseTheme(choice)}
                className={popupStyles.item}
              >
                <ChoiceIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{labels[choice]}</span>
                {theme === choice && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
              </button>
            )
          })}
        </ReviewPopup>
      </>
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
