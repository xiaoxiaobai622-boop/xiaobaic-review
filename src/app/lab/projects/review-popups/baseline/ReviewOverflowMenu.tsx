'use client'

import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useViewportClamp } from '@/hooks/useViewportClamp'

export default function ReviewOverflowMenu({ children }: { children: React.ReactNode }) {
  const t = useTranslations('videoUi')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  useViewportClamp(popupRef, open)

  const closeMenu = (restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      popupRef.current?.querySelector<HTMLElement>('button, [role="combobox"], select, input, a')?.focus()
    })
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) closeMenu(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      const sample = rootRef.current?.closest('[data-popup-sample]')
      if (sample && !sample.contains(event.target as Node)) return
      if (event.key === 'Escape') closeMenu()
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div className="relative" ref={rootRef}>
      <Button
        type="button"
        ref={triggerRef}
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t('more')}
        aria-label={t('more')}
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      {open && (
        <div
          ref={popupRef}
          role="dialog"
          aria-label={t('more')}
          className="absolute right-0 top-full z-50 mt-1 w-60 max-w-[calc(100vw-1rem)] space-y-1 rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-elevation-lg"
        >
          {children}
        </div>
      )}
    </div>
  )
}
