'use client'

import { useId, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Check } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import ReviewPopup from '@/components/ReviewPopup'
import styles from '@/components/review-popup.module.css'
import type { VideoSortField, VideoSortPrefs } from '@/lib/video-view-prefs'

interface VideoSortMenuProps {
  value: VideoSortPrefs
  onChange: (value: VideoSortPrefs) => void
}

const FIELDS: VideoSortField[] = ['updated', 'name', 'status', 'comments']

export default function VideoSortMenu({ value, onChange }: VideoSortMenuProps) {
  const t = useTranslations('videoUi')
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const id = useId()

  const labelFor = (field: VideoSortField) => {
    if (field === 'updated') return t('sortUpdated')
    if (field === 'status') return t('sortStatus')
    if (field === 'comments') return t('sortComments')
    return t('sortName')
  }

  return (
    <div className="relative">
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 px-2 text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title={t('sort')}
      >
        <ArrowUpDown className="mr-1.5 h-3.5 w-3.5" />
        <span className="hidden md:inline">{labelFor(value.field)}</span>
      </Button>

      <ReviewPopup id={id} open={open} onOpenChange={setOpen} anchor={triggerRef} label={t('sort')} side="bottom" align="end" width={210}>
        <p className={styles.heading}>{t('sort')}</p>
        {FIELDS.map((field) => (
          <button
            key={field}
            type="button"
            aria-pressed={value.field === field}
            onClick={() => onChange({ ...value, field })}
            className={styles.item}
          >
            <span className="min-w-0 flex-1 truncate">{labelFor(field)}</span>
            {value.field === field && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}
          </button>
        ))}
        <div className="mt-1 flex items-center gap-1 border-t border-border/70 px-1 pt-2">
          <button
            type="button"
            onClick={() => onChange({ ...value, dir: 'asc' })}
            aria-pressed={value.dir === 'asc'}
            className={`inline-flex h-7 flex-1 items-center justify-center gap-1 rounded border text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
              value.dir === 'asc' ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            <ArrowUp className="h-3 w-3" />{t('asc')}
          </button>
          <button
            type="button"
            onClick={() => onChange({ ...value, dir: 'desc' })}
            aria-pressed={value.dir === 'desc'}
            className={`inline-flex h-7 flex-1 items-center justify-center gap-1 rounded border text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
              value.dir === 'desc' ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            <ArrowDown className="h-3 w-3" />{t('desc')}
          </button>
        </div>
      </ReviewPopup>
    </div>
  )
}
