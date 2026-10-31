'use client'

import { useCallback, useEffect, useState } from 'react'
import { PauseCircle, PlayCircle, Save } from 'lucide-react'
import { appConfirm, appNotice } from '@/components/AppDialogProvider'
import { apiFetch, apiPatch } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { cn, formatBeijingDateTime } from '@/lib/utils'
import type { AnnouncementControlResponse } from '@/lib/announcements/admin-types'

export default function AnnouncementControlPanel() {
  const [data, setData] = useState<AnnouncementControlResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState({
    modalMaxPerDay: 1,
    modalCooldownMinutes: 1440,
    modalMaxShowsPerUser: 3,
    toastMaxPriority: 20,
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await apiFetch('/api/platform/announcements/control', { cache: 'no-store' })
      if (!response.ok) throw new Error(String(response.status))
      const next = await response.json() as AnnouncementControlResponse
      setData(next)
      setDraft({
        modalMaxPerDay: next.control.modalMaxPerDay,
        modalCooldownMinutes: next.control.modalCooldownMinutes,
        modalMaxShowsPerUser: next.control.modalMaxShowsPerUser,
        toastMaxPriority: next.control.toastMaxPriority,
      })
    } catch {
      setError('公告控制配置读取失败；这不会阻塞收件箱。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const toggleKillSwitch = async () => {
    if (!data) return
    const next = !data.control.bannerModalPaused
    if (next) {
      const confirmed = await appConfirm({
        title: '暂停所有横幅与弹窗？',
        message: 'BANNER、MODAL 和 TOAST 会立即停止展示，收件箱仍可回看所有公告。这个操作会写入审计。',
        confirmLabel: '暂停展示',
        cancelLabel: '取消',
        tone: 'destructive',
      })
      if (!confirmed) return
    }
    setSaving(true)
    try {
      const updated = await apiPatch<AnnouncementControlResponse>('/api/platform/announcements/control', {
        bannerModalPaused: next,
      })
      setData(updated)
      appNotice({ tone: 'success', message: next ? '已暂停所有横幅与弹窗' : '已恢复横幅与弹窗' })
    } catch (err) {
      appNotice({ tone: 'error', message: err instanceof Error ? err.message : '切换失败，请稍后重试' })
    } finally {
      setSaving(false)
    }
  }

  const saveLimits = async () => {
    setSaving(true)
    try {
      const updated = await apiPatch<AnnouncementControlResponse>('/api/platform/announcements/control', draft)
      setData(updated)
      appNotice({ tone: 'success', message: '频率与冷却已保存' })
    } catch (err) {
      appNotice({ tone: 'error', message: err instanceof Error ? err.message : '保存失败，请稍后重试' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="h-10 animate-pulse rounded-lg bg-muted/60" aria-label="正在读取公告控制配置" />
  }
  if (error || !data) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive-visible px-3 py-2 text-xs text-destructive">
        <span>{error || '公告控制配置不可用'}</span>
        <button type="button" onClick={() => void load()} className="underline underline-offset-2">重试</button>
      </div>
    )
  }

  const paused = data.control.bannerModalPaused
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-2">
        <span className={cn('inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium', paused ? 'bg-destructive-visible text-destructive' : 'bg-success-visible text-success')}>
          {paused ? <PauseCircle className="h-3.5 w-3.5" aria-hidden /> : <PlayCircle className="h-3.5 w-3.5" aria-hidden />}
          {paused ? '横幅/弹窗已全局暂停' : '横幅/弹窗正常运行'}
        </span>
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          kill switch 只停 BANNER / MODAL / TOAST，收件箱不受影响。
        </p>
        <Button
          type="button"
          size="sm"
          variant={paused ? 'default' : 'outline'}
          onClick={() => void toggleKillSwitch()}
          disabled={saving}
          className="h-7 px-2 text-xs"
        >
          {paused ? '恢复展示' : '暂停所有横幅与弹窗'}
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3 px-3 py-2.5">
        {([
          ['modalMaxPerDay', '每日弹窗上限', 0, 10],
          ['modalCooldownMinutes', '单条冷却（分钟）', 0, 10080],
          ['modalMaxShowsPerUser', '单用户最多展示', 0, 50],
          ['toastMaxPriority', '轻提示最高优先级', 0, 100],
        ] as Array<[keyof typeof draft, string, number, number]>).map(([key, label, min, max]) => (
          <label key={key} className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            {label}
            <input
              type="number"
              min={min}
              max={max}
              value={draft[key]}
              onChange={(event) => setDraft((current) => ({ ...current, [key]: Number(event.target.value) }))}
              className="h-7 w-24 rounded border border-border bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
        ))}
        <Button type="button" size="sm" variant="outline" onClick={() => void saveLimits()} disabled={saving} className="h-7 px-2 text-xs">
          <Save className="mr-1 h-3 w-3" aria-hidden />
          保存频率
        </Button>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {data.updatedByLabel ? `${data.updatedByLabel} · ${formatBeijingDateTime(data.updatedAt)}` : '尚未调整'}
        </span>
      </div>
    </section>
  )
}
