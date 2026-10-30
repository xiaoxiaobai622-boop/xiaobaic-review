'use client'

import { useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check } from 'lucide-react'
import { useTimeFormat, selectTimeFormat } from '@/hooks/useTimeFormat'
import { TIME_FORMATS, formatTimeDisplay, type TimeFormat } from '@/lib/time-format'
import ReviewPopup from './ReviewPopup'
import styles from './review-popup.module.css'

export default function TimeFormatSwitch({ currentTime, duration, fps }: { currentTime: number; duration: number; fps: number | null }) {
  const t = useTranslations('controls')
  const format = useTimeFormat()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const id = useId()
  const label = t(`timeFormat_${format}` as 'timeFormat_FRAMES')
  const pick = (next: TimeFormat) => {
    selectTimeFormat(next)
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        data-testid="time-format-trigger"
        data-review-popup-trigger
        onClick={() => setOpen(value => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={t('timeFormatAria', { format: label })}
        title={t('timeFormatAria', { format: label })}
        className={`${styles.trigger} mx-1 flex h-[28px] items-center rounded-md px-2 text-[13px] tabular-nums text-foreground transition-colors hover:bg-muted`}
      >
        <span>{formatTimeDisplay(currentTime, fps, duration, format)}</span>
        <span className="text-muted-foreground">&nbsp;/&nbsp;{formatTimeDisplay(duration, fps, duration, format)}</span>
      </button>
      <ReviewPopup id={id} open={open} onOpenChange={setOpen} anchor={triggerRef} label={t('timeFormat')} role="menu" width={194}>
        <p className={styles.heading}>{t('timeFormat')}</p>
        {TIME_FORMATS.map(item => (
          <button key={item} type="button" data-time-format={item} role="menuitemradio" aria-checked={item === format} onClick={() => pick(item)} className={styles.item}>
            <span className="min-w-0 flex-1 truncate">{t(`timeFormat_${item}` as 'timeFormat_FRAMES')}</span>
            {item === format && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}
          </button>
        ))}
      </ReviewPopup>
    </div>
  )
}
