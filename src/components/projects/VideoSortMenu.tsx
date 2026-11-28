'use client'

import { useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import ReviewPopup from '@/components/ReviewPopup'
import FrameioMenuSelect from './FrameioMenuSelect'
import toolbarStyles from './ProjectToolbar.module.css'
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
      <button
        ref={triggerRef}
        type="button"
        className={toolbarStyles.menuButton}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`${t('sortBy')}: ${labelFor(value.field)}`}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" focusable="false" aria-hidden="true">
          <path
            d="M6.75 5a.75.75 0 0 0 0 1.5h12.5a.75.75 0 0 0 0-1.5H6.75Zm0 4a.75.75 0 0 0 0 1.5h10.5a.75.75 0 0 0 0-1.5H6.75ZM6 13.75a.75.75 0 0 1 .75-.75h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1-.75-.75ZM6.75 17a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-6.5Z"
            fill="currentColor"
          />
        </svg>
        <span className={toolbarStyles.menuButtonText}>
          <span>{t('sortBy')}</span>
          <span className={toolbarStyles.menuButtonSecondary}>{labelFor(value.field)}</span>
        </span>
      </button>

      <ReviewPopup id={id} open={open} onOpenChange={setOpen} anchor={triggerRef} label={t('sort')} side="bottom" align="end" width={286} menuSurface keepOpenOnOutside="[data-frameio-select-layer]">
        <div className="px-2 py-3">
          <div className="pb-2 pl-1 text-[12px] font-[420] leading-4 text-[#63677d]">{t('sortBy')}</div>
          <div className="flex flex-col gap-2">
            <FrameioMenuSelect
              value={value.field}
              options={FIELDS.map((field) => ({ value: field, label: labelFor(field) }))}
              onChange={(field) => onChange({ ...value, field: field as VideoSortField })}
              ariaLabel={t('sortBy')}
              variant="field"
              align="start"
            />
            <div className="flex items-center gap-2">
              <span className="pl-1 pr-2 text-[12px] font-[420] leading-4 text-[#63677d]">从</span>
              <FrameioMenuSelect
                value={value.dir}
                options={[
                  { value: 'asc', label: t('asc') },
                  { value: 'desc', label: t('desc') },
                ]}
                onChange={(dir) => onChange({ ...value, dir: dir === 'asc' ? 'asc' : 'desc' })}
                ariaLabel={t('sort')}
                variant="field"
                align="start"
                className="flex-1"
              />
            </div>
          </div>
        </div>
      </ReviewPopup>
    </div>
  )
}
