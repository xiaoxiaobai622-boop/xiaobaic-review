'use client'

import type React from 'react'

import { cn } from '@/lib/utils'
import { LayoutGrid, Table2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslations } from 'next-intl'
import { useSlidingIndicator } from '@/hooks/useSlidingIndicator'

export type ViewMode = 'grid' | 'table'

interface ViewModeToggleProps {
  value: ViewMode
  onChange: (value: ViewMode) => void
  className?: string
}

export default function ViewModeToggle({ value, onChange, className }: ViewModeToggleProps) {
  const t = useTranslations('controls')
  const { containerRef, rect } = useSlidingIndicator(value === 'grid' ? 0 : 1)
  return (
    <div ref={containerRef} className={cn('relative inline-flex items-center rounded-lg border bg-card p-0.5', className)}>
      {rect && (
        <span
          aria-hidden="true"
          className="absolute left-0 bottom-0.5 top-0.5 rounded-md bg-accent transition-[transform,width] duration-[var(--motion-base)] ease-[var(--ease-standard)]"
          style={{ transform: `translateX(${rect.left}px)`, width: rect.width }}
        />
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        data-segment
        onClick={() => onChange('grid')}
        aria-pressed={value === 'grid'}
        className={cn(
          'relative z-10 h-[30px] w-[30px] rounded-md bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground',
          value === 'grid' && 'text-foreground'
        )}
        title={t('gridView')}
      >
        <LayoutGrid className="h-4 w-4" />
        <span className="sr-only">{t('gridView')}</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        data-segment
        onClick={() => onChange('table')}
        aria-pressed={value === 'table'}
        className={cn(
          'relative z-10 h-[30px] w-[30px] rounded-md bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground',
          value === 'table' && 'text-foreground'
        )}
        title={t('tableView')}
      >
        <Table2 className="h-4 w-4" />
        <span className="sr-only">{t('tableView')}</span>
      </Button>
    </div>
  )
}

