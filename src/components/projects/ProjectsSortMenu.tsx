'use client'

import { useId, useRef, useState } from 'react'
import { ArrowUpDown, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslations } from 'next-intl'
import ReviewPopup from '@/components/ReviewPopup'
import styles from '@/components/review-popup.module.css'
import type { SortKey } from '@/lib/projects-filter'

interface ProjectsSortMenuProps {
  value: SortKey
  onChange: (value: SortKey) => void
}

const SORT_OPTIONS: SortKey[] = [
  'updatedDesc',
  'createdDesc',
  'createdAsc',
  'dueAsc',
  'titleAsc',
  'titleDesc',
  'statusPriority',
]

export default function ProjectsSortMenu({ value, onChange }: ProjectsSortMenuProps) {
  const t = useTranslations('projects')
  const tc = useTranslations('common')
  const [isOpen, setIsOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const id = useId()

  const labelFor = (k: SortKey) => t(`sortOption.${k}` as const)

  return (
    <div className="relative">
      <Button
        ref={triggerRef}
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        title={tc('sort')}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? id : undefined}
      >
        <ArrowUpDown className="w-4 h-4" />
        <span className="hidden sm:inline ml-2">{labelFor(value)}</span>
      </Button>

      <ReviewPopup id={id} open={isOpen} onOpenChange={setIsOpen} anchor={triggerRef} label={tc('sort')} role="menu" side="bottom" align="end" width={200}>
        <p className={styles.heading}>{tc('sort')}</p>
        {SORT_OPTIONS.map(opt => (
          <button
            key={opt}
            type="button"
            role="menuitemradio"
            aria-checked={opt === value}
            onClick={() => { onChange(opt); setIsOpen(false) }}
            className={styles.item}
          >
            <span className="min-w-0 flex-1 truncate">{labelFor(opt)}</span>
            {opt === value && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}
          </button>
        ))}
      </ReviewPopup>
    </div>
  )
}
