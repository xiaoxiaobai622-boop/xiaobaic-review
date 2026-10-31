'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Download, Plus, Search, SlidersHorizontal } from 'lucide-react'
import AnnouncementControlPanel from '@/components/announcements/AnnouncementControlPanel'
import {
  CompactMetrics,
  FunnelBar,
  ModePill,
  StatusPill,
  TypePill,
  formatWhen,
} from '@/components/announcements/AnnouncementUi'
import { appNotice } from '@/components/AppDialogProvider'
import { apiFetch } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  ANNOUNCEMENT_STATUSES,
  ANNOUNCEMENT_TYPES,
  AUDIENCE_KINDS,
  AUDIENCE_KIND_LABELS,
  MODE_LABELS,
  PRIMARY_MODES,
  STATUS_LABELS,
  TYPE_LABELS,
} from '@/lib/announcements/constants'
import type { AdminAnnouncementItem, AnnouncementListResponse } from '@/lib/announcements/admin-types'

const ALL = ''

const inputClass = 'h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring'

export default function PlatformAnnouncementsPage() {
  const [items, setItems] = useState<AdminAnnouncementItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState(ALL)
  const [type, setType] = useState(ALL)
  const [mode, setMode] = useState(ALL)
  const [audienceKind, setAudienceKind] = useState(ALL)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [includeTest, setIncludeTest] = useState(false)
  const [exporting, setExporting] = useState(false)

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (q.trim()) params.set('q', q.trim())
    if (status) params.set('status', status)
    if (type) params.set('type', type)
    if (mode) params.set('mode', mode)
    if (audienceKind) params.set('audienceKind', audienceKind)
    if (from) params.set('from', new Date(`${from}T00:00:00+08:00`).toISOString())
    if (to) params.set('to', new Date(`${to}T23:59:59+08:00`).toISOString())
    if (includeTest) params.set('includeTest', '1')
    return params
  }, [audienceKind, from, includeTest, mode, q, status, to, type])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/platform/announcements?${query.toString()}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(String(response.status))
      const data = await response.json() as AnnouncementListResponse
      setItems(Array.isArray(data.items) ? data.items : [])
    } catch {
      setError('公告列表读取失败；统计与空态都不能当作“没有公告”，请刷新重试。')
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 250)
    return () => window.clearTimeout(timer)
  }, [load])

  const exportCsv = async () => {
    setExporting(true)
    try {
      const response = await apiFetch(`/api/platform/announcements/export?${query.toString()}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(String(response.status))
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `announcements-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch {
      appNotice({ tone: 'error', message: '导出失败，请稍后重试' })
    } finally {
      setExporting(false)
    }
  }

  const resetFilters = () => {
    setQ('')
    setStatus(ALL)
    setType(ALL)
    setMode(ALL)
    setAudienceKind(ALL)
    setFrom('')
    setTo('')
    setIncludeTest(false)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">公告</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            一条公告只选一个主承载；收件箱是所有公告的留档与兜底。时间均按北京（UTC+8）。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void exportCsv()} disabled={exporting} className="h-8 px-2.5 text-xs">
            <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {exporting ? '导出中…' : '导出 CSV'}
          </Button>
          <Button asChild size="sm" className="h-8 px-2.5 text-xs">
            <Link href="/platform/announcements/new">
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              新建公告
            </Link>
          </Button>
        </div>
      </div>

      <AnnouncementControlPanel />

      <section className="rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
            筛选
          </span>
          <label className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="搜索标题或正文"
              aria-label="搜索公告"
              className={cn(inputClass, 'w-48 pl-7')}
            />
          </label>
          <select aria-label="按状态筛选" value={status} onChange={(event) => setStatus(event.target.value)} className={inputClass}>
            <option value={ALL}>全部状态</option>
            {ANNOUNCEMENT_STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}
          </select>
          <select aria-label="按类型筛选" value={type} onChange={(event) => setType(event.target.value)} className={inputClass}>
            <option value={ALL}>全部类型</option>
            {ANNOUNCEMENT_TYPES.map((value) => <option key={value} value={value}>{TYPE_LABELS[value]}</option>)}
          </select>
          <select aria-label="按主模式筛选" value={mode} onChange={(event) => setMode(event.target.value)} className={inputClass}>
            <option value={ALL}>全部主模式</option>
            {PRIMARY_MODES.map((value) => <option key={value} value={value}>{MODE_LABELS[value]}</option>)}
          </select>
          <select aria-label="按受众类型筛选" value={audienceKind} onChange={(event) => setAudienceKind(event.target.value)} className={inputClass}>
            <option value={ALL}>全部受众</option>
            {AUDIENCE_KINDS.map((value) => <option key={value} value={value}>{AUDIENCE_KIND_LABELS[value]}</option>)}
          </select>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            从
            <input type="date" aria-label="创建时间起" value={from} onChange={(event) => setFrom(event.target.value)} className={inputClass} />
          </label>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            到
            <input type="date" aria-label="创建时间止" value={to} onChange={(event) => setTo(event.target.value)} className={inputClass} />
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={includeTest} onChange={(event) => setIncludeTest(event.target.checked)} className="accent-[hsl(var(--primary))]" />
            含测试发送
          </label>
          <button type="button" onClick={resetFilters} className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            清空
          </button>
          <span className="ml-auto text-[11px] text-muted-foreground">{loading ? '读取中…' : `${items.length} 条`}</span>
        </div>

        {error ? (
          <div className="px-3 py-8 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <button type="button" onClick={() => void load()} className="mt-2 text-xs text-muted-foreground underline underline-offset-2">重试</button>
          </div>
        ) : loading && items.length === 0 ? (
          <div className="flex flex-col gap-2 p-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-16 animate-pulse rounded-md bg-muted/50" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="px-3 py-12 text-center">
            <p className="text-sm font-medium text-foreground">还没有符合条件的公告</p>
            <p className="mt-1 text-xs text-muted-foreground">新建一条草稿，或放宽筛选条件。</p>
            <Button asChild size="sm" className="mt-3 h-8 px-3 text-xs">
              <Link href="/platform/announcements/new">新建公告</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[1080px] border-collapse text-left text-xs">
                <thead className="border-b border-border text-[11px] text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">公告</th>
                    <th className="px-2 py-2 font-medium">状态</th>
                    <th className="px-2 py-2 font-medium">主承载</th>
                    <th className="px-2 py-2 font-medium">受众</th>
                    <th className="px-2 py-2 font-medium">时间</th>
                    <th className="px-2 py-2 font-medium">漏斗</th>
                    <th className="px-2 py-2 font-medium">创建</th>
                    <th className="px-3 py-2 font-medium" aria-label="操作" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-b border-border/60 align-top last:border-0 hover:bg-muted/30">
                      <td className="max-w-[280px] px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <TypePill type={item.type} label={item.typeLabel} />
                          {item.version > 1 ? <span className="rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">v{item.version}</span> : null}
                          {item.isTest ? <span className="rounded bg-warning-visible px-1 py-px text-[10px] text-warning-foreground">测试</span> : null}
                        </div>
                        <Link href={`/platform/announcements/${item.id}`} className="mt-1 block truncate font-medium text-foreground hover:text-primary">
                          {item.title}
                        </Link>
                        <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{item.audienceSummary}</p>
                      </td>
                      <td className="px-2 py-2.5"><StatusPill status={item.status} label={item.statusLabel} /></td>
                      <td className="px-2 py-2.5">
                        <div className="flex flex-col items-start gap-1">
                          <ModePill mode={item.primaryMode} />
                          <span className="text-[10px] text-muted-foreground">优先级 {item.priority}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2.5">
                        <p className="tabular-nums text-foreground">{item.audience.snapshot ?? '—'}</p>
                        <p className="text-[10px] text-muted-foreground">发布时快照</p>
                        <p className="text-[10px] text-muted-foreground">当前数见详情</p>
                      </td>
                      <td className="px-2 py-2.5 text-[11px] text-muted-foreground">
                        <p>开始 {formatWhen(item.startAt)}</p>
                        <p>结束 {formatWhen(item.endAt)}</p>
                      </td>
                      <td className="w-[200px] px-2 py-2.5">
                        <FunnelBar stats={item.stats} audience={item.audience} />
                        <div className="mt-1.5"><CompactMetrics stats={item.stats} /></div>
                      </td>
                      <td className="px-2 py-2.5 text-[11px] text-muted-foreground">
                        <p>{item.createdBy?.name || '平台管理员'}</p>
                        <p>{formatWhen(item.createdAt)}</p>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Link href={`/platform/announcements/${item.id}`} className="text-xs text-primary underline-offset-2 hover:underline">详情</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-2 p-3 lg:hidden">
              {items.map((item) => (
                <Link key={item.id} href={`/platform/announcements/${item.id}`} className="rounded-lg border border-border p-3 transition-colors hover:bg-muted/40">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <TypePill type={item.type} label={item.typeLabel} />
                    <StatusPill status={item.status} label={item.statusLabel} />
                    <ModePill mode={item.primaryMode} />
                    {item.isTest ? <span className="rounded bg-warning-visible px-1 py-px text-[10px] text-warning-foreground">测试</span> : null}
                  </div>
                  <p className="mt-1.5 text-sm font-medium text-foreground">{item.title}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{item.audienceSummary} · 发布时受众 {item.audience.snapshot ?? '—'}（当前数见详情）</p>
                  <div className="mt-2"><FunnelBar stats={item.stats} audience={item.audience} /></div>
                  <div className="mt-2"><CompactMetrics stats={item.stats} /></div>
                  <p className="mt-2 text-[10px] text-muted-foreground">开始 {formatWhen(item.startAt)} · 结束 {formatWhen(item.endAt)}</p>
                </Link>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
