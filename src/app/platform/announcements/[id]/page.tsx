'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Archive, Copy, PauseCircle, PlayCircle, RefreshCw, Send, SquarePen, Users } from 'lucide-react'
import { appConfirm, appNotice } from '@/components/AppDialogProvider'
import { Button } from '@/components/ui/button'
import {
  FunnelRows,
  ModePill,
  StatusPill,
  TypePill,
  formatRate,
  formatWhen,
} from '@/components/announcements/AnnouncementUi'
import { apiFetch, apiPost } from '@/lib/api-client'
import { formatBeijingDateTime } from '@/lib/utils'
import {
  ACTIVE_STATUS_LABELS,
  AUDIENCE_KIND_LABELS,
  EVENT_LABELS,
  LOCALE_LABELS,
  MODE_LABELS,
  RULE_MODE_LABELS,
  TEAM_ROLE_LABELS,
} from '@/lib/announcements/constants'
import type {
  AdminAnnouncementDetail,
  AudiencePreview,
  AudienceRuleView,
  AuditLogView,
  FullStatsView,
  ListStatsView,
} from '@/lib/announcements/admin-types'

const ACTION_LABELS: Record<string, string> = {
  CREATE: '创建',
  UPDATE: '编辑',
  PUBLISH: '发布',
  PAUSE: '暂停',
  RESUME: '恢复',
  ARCHIVE: '归档',
  COPY: '复制',
  TEST_SEND: '测试发送',
  KILL_SWITCH: 'kill switch',
  CONTROL_UPDATE: '频率配置',
}

function ruleValueLabel(rule: AudienceRuleView): string {
  if (rule.kind === 'ALL') return '全员'
  if (!rule.value) return '未设置'
  if (rule.kind === 'ROLE') return TEAM_ROLE_LABELS[rule.value] || rule.value
  if (rule.kind === 'LOCALE') return LOCALE_LABELS[rule.value] || rule.value
  if (rule.kind === 'ACTIVE_STATUS') return ACTIVE_STATUS_LABELS[rule.value as keyof typeof ACTIVE_STATUS_LABELS] || rule.value
  return rule.value
}

function toListStats(stats: FullStatsView): ListStatsView {
  return {
    impressions: stats.totals.IMPRESSION,
    reads: stats.totals.READ,
    acks: stats.totals.ACK,
    clicks: stats.totals.CLICK,
    dismisses: stats.totals.DISMISS,
    rates: stats.rates,
  }
}

function dayRows(stats: FullStatsView) {
  const map = new Map<string, Record<string, number>>()
  for (const row of stats.byDay) {
    const current = map.get(row.day) ?? { IMPRESSION: 0, READ: 0, ACK: 0, CLICK: 0, DISMISS: 0 }
    current[row.type] = (current[row.type] || 0) + row.events
    map.set(row.day, current)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, 14)
}

function AuditDetail({ log }: { log: AuditLogView }) {
  if (!log.detail) return null
  return (
    <details className="mt-1 text-[10px] text-muted-foreground">
      <summary className="cursor-pointer select-none">查看审计详情</summary>
      <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted/50 p-2">{JSON.stringify(log.detail, null, 2)}</pre>
    </details>
  )
}

export default function AnnouncementDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = Array.isArray(params?.id) ? params.id[0] : String(params?.id || '')
  const [data, setData] = useState<AdminAnnouncementDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [acting, setActing] = useState<string | null>(null)
  const [modeFilter, setModeFilter] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [sample, setSample] = useState<AudiencePreview | null>(null)
  const [sampleLoading, setSampleLoading] = useState(false)

  const query = useMemo(() => {
    const search = new URLSearchParams()
    if (modeFilter) search.set('mode', modeFilter)
    if (from) search.set('from', new Date(`${from}T00:00:00+08:00`).toISOString())
    if (to) search.set('to', new Date(`${to}T23:59:59+08:00`).toISOString())
    return search.toString()
  }, [from, modeFilter, to])

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/platform/announcements/${id}${query ? `?${query}` : ''}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(String(response.status))
      const next = await response.json() as AdminAnnouncementDetail
      setData(next)
    } catch {
      setError('公告读取失败；统计失败不能显示成 0，请刷新重试。')
    } finally {
      setLoading(false)
    }
  }, [id, query])

  useEffect(() => { void load() }, [load])

  const refreshSample = useCallback(async () => {
    if (!data) return
    if (data.item.audienceRules.length === 0) {
      setSample(null)
      return
    }
    setSampleLoading(true)
    try {
      const response = await apiPost<AudiencePreview>('/api/platform/announcements/audience', {
        audienceRules: data.item.audienceRules,
        sampleLimit: 8,
      })
      setSample(response)
    } catch (err) {
      appNotice({ tone: 'error', message: err instanceof Error ? err.message : '受众样本解析失败' })
    } finally {
      setSampleLoading(false)
    }
  }, [data])

  useEffect(() => {
    if (!data) return
    void refreshSample()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.item.id])

  const runAction = async (action: 'pause' | 'resume' | 'archive' | 'copy' | 'test') => {
    if (!data) return
    if (action === 'pause') {
      const confirmed = await appConfirm({
        title: '暂停这条公告？',
        message: '横幅/弹窗/轻提示会停止展示，收件箱仍可回看。恢复后按开始/结束时间重新计算状态。',
        confirmLabel: '暂停',
        cancelLabel: '取消',
      })
      if (!confirmed) return
    }
    if (action === 'archive') {
      const confirmed = await appConfirm({
        title: '归档这条公告？',
        message: '归档后不再以横幅/弹窗/轻提示展示，但仍保留在收件箱留档与审计里。',
        confirmLabel: '归档',
        cancelLabel: '取消',
        tone: 'destructive',
      })
      if (!confirmed) return
    }
    setActing(action)
    try {
      const response = await apiPost<{ ok: boolean; id: string; action: string }>(`/api/platform/announcements/${id}/lifecycle`, { action })
      if (action === 'copy') {
        appNotice({ tone: 'success', message: `已复制为 v${data.item.version + 1} 草稿` })
        router.push(`/platform/announcements/${response.id}/edit`)
        return
      }
      if (action === 'test') {
        appNotice({ tone: 'success', message: '测试公告已发送给你，到工作台左侧通知栏查看。' })
      } else {
        appNotice({ tone: 'success', message: {
          pause: '公告已暂停',
          resume: '公告已恢复',
          archive: '公告已归档',
        }[action] })
      }
      await load()
    } catch (err) {
      appNotice({ tone: 'error', message: err instanceof Error ? err.message : '操作失败，请稍后重试' })
    } finally {
      setActing(null)
    }
  }

  if (loading && !data) {
    return (
      <div className="flex flex-col gap-3">
        <div className="h-7 w-40 animate-pulse rounded bg-muted" />
        <div className="h-10 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-56 animate-pulse rounded-lg bg-muted/50" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive-visible p-4 text-sm text-destructive">
        <p>{error || '公告不存在'}</p>
        <div className="mt-3 flex gap-2">
          <Button asChild variant="outline" size="sm" className="h-8 px-3 text-xs"><Link href="/platform/announcements">返回列表</Link></Button>
          <Button type="button" size="sm" onClick={() => void load()} className="h-8 px-3 text-xs">重试</Button>
        </div>
      </div>
    )
  }

  const item = data.item
  const filteredStats = toListStats(data.stats)
  const days = dayRows(data.stats)
  const canPause = item.status === 'ACTIVE' || item.status === 'SCHEDULED'
  const canResume = item.status === 'PAUSED'
  const canArchive = item.status !== 'ARCHIVED'
  const isDraft = item.status === 'DRAFT'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/platform/announcements" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            返回公告列表
          </Link>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <TypePill type={item.type} label={item.typeLabel} />
            <StatusPill status={item.status} label={item.statusLabel} />
            <ModePill mode={item.primaryMode} />
            {item.version > 1 ? <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">v{item.version}</span> : null}
            {item.isTest ? <span className="rounded bg-warning-visible px-1.5 py-0.5 text-[11px] text-warning-foreground">测试发送</span> : null}
          </div>
          <h1 className="mt-1.5 text-xl font-semibold text-foreground">{item.title}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            创建 {item.createdBy?.name || '平台管理员'} · {formatWhen(item.createdAt)} · 发布 {formatWhen(item.publishedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isDraft ? (
            <Button asChild size="sm" className="h-8 px-2.5 text-xs">
              <Link href={`/platform/announcements/${item.id}/edit`}>
                <SquarePen className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                编辑并发布
              </Link>
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={() => void runAction('test')} disabled={Boolean(acting)} className="h-8 px-2.5 text-xs">
            <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            测试发送
          </Button>
          {canPause ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void runAction('pause')} disabled={Boolean(acting)} className="h-8 px-2.5 text-xs">
              <PauseCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              暂停
            </Button>
          ) : null}
          {canResume ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void runAction('resume')} disabled={Boolean(acting)} className="h-8 px-2.5 text-xs">
              <PlayCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              恢复
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={() => void runAction('copy')} disabled={Boolean(acting)} className="h-8 px-2.5 text-xs">
            <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            复制新版本
          </Button>
          {canArchive ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void runAction('archive')} disabled={Boolean(acting)} className="h-8 px-2.5 text-xs">
              <Archive className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              归档
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-4">
          <section className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-2.5">
              <h2 className="text-sm font-semibold text-foreground">内容</h2>
            </div>
            <div className="p-4">
              {item.imageUrl ? (
                <div className="mb-3 overflow-hidden rounded-md border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.imageUrl} alt="公告图片" className="max-h-64 w-full object-cover" />
                </div>
              ) : null}
              <div className="whitespace-pre-line break-words text-sm leading-6 text-foreground">{item.content}</div>
              {item.ctaLabel && item.ctaUrl ? (
                <a
                  href={item.ctaUrl}
                  target={/^https?:\/\//i.test(item.ctaUrl) ? '_blank' : undefined}
                  rel={/^https?:\/\//i.test(item.ctaUrl) ? 'noopener noreferrer' : undefined}
                  className="mt-3 inline-flex rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                >
                  {item.ctaLabel}
                </a>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                <span>语言 {LOCALE_LABELS[item.locale] || item.locale}</span>
                <span>优先级 {item.priority}</span>
                <span>开始 {formatWhen(item.startAt)}</span>
                <span>结束 {formatWhen(item.endAt)}</span>
                <span>{item.ackRequired ? '要求已知晓' : '不要求已知晓'}</span>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
              <Users className="h-4 w-4 text-primary" aria-hidden />
              <h2 className="text-sm font-semibold text-foreground">受众</h2>
              <span className="text-[11px] text-muted-foreground">{item.audienceSummary}</span>
              <button type="button" onClick={() => void refreshSample()} disabled={sampleLoading} className="ml-auto text-[11px] text-primary underline-offset-2 hover:underline disabled:opacity-50">
                {sampleLoading ? '解析中…' : '重新解析样本'}
              </button>
            </div>
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">受众数</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                  {item.audience.snapshot ?? '—'} <span className="text-sm font-normal text-muted-foreground">发布时快照</span>
                </p>
                <p className="text-sm tabular-nums text-foreground">
                  {item.audience.current ?? '—'} <span className="text-xs font-normal text-muted-foreground">当前解析</span>
                </p>
                {item.audience.error ? <p className="mt-1 text-[11px] text-destructive">{item.audience.error}</p> : null}
                <p className="mt-1 text-[10px] text-muted-foreground">两个数不混为一个；发布时写入快照。</p>
              </div>
              <div className="flex flex-col gap-1">
                {item.audienceRules.length === 0 ? (
                  <p className="text-xs text-muted-foreground">旧数据：{item.broadcast ? '全员' : '定向单个用户'}</p>
                ) : item.audienceRules.map((rule, index) => (
                  <div key={`${rule.kind}-${rule.value}-${rule.mode}-${index}`} className="flex items-center gap-2 text-xs">
                    <span className={rule.mode === 'EXCLUDE' ? 'text-destructive' : 'text-primary'}>{RULE_MODE_LABELS[rule.mode as keyof typeof RULE_MODE_LABELS] || rule.mode}</span>
                    <span className="text-muted-foreground">{AUDIENCE_KIND_LABELS[rule.kind as keyof typeof AUDIENCE_KIND_LABELS] || rule.kind}</span>
                    <span className="min-w-0 truncate text-foreground">{ruleValueLabel(rule)}</span>
                  </div>
                ))}
              </div>
            </div>
            {sample?.audience.sample.length ? (
              <div className="flex flex-wrap gap-1 border-t border-border px-4 py-2.5">
                {sample.audience.sample.map((user) => (
                  <span key={user.id} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {user.name}{user.contact ? ` · ${user.contact}` : ''}{user.teamName ? ` · ${user.teamName}` : ''}
                  </span>
                ))}
              </div>
            ) : null}
          </section>
        </div>

        <div className="flex flex-col gap-4">
          <section className="rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
              <h2 className="text-sm font-semibold text-foreground">统计</h2>
              <span className="text-[10px] text-muted-foreground">按北京日期</span>
              <button type="button" onClick={() => void load()} className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                <RefreshCw className="h-3 w-3" aria-hidden />
                刷新
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
              <select aria-label="统计按主模式筛选" value={modeFilter} onChange={(event) => setModeFilter(event.target.value)} className="h-7 rounded border border-border bg-background px-2 text-xs text-foreground">
                <option value="">全部模式</option>
                {Object.entries(MODE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <input type="date" aria-label="统计开始日期" value={from} onChange={(event) => setFrom(event.target.value)} className="h-7 rounded border border-border bg-background px-2 text-xs text-foreground" />
              <span className="text-[10px] text-muted-foreground">至</span>
              <input type="date" aria-label="统计结束日期" value={to} onChange={(event) => setTo(event.target.value)} className="h-7 rounded border border-border bg-background px-2 text-xs text-foreground" />
            </div>
            <div className="p-4">
              {data.stats.audience.error ? (
                <p className="mb-2 text-xs text-destructive">{data.stats.audience.error}，比率显示为 —。</p>
              ) : null}
              <FunnelRows stats={filteredStats} audience={data.stats.audience} />
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-2.5">
              <h2 className="text-sm font-semibold text-foreground">按模式</h2>
            </div>
            <div className="p-4">
              {data.stats.byMode.length === 0 ? (
                <p className="text-xs text-muted-foreground">还没有事件。</p>
              ) : (
                <table className="w-full text-left text-[11px]">
                  <thead className="text-muted-foreground">
                    <tr><th className="py-1 font-medium">模式</th><th className="py-1 font-medium">事件</th><th className="py-1 text-right font-medium">次数</th><th className="py-1 text-right font-medium">人数</th></tr>
                  </thead>
                  <tbody>
                    {data.stats.byMode.map((row) => (
                      <tr key={`${row.mode}-${row.type}`} className="border-t border-border/60">
                        <td className="py-1">{MODE_LABELS[row.mode as keyof typeof MODE_LABELS] || row.mode}</td>
                        <td className="py-1">{EVENT_LABELS[row.type as keyof typeof EVENT_LABELS] || row.type}</td>
                        <td className="py-1 text-right tabular-nums">{row.events}</td>
                        <td className="py-1 text-right tabular-nums">{row.users}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-2.5">
              <h2 className="text-sm font-semibold text-foreground">按天（最近 14 个有事件的日期）</h2>
            </div>
            <div className="p-4">
              {days.length === 0 ? (
                <p className="text-xs text-muted-foreground">还没有事件。</p>
              ) : (
                <table className="w-full text-left text-[11px]">
                  <thead className="text-muted-foreground">
                    <tr><th className="py-1 font-medium">日期</th><th className="py-1 text-right font-medium">曝光</th><th className="py-1 text-right font-medium">已读</th><th className="py-1 text-right font-medium">已知晓</th><th className="py-1 text-right font-medium">点击</th></tr>
                  </thead>
                  <tbody>
                    {days.map(([day, counts]) => (
                      <tr key={day} className="border-t border-border/60">
                        <td className="py-1 tabular-nums">{day}</td>
                        <td className="py-1 text-right tabular-nums">{counts.IMPRESSION || 0}</td>
                        <td className="py-1 text-right tabular-nums">{counts.READ || 0}</td>
                        <td className="py-1 text-right tabular-nums">{counts.ACK || 0}</td>
                        <td className="py-1 text-right tabular-nums">{counts.CLICK || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="mt-2 text-[10px] text-muted-foreground">曝光/点击按用户+模式+北京日期去重；已读/已知晓/关闭只记第一次。</p>
            </div>
          </section>
        </div>
      </div>

      <section className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold text-foreground">审计</h2>
        </div>
        <div className="flex flex-col gap-2 p-4">
          {data.audit.length === 0 ? (
            <p className="text-xs text-muted-foreground">还没有审计记录。</p>
          ) : data.audit.map((log) => (
            <div key={log.id} className="rounded-md border border-border/60 px-2.5 py-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium text-foreground">{ACTION_LABELS[log.action] || log.action}</span>
                <span className="text-muted-foreground">{log.actorLabel}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">{formatBeijingDateTime(log.createdAt)}</span>
              </div>
              <AuditDetail log={log} />
            </div>
          ))}
        </div>
      </section>

      <p className="text-[11px] text-muted-foreground">
        已读率 {formatRate(item.stats.rates.read)} · 已知晓率 {formatRate(item.stats.rates.ack)} · 曝光率 {formatRate(item.stats.rates.impression)} · 点击率 {formatRate(item.stats.rates.click)} · 关闭率 {formatRate(item.stats.rates.dismiss)}
      </p>
    </div>
  )
}
