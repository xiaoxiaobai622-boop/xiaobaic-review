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

// The purge endpoint caps one request at 100 ids, so emptying a bin of 300 records
// is three requests rather than a server-side exception to the cap.
const PURGE_BATCH = 100

export default function RecycleBinBlock({ projectId, onCountChange, onRestored }: { projectId: string; onCountChange?: (count: number) => void; onRestored?: () => void }) {
  const t = useTranslations('projects')
  const [items, setItems] = useState<RecycleItem[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [clearing, setClearing] = useState(false)

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
      // A record that has left the bin must not stay checked: the next purge would
      // report it as a failure the user never caused.
      setSelected((prev) => {
        const alive = next.filter((item) => prev.has(item.id))
        return alive.length === prev.size ? prev : new Set(alive.map((item) => item.id))
      })
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

  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id))

  const toggleItem = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(items.map((item) => item.id)))

  /**
   * 「清空」和「删除所选」走同一趟：确认句必须报出条数，因为这一步没有第二次机会——
   * 视频一旦出箱，挂着的批注、版本和统计就跟着行一起没了。
   */
  const purge = async (ids: string[], confirmMessage: string) => {
    if (ids.length === 0) return
    if (!await appConfirm({ message: confirmMessage, confirmLabel: t('recycleBinDeleteNow'), tone: 'destructive' })) return
    setClearing(true)
    let purged = 0
    const failedIds: string[] = []
    for (let offset = 0; offset < ids.length; offset += PURGE_BATCH) {
      const batch = ids.slice(offset, offset + PURGE_BATCH)
      try {
        const response = await apiFetch(`/api/projects/${projectId}/recycle-bin/purge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemIds: batch }),
        })
        if (response.ok) {
          const data = await response.json()
          purged += data.purged || 0
          for (const item of data.failed || []) {
            if (typeof item?.itemId === 'string') failedIds.push(item.itemId)
          }
        } else {
          failedIds.push(...batch)
        }
      } catch {
        failedIds.push(...batch)
      }
    }
    setClearing(false)
    setSelected(new Set())
    await load()
    // 只报失败：全清成功时列表自己就空了，再弹一句是噪音。
    if (failedIds.length > 0) {
      await appAlert(purged > 0
        ? t('recycleBinClearPartial', { purged, failed: failedIds.length })
        : t('recycleBinClearFailed'))
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
      <div className="mb-4 flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t('recycleBinDescription')}</p>
        {items.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 shrink-0 gap-1.5 border-destructive/40 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => purge(items.map((item) => item.id), t('recycleBinConfirmClearAll', { count: items.length }))}
            disabled={clearing}
          >
            {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {t('recycleBinClearAll')}
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">{t('recycleBinEmpty')}</div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-3 px-1">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" className="h-4 w-4 shrink-0 rounded border-input" checked={allSelected} onChange={toggleAll} disabled={clearing} aria-label={allSelected ? t('recycleBinDeselectAll') : t('recycleBinSelectAll')} />
              {allSelected ? t('recycleBinDeselectAll') : t('recycleBinSelectAll')}
            </label>
            {selected.size > 0 && (
              <>
                <span className="text-xs tabular-nums text-muted-foreground">{t('recycleBinSelectedCount', { count: selected.size })}</span>
                <div className="min-w-2 flex-1" />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 gap-1.5 border-destructive/40 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => purge([...selected], t('recycleBinConfirmDeleteSelected', { count: selected.size }))}
                  disabled={clearing}
                >
                  {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
                  {t('recycleBinDeleteSelected')}
                </Button>
              </>
            )}
          </div>
          {items.map((item) => {
            const typeKey = RECYCLE_BIN_TYPE_KEYS[item.itemType]
            return (
              <div key={item.id} className="flex items-center gap-3 rounded-md border border-border px-3 py-3">
                <input type="checkbox" className="h-4 w-4 shrink-0 rounded border-input" checked={selected.has(item.id)} onChange={() => toggleItem(item.id)} disabled={clearing} aria-label={t('recycleBinSelectItem')} />
                <Trash2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.itemName}</p>
                  <p className="text-xs text-muted-foreground">{typeKey ? t(typeKey) : item.itemType} · {t('recycleBinDaysRemaining', { days: item.daysRemaining })}{!item.restorable ? ` · ${t('recycleBinRestoreUnsupported')}` : ''}</p>
                </div>
                {item.restorable && (
                  <Button variant="ghost" size="sm" className="h-8 shrink-0 gap-1.5 text-xs" onClick={() => restore(item.id)} disabled={restoringId === item.id || clearing}>
                    {restoringId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                    {t('recycleBinRestore')}
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive" title={t('recycleBinDeleteNow')} aria-label={t('recycleBinDeleteNow')} onClick={() => permanentlyDelete(item.id)} disabled={deletingId === item.id || clearing}>
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
