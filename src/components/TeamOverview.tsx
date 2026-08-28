'use client'

import { useEffect, useMemo, useState } from 'react'
import { Activity, Check, CircleDot, FolderKanban, HardDrive, Users } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { apiFetch } from '@/lib/api-client'
import { InitialsAvatar } from '@/components/InitialsAvatar'

type OverviewData = {
  team: { name: string; avatarUrl: string | null; createdAt: string }
  quota: { maxMembers: number; maxProjects: number; maxVideos: number; maxStorageGB: number }
  usage: { members: number; projects: number; videos: number; usedBytes: string; recycleBinBytes: string }
  projects: Array<{
    id: string
    title: string
    status: string
    createdAt: string
    updatedAt: string
    _count: { videos: number; members: number }
  }>
}

function formatBytes(value: string | number) {
  const bytes = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const amount = bytes / 1024 ** index
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(2)} ${units[index]}`
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
}

const WORKFLOW_STEPS = ['待审阅', '审阅中', '意见汇总完毕', '通过']

function DonutChart({ percent }: { percent: number }) {
  const radius = 45
  const circumference = 2 * Math.PI * radius
  const dash = (Math.min(100, Math.max(0, percent)) / 100) * circumference

  return (
    <div className="relative h-36 w-36 shrink-0" aria-label={`已使用 ${percent.toFixed(0)}%`} role="img">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth="14" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="14"
          strokeLinecap="butt"
          strokeDasharray={`${dash} ${circumference - dash}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <strong className="text-xl font-semibold tabular-nums">{percent.toFixed(0)}%</strong>
        <span className="text-xs text-muted-foreground">已使用</span>
      </div>
    </div>
  )
}

export default function TeamOverview({ teamId, showHeading = true }: { teamId: string; showHeading?: boolean }) {
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    apiFetch(`/api/teams/${teamId}/overview`)
      .then(async (response) => {
        if (!response.ok) throw new Error('团队概览加载失败')
        return response.json() as Promise<OverviewData>
      })
      .then((next) => {
        if (!cancelled) setData(next)
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '团队概览加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [teamId])

  const usedBytes = data ? Number(data.usage.usedBytes) : 0
  const capacityBytes = data ? data.quota.maxStorageGB * 1024 ** 3 : 0
  const usedPercent = capacityBytes > 0 ? Math.min(100, (usedBytes / capacityBytes) * 100) : 0
  const stats = data
    ? [
        { label: '团队席位', value: `${data.usage.members} / ${data.quota.maxMembers}`, icon: Users },
        { label: '团队容量', value: `${formatBytes(usedBytes)} / ${data.quota.maxStorageGB} GB`, icon: HardDrive },
        { label: '团队项目', value: `${data.usage.projects} 个`, icon: FolderKanban },
        { label: '视频数量', value: `${data.usage.videos} 个`, icon: Activity },
      ]
    : []

  const legend = useMemo(() => (data ? [
    ['项目占用', formatBytes(usedBytes), 'bg-primary'],
    ['回收站占用', formatBytes(data.usage.recycleBinBytes), 'bg-muted-foreground'],
  ] : []), [data, usedBytes])

  return (
    <section aria-labelledby="team-overview-heading" className="space-y-4">
      {showHeading && <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">团队管理</p>
          <h2 id="team-overview-heading" className="mt-1 text-xl font-semibold tracking-normal">团队概览</h2>
        </div>
        {data && <span className="text-xs text-muted-foreground">创建于 {formatDate(data.team.createdAt)}</span>}
      </div>}

      {loading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="正在加载团队概览">
          {[1, 2, 3, 4].map((item) => <div key={item} className="h-24 animate-pulse rounded-lg border border-border bg-muted/40" />)}
        </div>
      )}
      {error && <div className="rounded-lg border border-destructive/30 bg-destructive-visible p-3 text-sm text-destructive">{error}</div>}

      {data && (
        <>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">团队信息</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-[minmax(220px,1.15fr)_repeat(4,minmax(120px,1fr))] sm:items-center">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-primary text-2xl font-semibold text-primary-foreground">
                  <InitialsAvatar name={data.team.name} src={data.team.avatarUrl} size="lg" isInternal />
                </div>
                <div className="min-w-0"><p className="truncate text-base font-semibold">{data.team.name}</p><p className="mt-1 text-xs text-muted-foreground">当前团队</p></div>
              </div>
              {stats.map(({ label, value, icon: Icon }) => (
                <div key={label} className="border-l border-border pl-4">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</div>
                  <p className="mt-1 text-lg font-medium tabular-nums">{value}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.2fr)]">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">容量使用情况</CardTitle></CardHeader>
              <CardContent>
                <div className="flex items-center gap-5"><DonutChart percent={usedPercent} /><div><p className="text-2xl font-semibold tabular-nums">{formatBytes(usedBytes)}</p><p className="mt-1 text-sm text-muted-foreground">剩余 {formatBytes(Math.max(0, capacityBytes - usedBytes))}</p></div></div>
                <div className="mt-5 space-y-2.5 text-sm">{legend.map(([label, value, color]) => <div key={label} className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-muted-foreground"><span className={`h-2.5 w-2.5 rounded-sm ${color}`} />{label}</span><span className="tabular-nums">{value}</span></div>)}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-base">活跃项目</CardTitle><span className="text-xs text-muted-foreground">最近更新</span></CardHeader>
              <CardContent>{data.projects.length === 0 ? <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">暂无活跃项目</div> : <div className="divide-y divide-border">{data.projects.map((project) => <div key={project.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 first:pt-1 last:pb-1"><div className="min-w-0"><p className="truncate text-sm font-medium">{project.title}</p><p className="mt-1 text-xs text-muted-foreground">{project._count.videos} 个视频 · {project._count.members} 位成员</p></div><time className="text-xs tabular-nums text-muted-foreground" dateTime={project.updatedAt}>{formatDate(project.updatedAt)}</time></div>)}</div>}</CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">流程管理</CardTitle></CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-0" aria-label="默认审阅流程">
                {WORKFLOW_STEPS.map((step, index) => (
                  <div key={step} className="flex min-w-0 flex-1 items-center gap-2 md:gap-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${index === WORKFLOW_STEPS.length - 1 ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600' : 'border-primary/30 bg-primary-visible text-primary'}`}>
                        {index === WORKFLOW_STEPS.length - 1 ? <Check className="h-4 w-4" /> : <CircleDot className="h-4 w-4" />}
                      </span>
                      <span className="truncate text-sm font-medium">{step}</span>
                    </div>
                    {index < WORKFLOW_STEPS.length - 1 && <span className="mx-3 h-px flex-1 bg-border md:min-w-8" aria-hidden="true" />}
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">团队项目默认使用此审阅流程，项目内可继续按视频设置具体状态。</p>
            </CardContent>
          </Card>
        </>
      )}
    </section>
  )
}
