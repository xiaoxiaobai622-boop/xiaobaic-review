'use client'

import { formatBeijingDateTime } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { MODE_LABELS, TYPE_LABELS } from '@/lib/announcements/constants'
import type { EventTotalView, ListStatsView } from '@/lib/announcements/admin-types'

const STATUS_TONE: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  SCHEDULED: 'bg-warning-visible text-warning-foreground',
  ACTIVE: 'bg-success-visible text-success',
  PAUSED: 'bg-warning-visible text-warning-foreground',
  EXPIRED: 'bg-muted text-muted-foreground',
  ARCHIVED: 'border border-border bg-transparent text-muted-foreground',
}

export function StatusPill({ status, label }: { status: string; label?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium', STATUS_TONE[status] || STATUS_TONE.DRAFT)}>
      {label || status}
    </span>
  )
}

export function TypePill({ type, label }: { type: string; label?: string }) {
  const urgent = type === 'INCIDENT' || type === 'MAINTENANCE'
  const legal = type === 'LEGAL'
  return (
    <span className={cn(
      'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium',
      urgent && 'bg-destructive-visible text-destructive',
      legal && 'bg-warning-visible text-warning-foreground',
      !urgent && !legal && 'bg-primary-visible text-primary',
    )}>
      {label || TYPE_LABELS[type as keyof typeof TYPE_LABELS] || type}
    </span>
  )
}

export function ModePill({ mode }: { mode: string }) {
  return <span className="inline-flex items-center rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">{MODE_LABELS[mode as keyof typeof MODE_LABELS] || mode}</span>
}

export function formatRate(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `${(value * 100).toFixed(value > 0 && value < 0.1 ? 1 : 0)}%`
}

export function formatWhen(value: string | null | undefined): string {
  return value ? formatBeijingDateTime(value) : '—'
}

export function FunnelBar({ stats, audience, className }: {
  stats: ListStatsView
  audience: { current: number | null; snapshot?: number | null }
  className?: string
}) {
  // The admin list has no per-row current-audience query (N+1), so it falls back
  // to the publish-time snapshot for the visual denominator. The label makes the
  // source explicit; the detail page renders the current count separately.
  const usingSnapshot = audience.current === null && audience.snapshot != null
  const current = audience.current ?? audience.snapshot ?? null
  if (current === null) {
    return <span className={cn('text-xs text-muted-foreground', className)}>受众未知</span>
  }
  if (current <= 0) {
    return <span className={cn('text-xs text-muted-foreground', className)}>受众 0</span>
  }
  const width = (value: number) => `${Math.max(0, Math.min(100, (value / current) * 100))}%`
  return (
    <div className={cn('min-w-[96px]', className)}>
      <div
        className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`曝光 ${stats.impressions.users} 人，已读 ${stats.reads.users} 人，已知晓 ${stats.acks.users} 人，${usingSnapshot ? '发布时受众' : '当前受众'} ${current} 人`}
      >
        <span className="h-full bg-muted-foreground/35" style={{ width: width(stats.impressions.users) }} />
        <span className="h-full bg-primary" style={{ width: width(stats.reads.users) }} />
        <span className="h-full bg-success" style={{ width: width(stats.acks.users) }} />
      </div>
    </div>
  )
}

export function CompactMetrics({ stats }: { stats: ListStatsView }) {
  return (
    <div className="grid grid-cols-4 gap-2 text-center">
      {([
        ['曝光', stats.impressions],
        ['已读', stats.reads],
        ['已知晓', stats.acks],
        ['点击', stats.clicks],
      ] as Array<[string, EventTotalView]>).map(([label, value]) => (
        <div key={label} className="rounded bg-muted/50 px-1 py-1">
          <p className="text-[10px] text-muted-foreground">{label}</p>
          <p className="text-xs font-semibold text-foreground">{value.events}</p>
          <p className="text-[10px] text-muted-foreground">{value.users} 人</p>
        </div>
      ))}
    </div>
  )
}

export function FunnelRows({ stats, audience }: {
  stats: ListStatsView
  audience: { current: number | null }
}) {
  const rows: Array<{ label: string; total: EventTotalView; rate: number | null; tone: string }> = [
    { label: '曝光', total: stats.impressions, rate: stats.rates.impression, tone: 'bg-muted-foreground/40' },
    { label: '已读', total: stats.reads, rate: stats.rates.read, tone: 'bg-primary' },
    { label: '已知晓', total: stats.acks, rate: stats.rates.ack, tone: 'bg-success' },
    { label: '点击', total: stats.clicks, rate: stats.rates.click, tone: 'bg-warning' },
    { label: '关闭', total: stats.dismisses, rate: stats.rates.dismiss, tone: 'bg-destructive' },
  ]
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => {
        const pct = row.rate === null ? 0 : Math.max(0, Math.min(100, row.rate * 100))
        return (
          <div key={row.label} className="grid grid-cols-[64px_1fr_112px] items-center gap-2 text-xs">
            <span className="text-muted-foreground">{row.label}</span>
            <span className="h-2 overflow-hidden rounded-full bg-muted">
              <span className={cn('block h-full rounded-full', row.tone)} style={{ width: `${pct}%` }} />
            </span>
            <span className="text-right tabular-nums text-foreground">
              {row.total.users} 人 / {row.total.events} 次
              <span className="ml-1 text-muted-foreground">{formatRate(row.rate)}</span>
            </span>
          </div>
        )
      })}
      <p className="text-[11px] text-muted-foreground">比率分母为当前解析受众（{audience.current === null ? '未知' : audience.current} 人）。</p>
    </div>
  )
}
