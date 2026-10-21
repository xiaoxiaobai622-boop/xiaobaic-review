'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ArrowRight, X } from 'lucide-react'
import { cn } from '@/lib/utils'

const DISMISS_KEY = 'vitransfer_beta_banner_dismissed_v2'

export default function ReviewBetaBanner({ className }: { className?: string }) {
  const t = useTranslations('share')
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === '1')
    } catch {}
  }, [])

  if (dismissed) return null

  const dismiss = () => {
    setDismissed(true)
    try {
      window.localStorage.setItem(DISMISS_KEY, '1')
    } catch {}
  }

  return (
    <div className={cn('relative shrink-0 border-b border-border bg-muted/60 px-3 py-[7px] pr-10 text-xs text-muted-foreground', className)}>
      <div className="flex min-w-0 items-center justify-center gap-2">
        <span className="min-w-0 truncate">{t('betaBannerText')}</span>
        <Link
          href="/news/beta"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 font-semibold text-foreground hover:text-primary"
        >
          {t('betaBannerLink')}
          <ArrowRight size={12} strokeWidth={2} />
        </Link>
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t('betaBannerDismiss')}
        title={t('betaBannerDismiss')}
      >
        <X size={14} strokeWidth={2} />
      </button>
    </div>
  )
}
