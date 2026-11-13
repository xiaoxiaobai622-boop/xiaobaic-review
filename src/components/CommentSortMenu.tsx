'use client'

import { useId, useRef, useState } from 'react'
import { ArrowUpDown, Check, ChevronDown } from 'lucide-react'
import { useTranslations } from 'next-intl'
import ReviewPopup from '@/components/ReviewPopup'
import styles from '@/components/review-popup.module.css'

export type CommentSortMode = 'timecode' | 'newest' | 'unresolved'

interface CommentSortMenuProps {
  value: CommentSortMode
  onChange: (value: CommentSortMode) => void
  /** 审片页批注栏用图标触发；其他入口保持原来的文字下拉。 */
  variant?: 'label' | 'icon'
}

export default function CommentSortMenu({ value, onChange, variant = 'label' }: CommentSortMenuProps) {
  const t = useTranslations('videoUi')
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const id = useId()

  const labels: Record<CommentSortMode, string> = {
    timecode: t('sortTimecode'),
    newest: t('sortNewest'),
    unresolved: t('sortUnresolved'),
  }

  const isIcon = variant === 'icon'
  const ariaLabel = `${t('sort')}: ${labels[value]}`

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
        aria-label={ariaLabel}
        title={ariaLabel}
        className={isIcon
          ? 'inline-flex h-[28px] w-[28px] items-center justify-center rounded-[6px] text-muted-foreground outline-none transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring'
          : `${styles.trigger} inline-flex h-[28px] items-center gap-1 rounded-md border border-border bg-background px-2 text-[12px] text-foreground hover:bg-accent`}
      >
        {isIcon ? (
          <>
            <ArrowUpDown className="h-4 w-4" aria-hidden="true" />
            {value !== 'timecode' && (
              <span aria-hidden="true" className="absolute right-[5px] top-[5px] h-1.5 w-1.5 rounded-full bg-primary" />
            )}
          </>
        ) : (
          <>
            {labels[value]}
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </>
        )}
      </button>
      <ReviewPopup id={id} open={open} onOpenChange={setOpen} anchor={triggerRef} label={ariaLabel} role="menu" side="bottom" align="end" width={168}>
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
