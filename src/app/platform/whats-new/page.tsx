'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Copy, ImageIcon, PauseCircle, PlayCircle, Plus, RefreshCw, Search, SlidersHorizontal, SquarePen } from 'lucide-react'
import { appConfirm, appNotice } from '@/components/AppDialogProvider'
import { Button } from '@/components/ui/button'
import { StatusPill, formatWhen } from '@/components/announcements/AnnouncementUi'
import { apiFetch, apiPost } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { ANNOUNCEMENT_STATUSES, STATUS_LABELS } from '@/lib/announcements/constants'
import type { AdminAnnouncementItem, AnnouncementListResponse } from '@/lib/announcements/admin-types'

const ALL = ''
const inputClass = 'h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring'

function sortTime(item: AdminAnnouncementItem) {
  return new Date(item.publishedAt ?? item.createdAt).getTime()
}

function ReleaseThumb({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [src])

  if (!src || failed) {
    return (
      <div data-whats-new-thumb className="flex h-10 w-[71px] shrink-0 items-center justify-center rounded border border-border bg-muted/40 text-muted-foreground">
        <ImageIcon className="h-4 w-4" aria-hidden />
      </div>
    )
  }

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        data-whats-new-thumb
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        className="h-10 w-[71px] shrink-0 rounded border border-border bg-muted object-cover"
        onError={() => setFailed(true)}
      />
    </>
  )
}

export default function PlatformWhatsNewPage() {
  const router = useRouter()
  const [items, setItems] = useState<AdminAnnouncementItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState(ALL)
  const [includeTest, setIncludeTest] = useState(false)
  const [acting, setActing] = useState<string | null>(null)

  const query = useMemo(() => {
    const params = new URLSearchParams()
    params.set('type', 'RELEASE')
    params.set('limit', '100')
    if (q.trim()) params.set('q', q.trim())
    if (status) params.set('status', status)
    if (includeTest) params.set('includeTest', '1')
    return params.toString()
  }, [includeTest, q, status])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/platform/announcements?${query}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(String(response.status))
      const data = await response.json() as AnnouncementListResponse
      setItems(Array.isArray(data.items) ? data.items.filter((item) => item.type === 'RELEASE') : [])
    } catch {
      setError('新增功能列表读取失败；请刷新重试。')
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 250)
    return () => window.clearTimeout(timer)
  }, [load])

  const sorted = useMemo(
    () => [...items].sort((a, b) => sortTime(b) - sortTime(a)),
    [items],
  )

  const runAction = async (item: AdminAnnouncementItem, action: 'pause' | 'resume' | 'copy') => {
    if (action === 'pause') {
      const confirmed = await appConfirm({
        title: '暂停这条新增功能？',
        message: '暂停后前台「新增功能」面板会立即隐藏它，收件箱留档仍保留。恢复后按开始/结束时间重新计算。',
        confirmLabel: '暂停',
        cancelLabel: '取消',
      })
      if (!confirmed) return
    }

    setActing(`${item.id}:${action}`)
    try {
      const response = await apiPost<{ id: string }>(`/api/platform/announcements/${item.id}/lifecycle`, { action })
      if (action === 'copy') {
        appNotice({ tone: 'success', message: `已复制为 v${item.version + 1} 草稿` })
        router.push(`/platform/whats-new/${response.id}/edit`)
        return
      }
      appNotice({ tone: 'success', message: action === 'pause' ? '新增功能已暂停' : '新增功能已恢复' })
      await load()
    } catch (actionError) {
      appNotice({
        tone: 'error',
        message: actionError instanceof Error ? actionError.message : '操作失败，请稍后重试',
      })
    } finally {
      setActing(null)
    }
  }

  const renderActions = (item: AdminAnnouncementItem) => {
    const busy = Boolean(acting)
    const isDraft = item.status === 'DRAFT'
    const canPause = item.status === 'ACTIVE' || item.status === 'SCHEDULED'
    const canResume = item.status === 'PAUSED'

    return (
      <div className="flex flex-wrap items-center gap-1 lg:justify-end">
        {isDraft ? (
          <Button asChild variant="ghost" size="xs" className="h-7 px-2 text-xs">
            <Link href={`/platform/whats-new/${item.id}/edit`}>
              <SquarePen className="mr-1 h-3 w-3" aria-hidden />
              编辑
            </Link>
          </Button>
        ) : (
          <span className="inline-flex h-7 items-center px-2 text-xs text-muted-foreground/60" title="已发布公告需复制成新版本">编辑</span>
        )}
        <Button type="button" variant="ghost" size="xs" className="h-7 px-2 text-xs" disabled={busy} onClick={() => void runAction(item, 'copy')}>
          <Copy className="mr-1 h-3 w-3" aria-hidden />
          {acting === `${item.id}:copy` ? '复制中…' : '复制'}
        </Button>
        {canPause ? (
          <Button type="button" variant="ghost" size="xs" className="h-7 px-2 text-xs" disabled={busy} onClick={() => void runAction(item, 'pause')}>
            <PauseCircle className="mr-1 h-3 w-3" aria-hidden />
            {acting === `${item.id}:pause` ? '暂停中…' : '暂停'}
          </Button>
        ) : null}
        {canResume ? (
          <Button type="button" variant="ghost" size="xs" className="h-7 px-2 text-xs" disabled={busy} onClick={() => void runAction(item, 'resume')}>
            <PlayCircle className="mr-1 h-3 w-3" aria-hidden />
            {acting === `${item.id}:resume` ? '恢复中…' : '恢复'}
          </Button>
        ) : null}
        <Link href={`/platform/announcements/${item.id}`} className="inline-flex h-7 items-center px-2 text-xs text-primary underline-offset-2 hover:underline">
          详情
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-foreground">新增功能</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            只管理 type=RELEASE 的新增功能；维护/故障/法务/活动仍在「公告」里。发布后会自动出现在工作台左下角「新增功能」面板。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="h-8 px-2.5 text-xs">
            <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', loading && 'animate-spin')} aria-hidden />
            刷新
          </Button>
          <Button asChild size="sm" className="h-8 px-2.5 text-xs">
            <Link href="/platform/whats-new/new">
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              发布新增功能
            </Link>
          </Button>
        </div>
      </div>

      <section className="rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
            筛选
          </span>
          <span className="rounded bg-primary-visible px-1.5 py-0.5 text-[10px] font-medium text-primary">仅 RELEASE</span>
          <label className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="搜索标题或正文"
              aria-label="搜索新增功能"
              className={cn(inputClass, 'w-56 pl-7')}
            />
          </label>
          <select aria-label="按状态筛选" value={status} onChange={(event) => setStatus(event.target.value)} className={inputClass}>
            <option value={ALL}>全部状态</option>
            {ANNOUNCEMENT_STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}
          </select>
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={includeTest} onChange={(event) => setIncludeTest(event.target.checked)} className="accent-[hsl(var(--primary))]" />
            含测试发送
          </label>
          <span className="ml-auto text-[11px] text-muted-foreground">{loading ? '读取中…' : `${items.length} 条`}</span>
        </div>

        {error ? (
          <div className="px-3 py-8 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <button type="button" onClick={() => void load()} className="mt-2 text-xs text-muted-foreground underline underline-offset-2">重试</button>
          </div>
        ) : loading && items.length === 0 ? (
          <div className="flex flex-col gap-2 p-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-16 animate-pulse rounded-md bg-muted/50" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="px-3 py-12 text-center">
            <p className="text-sm font-medium text-foreground">还没有新增功能</p>
            <p className="mt-1 text-xs text-muted-foreground">发布第一条新增功能后，它会出现在这里和工作台面板。</p>
            <Button asChild size="sm" className="mt-3 h-8 px-3 text-xs">
              <Link href="/platform/whats-new/new">发布新增功能</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[920px] border-collapse text-left text-xs">
                <thead className="border-b border-border text-[11px] text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">新增功能</th>
                    <th className="px-2 py-2 font-medium">状态</th>
                    <th className="px-2 py-2 font-medium">发布时间</th>
                    <th className="px-2 py-2 font-medium">受众</th>
                    <th className="px-3 py-2 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((item) => (
                    <tr key={item.id} className="border-b border-border/60 align-top last:border-0 hover:bg-muted/30">
                      <td className="max-w-[420px] px-3 py-2.5">
                        <div className="flex items-center gap-3">
                          <ReleaseThumb src={item.imageUrl} />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1">
                              {item.version > 1 ? <span className="rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">v{item.version}</span> : null}
                              {item.isTest ? <span className="rounded bg-warning-visible px-1 py-px text-[10px] text-warning-foreground">测试</span> : null}
                            </div>
                            <Link href={`/platform/announcements/${item.id}`} className="mt-0.5 block truncate font-medium text-foreground hover:text-primary">
                              {item.title}
                            </Link>
                            <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                              {item.ctaUrl ? `CTA：${item.ctaLabel || '了解详情'}` : '无 CTA'}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2.5"><StatusPill status={item.status} label={item.statusLabel} /></td>
                      <td className="px-2 py-2.5 text-[11px] text-muted-foreground">
                        {item.publishedAt ? formatWhen(item.publishedAt) : '未发布'}
                      </td>
                      <td className="max-w-[220px] px-2 py-2.5 text-[11px] text-muted-foreground">
                        <p className="line-clamp-2">{item.audienceSummary}</p>
                        <p className="mt-0.5">发布时 {item.audience.snapshot ?? '—'} 人</p>
                      </td>
                      <td className="px-3 py-2.5">{renderActions(item)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-2 p-3 lg:hidden">
              {sorted.map((item) => (
                <div key={item.id} className="rounded-lg border border-border p-3">
                  <div className="flex gap-3">
                    <ReleaseThumb src={item.imageUrl} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusPill status={item.status} label={item.statusLabel} />
                        {item.isTest ? <span className="rounded bg-warning-visible px-1 py-px text-[10px] text-warning-foreground">测试</span> : null}
                      </div>
                      <Link href={`/platform/announcements/${item.id}`} className="mt-1 block text-sm font-medium text-foreground">
                        {item.title}
                      </Link>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {item.publishedAt ? formatWhen(item.publishedAt) : '未发布'} · {item.audienceSummary}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2">{renderActions(item)}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  )
}