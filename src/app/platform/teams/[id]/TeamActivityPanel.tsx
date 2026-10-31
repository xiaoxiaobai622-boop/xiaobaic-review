'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { ActivityBucket, TeamActivityPage } from '@/lib/platform-team-360'
import { formatBeijingDateTime, formatFileSize } from '@/lib/utils'
import { platformJson } from './team-panel-utils'

type MetricKey = 'newVideos' | 'uploadBytes' | 'comments' | 'visits' | 'shareSessions' | 'activeMembers'
const METRICS: Array<{ key: MetricKey; label: string; minWidth: number }> = [
  { key: 'newVideos', label: '上传素材', minWidth: 72 },
  { key: 'uploadBytes', label: '上传量', minWidth: 92 },
  { key: 'comments', label: '批注', minWidth: 60 },
  { key: 'visits', label: '外部访问', minWidth: 80 },
  { key: 'shareSessions', label: '独立会话', minWidth: 76 },
  { key: 'activeMembers', label: '活跃成员', minWidth: 76 },
]

function valueOf(bucket: ActivityBucket, key: MetricKey): number | null {
  return bucket[key]
}

function ActivityCell({ value, peak }: { value: number | null; peak: number }) {
  if (value === null) return <td className="relative py-1.5 pr-3 text-right text-xs text-muted-foreground">—</td>
  const percent = peak > 0 ? (value / peak) * 100 : 0
  return (
    <td className="relative py-1.5 pr-3 text-right">
      {value > 0 && <span aria-hidden="true" className="absolute inset-y-1 right-2 rounded-sm bg-primary/10" style={{ width: `${Math.max(3, percent)}%` }} />}
      <span className={`relative tabular-nums ${value === 0 ? 'text-muted-foreground' : 'font-medium'}`}>{value}</span>
    </td>
  )
}

export default function TeamActivityPanel({ teamId }: { teamId: string }) {
  const [days, setDays] = useState<7 | 30>(7)
  const [data, setData] = useState<TeamActivityPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await platformJson<TeamActivityPage>(`/api/platform/teams/${teamId}/activity?days=${days}`))
    } catch (reason) {
      setData(null)
      setError(reason instanceof Error ? reason.message : '活跃趋势读取失败')
    } finally {
      setLoading(false)
    }
  }, [days, teamId])

  useEffect(() => { void load() }, [load])

  const peaks = Object.fromEntries(METRICS.map((metric) => [
    metric.key,
    (data?.buckets || []).reduce((max, bucket) => Math.max(max, valueOf(bucket, metric.key) ?? 0), 0),
  ])) as Record<MetricKey, number>

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">活跃趋势</h2>
          <p className="mt-1 text-xs text-muted-foreground">北京日切分；上传素材/上传量按发生量统计，含已进回收站的历史上传。成员心跳上线前的日子不伪装成 0。</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1" role="group" aria-label="统计窗口">
            {[7, 30].map((size) => (
              <button key={size} type="button" aria-pressed={days === size} onClick={() => setDays(size as 7 | 30)} className={`rounded-md border px-2.5 py-1 text-xs ${days === size ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-border text-muted-foreground hover:bg-muted/50'}`}>{size} 天</button>
            ))}
          </div>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"><RefreshCw className="h-3.5 w-3.5" />刷新</button>
        </div>
      </div>

      {error && <div role="alert" className="mt-3 rounded-md border border-destructive/30 bg-destructive-visible p-3 text-sm text-destructive">{error}</div>}

      {loading ? (
        <div className="mt-3 space-y-2" aria-busy="true"><span className="sr-only" role="status" aria-live="polite">正在加载活跃趋势</span>{[0, 1, 2].map((index) => <div key={index} className="skeleton h-10 rounded-md" />)}</div>
      ) : !data ? (
        <p className="mt-3 py-8 text-center text-sm text-muted-foreground">活跃趋势读取失败，这里不显示 0。</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>成员心跳：{data.collected.activeMembers ? (data.collected.heartbeatSince ? `自 ${formatBeijingDateTime(data.collected.heartbeatSince)} 起` : '已采集') : '未采集'}</span>
            <span>窗口 {data.days} 天</span>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="border-y border-border bg-muted/40 text-left text-xs text-muted-foreground"><th className="py-2 pr-4 font-medium">日期（北京）</th>{METRICS.map((metric) => <th key={metric.key} className="py-2 pr-3 text-right font-medium" style={{ minWidth: metric.minWidth }}>{metric.label}</th>)}</tr></thead>
              <tbody>
                {data.buckets.map((bucket) => (
                  <tr key={bucket.day} className="border-b border-border/60 last:border-0">
                    <td className="py-1.5 pr-4 text-xs tabular-nums">{bucket.day}</td>
                    {METRICS.map((metric) => (
                      metric.key === 'uploadBytes'
                        ? <td key={metric.key} className="relative py-1.5 pr-3 text-right text-xs tabular-nums">{bucket.uploadBytes ? formatFileSize(bucket.uploadBytes) : '0 B'}</td>
                        : <ActivityCell key={metric.key} value={valueOf(bucket, metric.key)} peak={peaks[metric.key]} />
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t border-border text-xs font-medium"><td className="py-2 pr-4">合计</td>{METRICS.map((metric) => <td key={metric.key} className="py-2 pr-3 text-right tabular-nums">{metric.key === 'activeMembers' && !data.collected.activeMembers ? '—' : metric.key === 'uploadBytes' ? formatFileSize((data.buckets || []).reduce((total, bucket) => total + bucket.uploadBytes, 0)) : (data.buckets || []).reduce((total, bucket) => total + (bucket[metric.key] ?? 0), 0)}</td>)}</tr></tfoot>
            </table>
          </div>
          <ul className="mt-3 space-y-1 text-[11px] text-muted-foreground">
            {data.notes.map((note) => <li key={note}>· {note}</li>)}
          </ul>
        </>
      )}
    </section>
  )
}
