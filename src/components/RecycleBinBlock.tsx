'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Trash2, Loader2, AlertTriangle } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { useTranslations } from 'next-intl'

type RecycleItem = {
  id: string
  itemType: string
  itemName: string
  deletedAt: string
  daysRemaining: number
}

export default function RecycleBinBlock({ projectId, onCountChange }: { projectId: string; onCountChange?: (count: number) => void }) {
  const t = useTranslations('projects')
  const [items, setItems] = useState<RecycleItem[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await apiFetch(`/api/projects/${projectId}/recycle-bin`, { cache: 'no-store' })
      if (!response.ok) throw new Error('failed')
      const data = await response.json()
      const next = (data.items || []) as RecycleItem[]
      setItems(next)
      onCountChange?.(next.length)
    } finally {
      setLoading(false)
    }
  }, [projectId, onCountChange])

  useEffect(() => { load().catch(() => setItems([])) }, [load])

  const permanentlyDelete = async (id: string) => {
    if (!window.confirm(t('recycleBinConfirmDelete'))) return
    setDeletingId(id)
    try {
      const response = await apiFetch(`/api/projects/${projectId}/recycle-bin?itemId=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('failed')
      await load()
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) return <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('recycleBinLoading')}</div>

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{t('recycleBinDescription')}</p>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">{t('recycleBinEmpty')}</div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 rounded-md border border-border px-3 py-3">
              <Trash2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.itemName}</p>
                <p className="text-xs text-muted-foreground">{t('recycleBinItemType', { type: item.itemType })} · {t('recycleBinDaysRemaining', { days: item.daysRemaining })}</p>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive" title={t('recycleBinDeleteNow')} aria-label={t('recycleBinDeleteNow')} onClick={() => permanentlyDelete(item.id)} disabled={deletingId === item.id}>
                {deletingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
