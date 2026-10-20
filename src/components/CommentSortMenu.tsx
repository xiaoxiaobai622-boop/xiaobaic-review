'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useTranslations } from 'next-intl'

export type CommentSortMode = 'timecode' | 'newest' | 'unresolved'

interface CommentSortMenuProps {
  value: CommentSortMode
  onChange: (value: CommentSortMode) => void
}

export default function CommentSortMenu({ value, onChange }: CommentSortMenuProps) {
  const t = useTranslations('videoUi')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const labels: Record<CommentSortMode, string> = {
    timecode: t('sortTimecode'),
    newest: t('sortNewest'),
    unresolved: t('sortUnresolved'),
  }

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('sort')}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-1.5 text-[11px] text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        {labels[value]}
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t('sort')}
          className="absolute right-0 top-full z-50 mt-1 w-36 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-elevation-lg"
        >
          {(Object.keys(labels) as CommentSortMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => { onChange(mode); setOpen(false) }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] outline-none hover:bg-accent focus-visible:bg-accent"
            >
              <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                {value === mode && <Check className="h-3.5 w-3.5 text-primary" />}
              </span>
              {labels[mode]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
