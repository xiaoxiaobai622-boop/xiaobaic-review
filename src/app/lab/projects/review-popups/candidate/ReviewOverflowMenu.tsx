'use client'

import { useId, useRef, useState, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import ReviewPopup from './ReviewPopup'
import styles from './popup.module.css'

export default function ReviewOverflowMenu({ children }: { children: ReactNode }) {
  const t = useTranslations('videoUi')
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const id = useId()

  return (
    <div className="relative">
      <Button type="button" ref={triggerRef} variant="ghost" size="icon"
        className={`${styles.trigger} h-8 w-8 text-muted-foreground hover:text-foreground`}
        onClick={() => setOpen(current => !current)} aria-haspopup="dialog" aria-expanded={open}
        aria-controls={open ? id : undefined} title={t('more')} aria-label={t('more')}>
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      <ReviewPopup id={id} open={open} onOpenChange={setOpen} anchor={triggerRef} label={t('more')} side="bottom" align="end" width={240}>
        {children}
      </ReviewPopup>
    </div>
  )
}
