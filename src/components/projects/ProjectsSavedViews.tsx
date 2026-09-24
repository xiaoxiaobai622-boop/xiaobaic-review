'use client'

import { useState } from 'react'
import { Bookmark, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import type { ProjectsFilterState, SerializedFilterState } from '@/lib/projects-filter'
import { isFilterActive, serializeFilterState, serializedStatesEqual } from '@/lib/projects-filter'

export interface SavedView {
  id: string
  name: string
  state: SerializedFilterState
}

interface ProjectsSavedViewsProps {
  views: SavedView[]
  filters: ProjectsFilterState
  onSelect: (view: SavedView | null) => void
  onSave: (name: string) => void
  onDelete: (id: string) => void
}

export default function ProjectsSavedViews({
  views,
  filters,
  onSelect,
  onSave,
  onDelete,
}: ProjectsSavedViewsProps) {
  const t = useTranslations('projects')
  const tc = useTranslations('common')
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  const canSave = isFilterActive(filters)
  const currentSerialized = serializeFilterState(filters)
  const currentMatchesView = views.find(v => serializedStatesEqual(v.state, currentSerialized))
  const activeViewId = currentMatchesView?.id ?? null

  const handleSave = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    onSave(trimmed)
    setName('')
    setNaming(false)
  }

  return (
    // Shares a row with the search field, so no bottom margin and it may shrink.
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={cn(
          'h-9 inline-flex items-center whitespace-nowrap px-3 text-xs rounded-lg border transition-colors',
          activeViewId === null && !isFilterActive(filters)
            ? 'bg-primary text-primary-foreground border-primary'
            : 'border-border hover:bg-muted'
        )}
      >
        {tc('all')}
      </button>

      {views.map(v => (
        <span
          key={v.id}
          className={cn(
            'h-9 inline-flex items-center whitespace-nowrap text-xs rounded-lg border transition-colors',
            activeViewId === v.id
              ? 'bg-primary text-primary-foreground border-primary'
              : 'border-border hover:bg-muted'
          )}
        >
          <button
            type="button"
            onClick={() => onSelect(v)}
            className="h-full pl-3 pr-2 inline-flex items-center gap-1.5"
          >
            <Bookmark className="w-3 h-3" />
            {v.name}
          </button>
          <button
            type="button"
            onClick={() => onDelete(v.id)}
            className={cn(
              'h-full pr-2 inline-flex items-center hover:opacity-70',
              activeViewId === v.id ? '' : 'text-muted-foreground'
            )}
            aria-label={t('deleteSavedView')}
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}

      {naming ? (
        <div className="inline-flex items-center gap-1">
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('savedViewNamePlaceholder')}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
              if (e.key === 'Escape') { setNaming(false); setName('') }
            }}
            className="h-9 text-sm w-44"
          />
          <Button size="sm" variant="default" onClick={handleSave} disabled={!name.trim()} className="px-2">
            {tc('save')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setNaming(false); setName('') }} className="px-2">
            {tc('cancel')}
          </Button>
        </div>
      ) : (
        canSave && !currentMatchesView && (
          <Button size="sm" variant="outline" onClick={() => setNaming(true)} className="px-2">
            <Plus className="w-3 h-3 mr-1" />
            {t('saveCurrentView')}
          </Button>
        )
      )}
    </div>
  )
}
