'use client'

import { useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useTranslations } from 'next-intl'
import ReviewPopup from '@/components/ReviewPopup'
import styles from '@/components/review-popup.module.css'

export type CommentSortMode = 'timecode' | 'newest' | 'unresolved'

interface CommentSortMenuProps {
  value: CommentSortMode
  onChange: (value: CommentSortMode) => void
}

export default function CommentSortMenu({ value, onChange }: CommentSortMenuProps) {
  const t = useTranslations('videoUi')
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const id = useId()

  const labels: Record<CommentSortMode, string> = {
    timecode: t('sortTimecode'),
    newest: t('sortNewest'),
    unresolved: t('sortUnresolved'),
  }

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        data-review-popup-trigger
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={t('sort')}
        className={`${styles.trigger} inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-1.5 text-[11px] text-foreground hover:bg-accent`}
      >
        {labels[value]}
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>
      <ReviewPopup id={id} open={open} onOpenChange={setOpen} anchor={triggerRef} label={t('sort')} role="menu" side="bottom" align="end" width={168}>
        <p className={styles.heading}>{t('sort')}</p>
        {(Object.keys(labels) as CommentSortMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            role="menuitemradio"
            aria-checked={value === mode}
            onClick={() => { onChange(mode); setOpen(false) }}
            className={styles.item}
          >
            <span className="min-w-0 flex-1 truncate">{labels[mode]}</span>
            {value === mode && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}
          </button>
        ))}
      </ReviewPopup>
    </div>
  )
}
