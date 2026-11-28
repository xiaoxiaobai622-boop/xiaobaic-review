'use client'

import { useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Switch } from '@/components/ui/switch'
import ReviewPopup from '@/components/ReviewPopup'
import toolbarStyles from './ProjectToolbar.module.css'

interface VideoFieldsMenuProps {
  showStatusField: boolean
  onChange: (showStatusField: boolean) => void
}

export default function VideoFieldsMenu({ showStatusField, onChange }: VideoFieldsMenuProps) {
  const t = useTranslations('videoUi')
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const id = useId()

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
        aria-label={`${t('fields')}: ${t('visibleFieldCount', { count: showStatusField ? 1 : 0 })}`}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" focusable="false" aria-hidden="true">
          <path
            d="M11.75 4a.75.75 0 0 0 0 1.5h2v4.75a.75.75 0 0 0 1.5 0V5.5h2a.75.75 0 0 0 0-1.5h-5.5ZM6.5 8c.087 0 .167.05.204.13l.923 1.95 2.183.354a.226.226 0 0 1 .128.38l-1.517 1.603.338 2.323a.226.226 0 0 1-.333.23L6.5 13.91l-1.926 1.06a.226.226 0 0 1-.333-.23l.338-2.324-1.518-1.604a.226.226 0 0 1 .128-.379l2.184-.354.922-1.95A.226.226 0 0 1 6.5 8Zm12.328 7.23a.75.75 0 0 0-1.152-.96l-3.124 3.746-1.187-1.698a.75.75 0 0 0-1.23.86l1.75 2.502a.75.75 0 0 0 1.191.05l3.752-4.5Z"
            fill="currentColor"
          />
        </svg>
        <span className={toolbarStyles.menuButtonText}>
          <span>{t('fields')}</span>
          <span className={toolbarStyles.menuButtonSecondary}>{t('visibleFieldCount', { count: showStatusField ? 1 : 0 })}</span>
        </span>
      </button>

      <ReviewPopup id={id} open={open} onOpenChange={setOpen} anchor={triggerRef} label={t('fields')} side="bottom" align="end" width={286} menuSurface>
        <div className="py-2">
          <div className="flex min-h-[34px] items-center justify-between gap-1 px-4">
            <span className="truncate text-[13px] font-[420] leading-5 text-[#181b29] dark:text-foreground">{t('statusField')}</span>
            <Switch
              checked={showStatusField}
              onCheckedChange={onChange}
              aria-label={t('statusField')}
            />
          </div>
        </div>
      </ReviewPopup>
    </div>
  )
}
