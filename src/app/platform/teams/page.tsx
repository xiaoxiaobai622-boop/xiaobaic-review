'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowUpDown, Ban, CheckCircle2, Clock3, HardDrive, LogOut, Search, ShieldCheck, Users } from 'lucide-react'
import { usePlatformAuth } from '@/components/PlatformAuthProvider'
import PlatformTeamIdentity from '@/components/PlatformTeamIdentity'
import { getPlatformAccessToken } from '@/lib/platform-token-store'
import { formatBeijingDateTime, formatFileSize } from '@/lib/utils'

type Risk = { key: string; label: string; tone: 'danger' | 'warning' | 'muted' }
type SortKey = 'storageUsage' | 'lastActive' | 'createdAt' | 'status'
type SortOrder = 'asc' | 'desc'

type Team = {
  id: string
  name: string
  slug: string
  shareKey: string
  status: string
  createdAt: string
  subscriptionPlan: string
  subscriptionExpiresAt: string | null
  createdBy: { name: string | null; email: string }
  usage: { members: number; projects: number; videos: number }
  quota: { maxMembers: number; maxProjects: number; maxVideos: number; maxStorageGB: number; recorded: boolean; source: string }
  storage: { liveBytes: number; recycleBinBytes: number; totalBytes: number; bySource: Record<string, number> }
  links: { total: number; expired: number; noExpiryIndependent: number }
  pendingInvites: number
  membersNeverActive: number
  lastActive: { at: string | null; source: string | null }
  risk: Risk[]
  storagePercent: number | null
  memberPercent: number | null
}

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'storageUsage', label: '存储使用率' },
  { value: 'lastActive', label: '最后活跃' },
  { value: 'createdAt', label: '创建时间' },
  { value: 'status', label: '状态' },
]

function formatExpiry(team: Pick<Team, 'status'>) {
  // 免费内测期没有到期日：库里的旧到期日不再对外报倒计时。
  if (team.status === 'DISABLED') return '已停用'
  return '长期有效'
}

function sourceLabel(source: string | null) {
  if (source === 'member' || source === 'heartbeat') return '成员心跳'
  if (source === 'content') return '内容事件'
  if (source === 'client') return '客户访问'
  return ''
}

function riskClass(tone: Risk['tone']) {
  if (tone === 'danger') return 'bg-destructive/10 text-destructive'
  if (tone === 'warning') return 'bg-warning/10 text-warning'
  return 'bg-muted text-muted-foreground'
}

function percentLabel(value: number | null) {
  return value === null ? '不限' : `${value.toFixed(value >= 10 ? 0 : 1)}%`
}

function storageLimit(team: Team) {
  return team.quota.maxStorageGB > 0 ? formatFileSize(team.quota.maxStorageGB * 1024 * 1024 * 1024) : '不限'
}

export default function PlatformTeamsPage() {
  const { logout } = usePlatformAuth()
  const [teams, setTeams] = useState<Team[]>([])
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('createdAt')
  const [order, setOrder] = useState<SortOrder>('asc')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    setLoading(true)
    const token = getPlatformAccessToken()
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`
    try {
      const response = await fetch(`/api/platform/teams?sort=${sort}&order=${order}`, { headers, cache: 'no-store' })
      if (!response.ok) throw new Error('无法加载团队列表')
      const data = await response.json()
      setTeams(data.teams || [])
    } catch (err) {
      setTeams([])
      setError(err instanceof Error ? err.message : '无法加载团队列表')
    } finally {
      setLoading(false)
    }
  }, [sort, order])

  useEffect(() => {
    void load()
  }, [load])

  const setStatus = async (team: Team, status: 'ACTIVE' | 'DISABLED') => {
    const token = getPlatformAccessToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    const response = await fetch(`/api/platform/teams/${team.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status }),
    })
    if (!response.ok) {
      setError('操作失败')
      return
    }
    await load()
  }

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return teams
    return teams.filter((team) =>
      [team.name, team.id, team.slug, team.createdBy.name || '', team.createdBy.email]
        .some((value) => value.toLowerCase().includes(query)),
    )
  }, [teams, search])

  const activeCount = teams.filter((team) => team.status === 'ACTIVE').length
  const disabledCount = teams.filter((team) => team.status === 'DISABLED').length
  // 「这一次没读到」和「平台上真的没有团队」是两句话，混着说就是把未知伪装成结论。
  const loadFailed = !!error && teams.length === 0
  const dashOr = (value: number) => (loadFailed ? '—' : value)

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">团队管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">停用后，该团队所有成员和接口将立即无法使用。</p>
        </div>
        <button
          type="button"
          onClick={logout}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          退出平台
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">团队总数</p>
          <p className="mt-2 text-2xl font-semibold">{dashOr(teams.length)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">正常团队</p>
          <p className="mt-2 text-2xl font-semibold text-success">{dashOr(activeCount)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">已停用</p>
          <p className="mt-2 text-2xl font-semibold text-destructive">{dashOr(disabledCount)}</p>
        </div>
      </div>
      {loadFailed && (
        <p className="-mt-2 text-sm text-muted-foreground">
          上面三个数是「—」而不是 0：这一次没读到团队列表，点下方重试。
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜团队名／团队 ID／标识／创建人／邮箱"
            className="h-10 w-full rounded-md border border-border bg-card pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="team-sort" className="text-xs text-muted-foreground">排序</label>
          <select
            id="team-sort"
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            className="h-10 rounded-md border border-border bg-card px-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          >
            {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <button
            type="button"
            onClick={() => setOrder((current) => (current === 'asc' ? 'desc' : 'asc'))}
            className="inline-flex h-10 items-center gap-1 rounded-md border border-border px-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={order === 'asc' ? '升序，点击改为降序' : '降序，点击改为升序'}
          >
            <ArrowUpDown className="h-4 w-4" />
            {order === 'asc' ? '升序' : '降序'}
          </button>
        </div>
      </div>

      {error && <div className="rounded-md border border-destructive/30 bg-destructive-visible p-3 text-sm text-destructive">{error}，<button type="button" onClick={() => void load()} className="underline">重试</button></div>}

      {loading ? (
        <div className="space-y-2 rounded-lg border border-border bg-card p-4" aria-busy="true">
          <span className="sr-only" role="status" aria-live="polite">正在加载团队...</span>
          {[0, 1, 2, 3, 4].map((index) => <div key={index} className="skeleton h-10 rounded-md" />)}
        </div>
      ) : loadFailed ? (
        <div role="alert" className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          <p className="font-medium text-destructive">团队列表读取失败</p>
          <p className="mt-1">这一屏不代表平台上没有团队，只是这一次没读到。</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          没有找到匹配的团队。
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((team) => (
            <div key={team.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className={`h-4 w-4 ${team.status === 'ACTIVE' ? 'text-success' : 'text-destructive'}`} />
                    <h2 className="truncate text-base font-semibold">{team.name}</h2>
                  </div>
                  <PlatformTeamIdentity team={team} className="mt-1.5" />
                </div>
                <span className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${team.status === 'ACTIVE' ? 'bg-success-visible text-success' : 'bg-destructive/10 text-destructive'}`}>
                  {team.status === 'ACTIVE' ? '正常' : '已停用'}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">创建人</p>
                  <p className="mt-1 truncate">{team.createdBy.name || team.createdBy.email}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">成员 / 项目 / 视频</p>
                  <p className="mt-1 tabular-nums">{team.usage.members} / {team.usage.projects} / {team.usage.videos}</p>
                </div>
              </div>

              <div className="mt-3 space-y-1.5 border-t border-border pt-3">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="inline-flex items-center gap-1 text-muted-foreground"><HardDrive className="h-3.5 w-3.5" />存储</span>
                  <span className="tabular-nums">
                    {formatFileSize(team.storage.totalBytes)} / {storageLimit(team)}{' '}
                    <span className={`font-medium ${team.storagePercent !== null && team.storagePercent >= 100 ? 'text-destructive' : team.storagePercent !== null && team.storagePercent >= 90 ? 'text-warning' : 'text-muted-foreground'}`}>
                      {percentLabel(team.storagePercent)}
                    </span>
                  </span>
                </div>
                {team.storagePercent !== null && (
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <div
                      className={`h-full rounded-full ${team.storagePercent >= 100 ? 'bg-destructive' : team.storagePercent >= 90 ? 'bg-warning' : 'bg-primary'}`}
                      style={{ width: `${Math.min(100, Math.max(0, team.storagePercent))}%` }}
                    />
                  </div>
                )}
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>成员 {team.usage.members}{team.quota.maxMembers > 0 ? ` / ${team.quota.maxMembers}` : '（不限）'}</span>
                  <span>链接 {team.links.total}{team.links.expired ? ` · 过期 ${team.links.expired}` : ''}</span>
                  <span>待接受邀请 {team.pendingInvites}</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock3 className="h-3.5 w-3.5" />
                  最后活跃：
                  <span className="text-foreground">
                    {team.lastActive.at ? formatBeijingDateTime(team.lastActive.at) : '未记录'}
                  </span>
                  {team.lastActive.source && <span className="rounded bg-muted px-1.5 py-0.5">{sourceLabel(team.lastActive.source)}</span>}
                  <span className="text-muted-foreground/60">· 北京</span>
                </div>
                {team.risk.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {team.risk.slice(0, 3).map((risk) => (
                      <span key={risk.key} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${riskClass(risk.tone)}`}>{risk.label}</span>
                    ))}
                    {team.risk.length > 3 && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">+{team.risk.length - 3}</span>}
                  </div>
                )}
              </div>

              <div className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-sm">
                <Clock3 className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">团队有效期</span>
                <span className={`font-medium ${team.status === 'ACTIVE' ? 'text-primary' : 'text-destructive'}`}>
                  {formatExpiry(team)}
                </span>
              </div>

              <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                <Link
                  href={`/platform/teams/${team.id}`}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-95"
                >
                  <Users className="h-4 w-4" />
                  团队 360
                </Link>
                <button
                  type="button"
                  onClick={() => setStatus(team, team.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE')}
                  className={`inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm ${
                    team.status === 'ACTIVE'
                      ? 'border-destructive/30 text-destructive hover:bg-destructive/10'
                      : 'border-success-visible text-success hover:bg-success-visible'
                  }`}
                >
                  {team.status === 'ACTIVE' ? <Ban className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                  {team.status === 'ACTIVE' ? '停用' : '启用'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
