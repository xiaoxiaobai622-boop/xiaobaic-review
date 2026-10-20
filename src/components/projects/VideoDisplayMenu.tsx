'use client'

import { useEffect, useRef, useState } from 'react'
import { Grid2X2, List, SlidersHorizontal } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useViewportClamp } from '@/hooks/useViewportClamp'
import type {
  VideoCardSize,
  VideoDisplayPrefs,
  VideoThumbAspect,
  VideoTitleLines,
} from '@/lib/video-view-prefs'

interface VideoDisplayMenuProps {
  value: VideoDisplayPrefs
  onChange: (value: VideoDisplayPrefs) => void
  viewMode: 'list' | 'grid'
  onViewModeChange: (value: 'list' | 'grid') => void
}

function Segment<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="inline-flex w-full overflow-hidden rounded-md border border-border bg-muted/30 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={option.value === value}
          className={`h-7 min-w-0 flex-1 rounded px-2 text-[12px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
            option.value === value
              ? 'bg-background text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export default function VideoDisplayMenu({
  value,
  onChange,
  viewMode,
  onViewModeChange,
}: VideoDisplayMenuProps) {
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

  const update = (patch: Partial<VideoDisplayPrefs>) => onChange({ ...value, ...patch })

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
        title={t('display')}
      >
        <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
        <span className="hidden sm:inline">{t('display')}</span>
      </Button>

      {open && (
        <div
          ref={popupRef}
          role="dialog"
          aria-label={t('display')}
          className="absolute right-0 top-full z-50 mt-1 w-[258px] max-w-[calc(100vw-1rem)] rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-elevation-lg"
        >
          <div className="space-y-3">
            <div>
              <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">{t('layout')}</p>
              <div className="inline-flex w-full overflow-hidden rounded-md border border-border bg-muted/30 p-0.5">
                <button
                  type="button"
                  onClick={() => onViewModeChange('grid')}
                  aria-pressed={viewMode === 'grid'}
                  className={`inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded text-[12px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                    viewMode === 'grid' ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Grid2X2 className="h-3.5 w-3.5" />{t('grid')}
                </button>
                <button
                  type="button"
                  onClick={() => onViewModeChange('list')}
                  aria-pressed={viewMode === 'list'}
                  className={`inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded text-[12px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                    viewMode === 'list' ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <List className="h-3.5 w-3.5" />{t('list')}
                </button>
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">{t('cardSize')}</p>
              <Segment<VideoCardSize>
                value={value.size}
                onChange={(size) => update({ size })}
                options={[
                  { value: 'sm', label: t('sizeSmall') },
                  { value: 'md', label: t('sizeMedium') },
                  { value: 'lg', label: t('sizeLarge') },
                ]}
              />
            </div>

            <div>
              <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">{t('thumbAspect')}</p>
              <Segment<VideoThumbAspect>
                value={value.aspect}
                onChange={(aspect) => update({ aspect })}
                options={[
                  { value: '16:9', label: '16:9' },
                  { value: '4:3', label: '4:3' },
                  { value: '1:1', label: '1:1' },
                ]}
              />
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border/70 pt-3">
              <label htmlFor="video-display-show-info" className="text-[12px] font-medium">{t('showInfo')}</label>
              <Switch
                id="video-display-show-info"
                checked={value.showInfo}
                onCheckedChange={(showInfo) => update({ showInfo })}
              />
            </div>

            <div>
              <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">{t('titleLines')}</p>
              <Segment<VideoTitleLines>
                value={value.titleLines}
                onChange={(titleLines) => update({ titleLines })}
                options={[
                  { value: 1, label: t('oneLine') },
                  { value: 2, label: t('twoLines') },
                ]}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
