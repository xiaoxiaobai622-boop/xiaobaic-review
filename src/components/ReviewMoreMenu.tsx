'use client'

import { useId, useRef, useState } from 'react'
import { BookOpen, MoreHorizontal } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import ReviewPopup from './ReviewPopup'
import popupStyles from './review-popup.module.css'

const HELP_DOC_URL = 'https://scnqe74t5owc.feishu.cn/wiki/UOxownMcRiBLeekZwcEc3BBAnc2?from=from_copylink'

/** 顶栏「更多」占位：先只放帮助，后续动作继续加在这里。 */
export default function ReviewMoreMenu() {
  const t = useTranslations('comments')
  const locale = useLocale()
  const isChinese = locale.startsWith('zh')
  const moreLabel = isChinese ? '更多' : t('more')
  const helpLabel = isChinese ? '帮助' : t('help')
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const id = useId()

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        data-review-popup-trigger
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={moreLabel}
        title={moreLabel}
        className="inline-flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[6px] text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MoreHorizontal className="h-[20px] w-[20px]" aria-hidden="true" />
      </button>
      <ReviewPopup
        id={id}
        open={open}
        onOpenChange={setOpen}
        anchor={triggerRef}
        label={moreLabel}
        role="menu"
        side="bottom"
        align="end"
        width={180}
      >
        <p className={popupStyles.heading}>{moreLabel}</p>
        <a
          role="menuitem"
          href={HELP_DOC_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setOpen(false)}
          className={popupStyles.item}
        >
          <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{helpLabel}</span>
        </a>
      </ReviewPopup>
    </div>
  )
}
