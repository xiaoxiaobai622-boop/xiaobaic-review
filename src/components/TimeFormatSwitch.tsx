'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check } from 'lucide-react'
import { useTimeFormat, selectTimeFormat } from '@/hooks/useTimeFormat'
import { TIME_FORMATS, formatTimeDisplay, type TimeFormat } from '@/lib/time-format'

/**
 * 播控条上那串时间，点开来选怎么显示：帧 / 标准 / 时间码。
 *
 * 抄的是对标那一枚——读数自己就是入口，不额外占一个图标位（那排已经挤着逐帧、音量、循环、
 * 全屏）。选一次整页跟着变：批注列表、时间轴悬停气泡、对比播放器读的是同一份本机偏好。
 *
 * 菜单朝上开：这一排在播放器底边，往下开就出画了。
 */
export default function TimeFormatSwitch({
  currentTime,
  duration,
  fps,
}: {
  currentTime: number
  duration: number
  fps: number | null
}) {
  const t = useTranslations('controls')
  const format = useTimeFormat()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const root = rootRef.current
    const handleMouseDown = (event: MouseEvent) => {
      if (root && !root.contains(event.target as Node)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      event.preventDefault()
      const items = menuRef.current
        ? Array.from(menuRef.current.querySelectorAll<HTMLElement>('[role="menuitemradio"]:not([disabled])'))
        : []
      if (items.length === 0) return
      const at = items.indexOf(document.activeElement as HTMLElement)
      const down = event.key === 'ArrowDown'
      const next = at === -1 ? (down ? 0 : items.length - 1) : (at + (down ? 1 : -1) + items.length) % items.length
      items[next].focus()
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const pick = (next: TimeFormat) => {
    selectTimeFormat(next)
    setOpen(false)
    triggerRef.current?.focus()
  }

  const label = t(`timeFormat_${format}` as 'timeFormat_FRAMES')

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        data-testid="time-format-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('timeFormatAria', { format: label })}
        title={t('timeFormatAria', { format: label })}
        className="mx-1 flex items-center rounded px-1.5 py-0.5 text-[13px] tabular-nums text-foreground outline-none transition-colors hover:bg-muted focus-visible:bg-muted"
      >
        <span>{formatTimeDisplay(currentTime, fps, duration, format)}</span>
        <span className="text-muted-foreground">&nbsp;/&nbsp;{formatTimeDisplay(duration, fps, duration, format)}</span>
      </button>

      {open && (
        <div
          ref={menuRef}
          data-testid="time-format-menu"
          role="menu"
          aria-label={t('timeFormat')}
          className="absolute bottom-[calc(100%+6px)] left-0 z-50 min-w-[148px] rounded-lg bg-popover p-1 shadow-elevation-lg"
        >
          <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium text-muted-foreground">{t('timeFormat')}</p>
          {TIME_FORMATS.map((item) => (
            <button
              key={item}
              type="button"
              data-time-format={item}
              role="menuitemradio"
              aria-checked={item === format}
              onClick={() => pick(item)}
              className="flex w-full items-center gap-2 rounded-[4px] px-3 py-1.5 text-left text-[13px] text-foreground outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
            >
              <span className="min-w-0 flex-1 truncate">{t(`timeFormat_${item}` as 'timeFormat_FRAMES')}</span>
              {item === format && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
