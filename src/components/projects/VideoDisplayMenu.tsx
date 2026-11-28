'use client'

import { useId, useRef, useState, type ReactNode } from 'react'
import {
  Grid2X2, List, RectangleHorizontal, RectangleVertical, Square,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Switch } from '@/components/ui/switch'
import ReviewPopup from '@/components/ReviewPopup'
import FrameioMenuSelect from './FrameioMenuSelect'
import toolbarStyles from './ProjectToolbar.module.css'
import type {
  VideoCardSize,
  VideoDisplayPrefs,
  VideoThumbAspect,
  VideoThumbFit,
  VideoTitleLines,
} from '@/lib/video-view-prefs'

interface VideoDisplayMenuProps {
  value: VideoDisplayPrefs
  onChange: (value: VideoDisplayPrefs) => void
  viewMode: 'list' | 'grid'
  onViewModeChange: (value: 'list' | 'grid') => void
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[36px] items-center justify-between gap-1 px-4 py-1.5">
      <span className="truncate text-[13px] font-[420] leading-5 text-[#181b29]">{label}</span>
      {children}
    </div>
  )
}

function ChoiceGroup({ children }: { children: ReactNode }) {
  return (
    <div className="inline-flex h-[24px] w-[124px] shrink-0 items-center gap-0 rounded-[6px] p-[2px]" style={{ background: '#e6e8f1cc' }}>
      {children}
    </div>
  )
}

const choiceClass = (active: boolean) =>
  `inline-flex h-[20px] flex-1 items-center justify-center rounded-[4px] px-1 text-[12px] font-[520] leading-5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
    active ? 'bg-[#5b53ff] text-white shadow-[0px_.16px_.81px_0px_#00000008,0px_.77px_3.18px_0px_#0000000a,0px_2px_10px_0px_#00000012]' : 'text-[#63677d] hover:text-[#181b29]'
  }`


export default function VideoDisplayMenu({
  value,
  onChange,
  viewMode,
  onViewModeChange,
}: VideoDisplayMenuProps) {
  const t = useTranslations('videoUi')
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const id = useId()

  const update = (patch: Partial<VideoDisplayPrefs>) => onChange({ ...value, ...patch })
  const aspectOptions: Array<{ value: VideoThumbAspect; label: string; icon: typeof Square }> = [
    { value: '16:9', label: '16:9', icon: RectangleHorizontal },
    { value: '1:1', label: '1:1', icon: Square },
    { value: '9:16', label: '9:16', icon: RectangleVertical },
  ]

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        className={toolbarStyles.menuButton}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={t('appearance')}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" focusable="false" aria-hidden="true">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M4 6.75C4 5.784 4.784 5 5.75 5h3.5c.966 0 1.75.784 1.75 1.75v10.505a1.75 1.75 0 0 1-1.75 1.75h-3.5A1.75 1.75 0 0 1 4 17.255V6.75Zm1.75-.25a.25.25 0 0 0-.25.25v10.505c0 .138.112.25.25.25h3.5a.25.25 0 0 0 .25-.25V6.75a.25.25 0 0 0-.25-.25h-3.5ZM13 17.25c0 .966.784 1.75 1.75 1.75h3.496a1.75 1.75 0 0 0 1.75-1.75v-1.5a1.75 1.75 0 0 0-1.75-1.75H14.75A1.75 1.75 0 0 0 13 15.75v1.5Zm1.75.25a.25.25 0 0 1-.25-.25v-1.5a.25.25 0 0 1 .25-.25h3.496a.25.25 0 0 1 .25.25v1.5a.25.25 0 0 1-.25.25H14.75Zm0-4.5A1.75 1.75 0 0 1 13 11.25v-4.5c0-.966.784-1.75 1.75-1.75h3.496c.967 0 1.75.784 1.75 1.75v4.5a1.75 1.75 0 0 1-1.75 1.75H14.75Zm-.25-1.75c0 .138.112.25.25.25h3.496a.25.25 0 0 0 .25-.25v-4.5a.25.25 0 0 0-.25-.25H14.75a.25.25 0 0 0-.25.25v4.5Z"
            fill="currentColor"
          />
        </svg>
        <span className={toolbarStyles.menuButtonText}>{t('appearance')}</span>
      </button>

      <ReviewPopup id={id} open={open} onOpenChange={setOpen} anchor={triggerRef} label={t('appearance')} side="bottom" align="end" width={272} menuSurface keepOpenOnOutside="[data-frameio-select-layer]">
        <div className="py-2">
          <Row label={t('layout')}>
            <ChoiceGroup>
              <button
                type="button"
                onClick={() => onViewModeChange('grid')}
                aria-pressed={viewMode === 'grid'}
                aria-label={t('grid')}
                title={t('grid')}
                className={choiceClass(viewMode === 'grid')}
              >
                <Grid2X2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onViewModeChange('list')}
                aria-pressed={viewMode === 'list'}
                aria-label={t('list')}
                title={t('list')}
                className={choiceClass(viewMode === 'list')}
              >
                <List className="h-4 w-4" />
              </button>
            </ChoiceGroup>
          </Row>

          <Row label={t('cardSize')}>
            <ChoiceGroup>
              {([
                ['sm', 'S', t('sizeSmall')],
                ['md', 'M', t('sizeMedium')],
                ['lg', 'L', t('sizeLarge')],
              ] as Array<[VideoCardSize, string, string]>).map(([size, label, name]) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => update({ size })}
                  aria-pressed={value.size === size}
                  aria-label={name}
                  title={name}
                  className={`${choiceClass(value.size === size)} px-0`}
                >
                  {label}
                </button>
              ))}
            </ChoiceGroup>
          </Row>

          <Row label={t('aspectRatio')}>
            <ChoiceGroup>
              {aspectOptions.map(({ value: aspect, label, icon: Icon }) => (
                <button
                  key={aspect}
                  type="button"
                  onClick={() => update({ aspect })}
                  aria-pressed={value.aspect === aspect}
                  aria-label={label}
                  title={label}
                  className={choiceClass(value.aspect === aspect)}
                >
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </ChoiceGroup>
          </Row>

          <Row label={t('thumbnailFit')}>
            <FrameioMenuSelect
              value={value.fit}
              options={[
                { value: 'fit', label: t('fit') },
                { value: 'fill', label: t('fill') },
              ]}
              onChange={(fit) => update({ fit: fit as VideoThumbFit })}
              ariaLabel={t('thumbnailFit')}
            />
          </Row>

          <Row label={t('showInfo')}>
            <Switch
              checked={value.showInfo}
              onCheckedChange={(showInfo) => update({ showInfo })}
              aria-label={t('showInfo')}
            />
          </Row>

          {value.showInfo && (
            <Row label={t('captions')}>
              <FrameioMenuSelect
                value={String(value.titleLines)}
                options={[
                  { value: '1', label: t('oneLine') },
                  { value: '2', label: t('twoLines') },
                ]}
                onChange={(titleLines) => update({ titleLines: Number(titleLines) as VideoTitleLines })}
                ariaLabel={t('captions')}
              />
            </Row>
          )}

          <Row label={t('flattenFolders')}>
            <Switch
              checked={value.flattenFolders}
              onCheckedChange={(flattenFolders) => update({ flattenFolders })}
              aria-label={t('flattenFolders')}
            />
          </Row>
        </div>
      </ReviewPopup>
    </div>
  )
}
