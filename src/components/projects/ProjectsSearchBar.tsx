'use client'

import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useTranslations } from 'next-intl'

interface ProjectsSearchBarProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export default function ProjectsSearchBar({ value, onChange, placeholder }: ProjectsSearchBarProps) {
  const t = useTranslations('projects')
  return (
    // Mirrored so it docks to the right end of its row: the magnifier and the clear
    // button move to that edge while the text keeps its normal left start.
    <div className="relative ml-auto min-w-[180px] max-w-sm flex-1">
      <Input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || t('searchPlaceholder')}
        className="h-9 pl-3 pr-14 text-sm"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-8 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label={t('clearSearch')}
        >
          <X className="w-4 h-4" />
        </button>
      )}
      <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
    </div>
  )
}
