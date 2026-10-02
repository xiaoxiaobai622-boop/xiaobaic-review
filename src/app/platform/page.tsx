'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Building2, CheckCircle2, FolderKanban, HardDrive, Users } from 'lucide-react'
import { usePlatformAuth } from '@/components/PlatformAuthProvider'
import { getPlatformAccessToken } from '@/lib/platform-token-store'
import { formatFileSize } from '@/lib/utils'
import type { DailyUsage, PlatformUsage } from '@/lib/platform-usage'

function formatExpiry(team: any) {
  // 免费内测期没有到期日：库里的旧到期日不再对外报倒计时。
  if (team.status === 'DISABLED') return '已停用'
  return '长期有效'
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

// day 是「北京日」字符串，用 new Date(day) 会在负时区浏览器里退一天，所以按 UTC 分量构造再取 UTC 星期。
function weekdayOf(day: string) {
  const [year, month, date] = day.split('-').map(Number)
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, date)).getUTCDay()]
}

// createdAt 是 UTC 时刻，而日期列按北京日切分；建团那列也走 +8h 才和同一页的使用量对得上。
function beijingDate(value: string) {
  const shifted = new Date(new Date(value).getTime() + 8 * 60 * 60 * 1000)
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const date = String(shifted.getUTCDate()).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${month}-${date}`
}

type MetricKey = 'newVideos' | 'uploadBytes' | 'newProjects' | 'newUsers' | 'comments' | 'visits' | 'activeProjects' | 'shareSessions'

const METRICS: Array<{ key: MetricKey; label: string; minWidth: number }> = [
  { key: 'newVideos', label: '上传素材', minWidth: 72 },
  { key: 'uploadBytes', label: '上传量', minWidth: 92 },
  { key: 'newProjects', label: '新建项目', minWidth: 72 },
  { key: 'newUsers', label: '新用户', minWidth: 60 },
  { key: 'comments', label: '批注', minWidth: 60 },
  { key: 'visits', label: '访问', minWidth: 72 },
  { key: 'activeProjects', label: '活跃项目', minWidth: 72 },
  { key: 'shareSessions', label: '独立会话', minWidth: 72 },
]

const sumOver = (days: DailyUsage[], key: MetricKey) => days.reduce((total, day) => total + day[key], 0)

/** 环比固定指「近 7 天 vs 前 7 天」，所以窗口不足 14 天就没有这一句；前 7 天为 0 时不算百分比，否则除零会印 Infinity。 */
function weekOverWeek(days: DailyUsage[], key: MetricKey) {
  if (days.length < 14) return ''
  const recent = sumOver(days.slice(0, 7), key)
  const prior = sumOver(days.slice(7, 14), key)
  if (prior === 0) return recent === 0 ? '无变化' : '本周新增'
  const ratio = (recent - prior) / prior
  if (ratio === 0) return '持平'
  return `${ratio > 0 ? '+' : '−'}${Math.abs(Math.round(ratio * 100))}%`
}

function MetricCell({ value, peak, display }: { value: number; peak: number; display: string }) {
  const percent = peak > 0 ? (value / peak) * 100 : 0
  const isPeak = value > 0 && value === peak
  return (
    <td className="relative py-1.5 pr-3 text-right">
      {value > 0 && (
        <span
          aria-hidden="true"
          className={`absolute inset-y-1 right-2 rounded-sm ${isPeak ? 'bg-primary/25' : 'bg-primary/10'}`}
          style={{ width: `${Math.max(3, percent)}%` }}
        />
      )}
      <span className={`relative tabular-nums ${value === 0 ? 'text-muted-foreground' : isPeak ? 'font-medium' : ''}`}>{display}</span>
    </td>
  )
}

/** 概览卡沿用项目中心那套：36px 图标块 + 一行数字 + 一行标签，警示走 11px 副行。 */
function StatCard({
  icon: Icon, chip, value, label, sub, danger,
}: {
  icon: typeof Users
  chip: string
  value: number | string
  label: string
  sub?: string
  danger?: boolean
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
      <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${chip}`}>
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0">
        <p className="text-xl font-bold leading-tight tabular-nums">{value}</p>
        <p className="truncate text-[12px] text-muted-foreground">{label}</p>
        {sub && <p className={`text-[11px] font-medium ${danger ? 'text-destructive' : 'text-muted-foreground'}`}>{sub}</p>}
      </div>
    </div>
  )
}

export default function PlatformDashboardPage() {
  const { user } = usePlatformAuth()
  const [teams, setTeams] = useState<any[]>([])
  const [dayWindow, setDayWindow] = useState(14)
  const [days, setDays] = useState<DailyUsage[]>([])
  const [storage, setStorage] = useState<PlatformUsage['storage'] | null>(null)
  const [refreshing, setRefreshing] = useState(true)
  const [failed, setFailed] = useState(false)
  const [teamsFailed, setTeamsFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const token = getPlatformAccessToken()
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`
      setRefreshing(true)
      const [teamsResponse, usageResponse] = await Promise.all([
        fetch('/api/platform/teams', { headers }),
        fetch(`/api/platform/usage?days=${dayWindow}`, { headers }),
      ])
      if (cancelled) return
      if (teamsResponse.ok) {
        const data = await teamsResponse.json()
        setTeams((data.teams || []).map((team: any) => ({ ...team, expiryLabel: formatExpiry(team) })))
        setTeamsFailed(false)
      } else {
        // 读失败时清空并把四枚统计卡换成一句话：留着 0 会被读成「平台上没有任何团队」，
        // 而真实原因多半只是令牌过期。
        setTeams([])
        setTeamsFailed(true)
      }
      if (usageResponse.ok) {
        const data = (await usageResponse.json()) as PlatformUsage
        setDays(data.days || [])
        setStorage(data.storage ?? null)
        setFailed(false)
      } else {
        setFailed(true)
      }
      setRefreshing(false)
    })()
    return () => {
      cancelled = true
    }
  }, [dayWindow])

  const peaks = Object.fromEntries(
    METRICS.map((metric) => [metric.key, days.reduce((max, day) => Math.max(max, day[metric.key]), 0)]),
  ) as Record<MetricKey, number>
  const liveBytes = storage?.liveBytes ?? 0
  const binBytes = storage?.recycleBinBytes ?? 0
  const totalBytes = storage?.totalBytes ?? 0
  const binPercent = totalBytes > 0 ? (binBytes / totalBytes) * 100 : 0
  const livePercent = 100 - binPercent
  const sources = storage
    ? [
        { label: '视频原片', bytes: storage.bySource.video },
        { label: '收录文件', bytes: storage.bySource.upload },
        { label: '批注素材与照片', bytes: storage.bySource.asset + storage.bySource.photo },
      ]
    : []
  const activeTeams = teams.filter((team) => team.status === 'ACTIVE').length
  const disabledTeams = teams.filter((team) => team.status === 'DISABLED').length
  const memberCount = teams.reduce((total, team) => total + team._count.members, 0)
  const projectCount = teams.reduce((total, team) => total + team._count.projects, 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">团队总览</h1>
          <p className="mt-1 text-sm text-muted-foreground">当前登录：{user?.email} · 日期按北京日切分</p>
        </div>
        <Link href="/platform/teams" className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
          <Users className="h-4 w-4" />
          管理团队
        </Link>
      </div>

      {teamsFailed ? (
        <p role="alert" className="text-sm text-destructive">团队列表读取失败，四枚统计卡先不显示数字，请重新登录平台控制台。</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            icon={Building2}
            chip="bg-muted text-muted-foreground"
            value={teams.length}
            label="团队总数"
            sub={disabledTeams > 0 ? `已停用 ${disabledTeams}` : undefined}
            danger={disabledTeams > 0}
          />
          <StatCard
            icon={CheckCircle2}
            chip="bg-success-visible text-success"
            value={activeTeams}
            label="正常团队"
            sub={activeTeams > 0 ? `占比 ${((activeTeams / teams.length) * 100).toFixed(0)}%` : undefined}
          />
          <StatCard icon={Users} chip="bg-primary-visible text-primary" value={memberCount} label="成员总数" />
          <StatCard icon={FolderKanban} chip="bg-muted text-muted-foreground" value={projectCount} label="项目总数" />
        </div>
      )}

      <section className="rounded-lg border border-border bg-card p-4" aria-label="每日使用量">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">每日使用量</h2>
          <div className="flex items-center gap-1" role="group" aria-label="统计窗口">
            {[7, 14, 31].map((size) => (
              <button
                key={size}
                type="button"
                aria-pressed={dayWindow === size}
                onClick={() => setDayWindow(size)}
                className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                  dayWindow === size ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-border text-muted-foreground hover:bg-muted/50'
                }`}
              >
                {size} 天
              </button>
            ))}
          </div>
        </div>

        {days.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            {refreshing && !failed ? '正在读取使用量…' : '使用量读取失败，请重新登录平台控制台'}
          </p>
        ) : (
          <div className={`mt-3 overflow-x-auto transition-opacity ${refreshing ? 'opacity-60' : ''}`}>
            <table className="w-full text-sm">
              <caption className="sr-only">近 {days.length} 天每日使用量，按北京日切分，单元格底色宽度表示该列当天在窗口内的相对量级</caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th scope="col" className="py-1 pr-3 text-left font-normal whitespace-nowrap">
                    日期<span className="ml-1 text-[11px] opacity-70">北京日</span>
                  </th>
                  {METRICS.map((metric) => (
                    <th key={metric.key} scope="col" className="py-1 pr-3 text-right font-normal" style={{ minWidth: metric.minWidth }}>
                      {metric.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {days.map((day) => (
                  <tr key={day.day} className="hover:bg-muted/40">
                    <th scope="row" className="py-1.5 pr-3 text-left font-normal whitespace-nowrap">
                      <span className="tabular-nums">{day.day.slice(5)}</span>
                      <span className="ml-1.5 text-xs text-muted-foreground">{weekdayOf(day.day)}</span>
                    </th>
                    {METRICS.map((metric) => (
                      <MetricCell
                        key={metric.key}
                        value={day[metric.key]}
                        peak={peaks[metric.key]}
                        display={metric.key === 'uploadBytes' ? (day.uploadBytes ? formatFileSize(day.uploadBytes) : '0 B') : String(day[metric.key])}
                      />
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border">
                  <th scope="row" className="py-2 pr-3 text-left text-xs font-medium whitespace-nowrap">
                    合计 · {days.length} 天
                  </th>
                  {METRICS.map((metric) => {
                    const total = sumOver(days, metric.key)
                    const delta = weekOverWeek(days, metric.key)
                    return (
                      <td key={metric.key} className="py-2 pr-3 text-right">
                        <span className="block font-medium tabular-nums">
                          {metric.key === 'uploadBytes' ? formatFileSize(total) : total}
                        </span>
                        {delta && <span className="block text-[11px] leading-4 tabular-nums text-muted-foreground">{delta}</span>}
                      </td>
                    )
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {days.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground lg:hidden">表格可左右滑动，右侧还有指标。</p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          访问＝审片页打开次数，活跃项目＝当天有访问的项目数，独立会话按访客去重。回收站里的素材当天仍计入上传量，所以这一列不等于当前占用。
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.15fr)]">
        <section className="rounded-lg border border-border bg-card p-4" aria-label="存储占用">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <HardDrive className="h-4 w-4 text-muted-foreground" />
              存储占用
            </h2>
            {storage && <p className="text-xs tabular-nums text-muted-foreground">回收站 {binPercent.toFixed(0)}%</p>}
          </div>
          {!storage ? (
            <p className="mt-4 text-sm text-muted-foreground">{refreshing ? '正在读取存储占用…' : '存储占用读取失败，请重新登录平台控制台'}</p>
          ) : (
            <>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{formatFileSize(totalBytes)}</p>
              <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`使用中 ${livePercent.toFixed(0)}%，回收站 ${binPercent.toFixed(0)}%`}>
                <span className="h-full bg-primary" style={{ width: `${livePercent}%` }} />
                <span className="h-full bg-muted-foreground" style={{ width: `${binPercent}%` }} />
              </div>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="flex items-center gap-2 text-muted-foreground">
                    <span className="h-2.5 w-2.5 rounded-sm bg-primary" />
                    使用中
                  </dt>
                  <dd className="tabular-nums">{formatFileSize(liveBytes)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="flex items-center gap-2 text-muted-foreground">
                    <span className="h-2.5 w-2.5 rounded-sm bg-muted-foreground" />
                    回收站（7 天内可恢复）
                  </dt>
                  <dd className="tabular-nums">{formatFileSize(binBytes)}</dd>
                </div>
                {sources.map((source) => (
                  <div key={source.label} className="flex items-center justify-between gap-3 border-t border-border pt-2">
                    <dt className="text-muted-foreground">{source.label}</dt>
                    <dd className="tabular-nums">
                      {formatFileSize(source.bytes)}
                      <span className="ml-1.5 text-xs text-muted-foreground">{totalBytes > 0 ? `${((source.bytes / totalBytes) * 100).toFixed(0)}%` : '—'}</span>
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">按已上传的素材文件计算，转码切片与封面不占额度，所以对象存储的实际占用会更高。</p>
            </>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-4" aria-label="团队">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">团队</h2>
            {teams.length > 0 && (
              <p className="text-xs tabular-nums text-muted-foreground">
                全部 {teams.length} · 正常 {activeTeams} · 已停用 {disabledTeams}
              </p>
            )}
          </div>
          {teams.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              {teamsFailed ? '团队列表读取失败，这里不猜数量。' : '暂无团队数据'}
            </p>
          ) : (
            <div className={`mt-2 overflow-x-auto transition-opacity ${refreshing ? 'opacity-60' : ''}`}>
              <table className="w-full text-sm">
                <caption className="sr-only">全部团队，建团日期按北京日，成员与项目数为当前实时计数</caption>
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th scope="col" className="py-1.5 pr-3 text-left font-normal">团队</th>
                    <th scope="col" className="py-1.5 pr-3 text-left font-normal">负责人</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-normal" style={{ minWidth: 44 }}>成员</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-normal" style={{ minWidth: 44 }}>项目</th>
                    <th scope="col" className="py-1.5 pr-3 text-left font-normal whitespace-nowrap" style={{ minWidth: 84 }}>建团</th>
                    <th scope="col" className="py-1.5 text-right font-normal whitespace-nowrap" style={{ minWidth: 60 }}>状态</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {teams.map((team) => {
                    const owner = team.members?.[0]?.user || team.createdBy
                    return (
                      <tr key={team.id} className="hover:bg-muted/40">
                        <th scope="row" className="max-w-[160px] py-2 pr-3 text-left font-normal">
                          <span className="block truncate text-sm font-medium">{team.name}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">@{team.slug}</span>
                        </th>
                        <td className="max-w-[140px] py-2 pr-3">
                          <span className="block truncate text-muted-foreground">{owner.name || owner.email}</span>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{team._count.members}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{team._count.projects}</td>
                        <td className="py-2 pr-3 text-left tabular-nums whitespace-nowrap text-muted-foreground">{beijingDate(team.createdAt)}</td>
                        <td className={`py-2 text-right font-medium whitespace-nowrap ${team.status === 'ACTIVE' ? 'text-primary' : 'text-destructive'}`}>
                          {team.expiryLabel}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
