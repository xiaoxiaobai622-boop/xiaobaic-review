'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Check } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useViewportClamp } from '@/hooks/useViewportClamp'
import type { VideoSortField, VideoSortPrefs } from '@/lib/video-view-prefs'

interface VideoSortMenuProps {
  value: VideoSortPrefs
  onChange: (value: VideoSortPrefs) => void
}

const FIELDS: VideoSortField[] = ['updated', 'name', 'status', 'comments']

export default function VideoSortMenu({ value, onChange }: VideoSortMenuProps) {
  const t = useTranslations('videoUi')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  useViewportClamp(popupRef, open)

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

  const labelFor = (field: VideoSortField) => {
    if (field === 'updated') return t('sortUpdated')
    if (field === 'status') return t('sortStatus')
    if (field === 'comments') return t('sortComments')
    return t('sortName')
  }

  return (
    <div className="relative" ref={rootRef}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 px-2 text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t('sort')}
      >
        <ArrowUpDown className="mr-1.5 h-3.5 w-3.5" />
        <span className="hidden md:inline">{labelFor(value.field)}</span>
      </Button>

      {open && (
        <div
          ref={popupRef}
          role="dialog"
          aria-label={t('sort')}
          className="absolute right-0 top-full z-50 mt-1 w-[210px] max-w-[calc(100vw-1rem)] rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-elevation-lg"
        >
          <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground">{t('sort')}</p>
          {FIELDS.map((field) => (
            <button
              key={field}
              type="button"
              onClick={() => onChange({ ...value, field })}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] outline-none hover:bg-muted focus-visible:bg-accent"
            >
              <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                {value.field === field && <Check className="h-3.5 w-3.5 text-primary" />}
              </span>
              <span className="truncate">{labelFor(field)}</span>
            </button>
          ))}
          <div className="mt-1 flex items-center gap-1 border-t border-border/70 px-1 pt-2">
            <button
              type="button"
              onClick={() => onChange({ ...value, dir: 'asc' })}
              aria-pressed={value.dir === 'asc'}
              className={`inline-flex h-7 flex-1 items-center justify-center gap-1 rounded border text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                value.dir === 'asc' ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              <ArrowUp className="h-3 w-3" />{t('asc')}
            </button>
            <button
              type="button"
              onClick={() => onChange({ ...value, dir: 'desc' })}
              aria-pressed={value.dir === 'desc'}
              className={`inline-flex h-7 flex-1 items-center justify-center gap-1 rounded border text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                value.dir === 'desc' ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              <ArrowDown className="h-3 w-3" />{t('desc')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
