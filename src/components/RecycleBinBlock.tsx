'use client'

import { appAlert, appConfirm } from '@/components/AppDialogProvider'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { RotateCcw, Trash2, Loader2, AlertTriangle } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { useTranslations } from 'next-intl'

type RecycleItem = {
  id: string
  itemType: string
  itemName: string
  deletedAt: string
  daysRemaining: number
  restorable: boolean
}

// The five item types the delete routes register. An unlisted type falls back to
// its raw name rather than a generic label, so a newly added kind stays visible
// and diagnosable instead of blending into the list.
const RECYCLE_BIN_TYPE_KEYS: Record<string, string> = {
  VIDEO: 'recycleBinTypeVideo',
  FOLDER: 'recycleBinTypeFolder',
  PHOTO_ALBUM: 'recycleBinTypeAlbum',
  PHOTO: 'recycleBinTypePhoto',
  PROJECT_UPLOAD: 'recycleBinTypeUpload',
}

export default function RecycleBinBlock({ projectId, onCountChange, onRestored }: { projectId: string; onCountChange?: (count: number) => void; onRestored?: () => void }) {
  const t = useTranslations('projects')
  const [items, setItems] = useState<RecycleItem[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await apiFetch(`/api/projects/${projectId}/recycle-bin`, { cache: 'no-store' })
      if (!response.ok) throw new Error('failed')
      const data = await response.json()
      const next = (data.items || []) as RecycleItem[]
      setItems(next)
      setFailed(false)
      onCountChange?.(next.length)
    } catch {
      // A failed read is not an empty bin: saying so is the difference between a
      // retry and the team believing their deleted videos are already gone.
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [projectId, onCountChange])

  useEffect(() => { load() }, [load])

  const permanentlyDelete = async (id: string) => {
    if (!await appConfirm(t('recycleBinConfirmDelete'))) return
    setDeletingId(id)
    try {
      const response = await apiFetch(`/api/projects/${projectId}/recycle-bin?itemId=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!response.ok) {
        await appAlert(t('recycleBinDeleteFailed'))
        return
      }
      await load()
    } finally {
      setDeletingId(null)
    }
  }

  const restore = async (id: string) => {
    setRestoringId(id)
    try {
      const response = await apiFetch(`/api/projects/${projectId}/recycle-bin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: id }),
      })
      if (!response.ok) {
        await appAlert(t('recycleBinRestoreFailed'))
        return
      }
      await Promise.all([load(), onRestored?.()])
    } finally {
      setRestoringId(null)
    }
  }

  if (loading) return <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('recycleBinLoading')}</div>

  if (failed) {
    return (
      <div className="flex items-center gap-3 py-10 text-sm text-muted-foreground">
        {t('recycleBinLoadFailed')}
        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { void load() }}>{t('recycleBinRetry')}</Button>
      </div>
    )
  }

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
          {items.map((item) => {
            const typeKey = RECYCLE_BIN_TYPE_KEYS[item.itemType]
            return (
              <div key={item.id} className="flex items-center gap-3 rounded-md border border-border px-3 py-3">
                <Trash2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.itemName}</p>
                  <p className="text-xs text-muted-foreground">{typeKey ? t(typeKey) : item.itemType} · {t('recycleBinDaysRemaining', { days: item.daysRemaining })}{!item.restorable ? ` · ${t('recycleBinRestoreUnsupported')}` : ''}</p>
                </div>
                {item.restorable && (
                  <Button variant="ghost" size="sm" className="h-8 shrink-0 gap-1.5 text-xs" onClick={() => restore(item.id)} disabled={restoringId === item.id}>
                    {restoringId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                    {t('recycleBinRestore')}
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive" title={t('recycleBinDeleteNow')} aria-label={t('recycleBinDeleteNow')} onClick={() => permanentlyDelete(item.id)} disabled={deletingId === item.id}>
                  {deletingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
                </Button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
