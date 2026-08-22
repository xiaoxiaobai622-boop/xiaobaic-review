'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Ban, CheckCircle2, LogOut, Search, ShieldCheck, Users } from 'lucide-react'
import { usePlatformAuth } from '@/components/PlatformAuthProvider'
import { getPlatformAccessToken } from '@/lib/platform-token-store'

type Team = {
  id: string
  name: string
  slug: string
  status: string
  createdAt: string
  createdBy: { name: string | null; email: string }
  _count: { members: number; projects: number }
}

export default function PlatformTeamsPage() {
  const { logout } = usePlatformAuth()
  const [teams, setTeams] = useState<Team[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    const token = getPlatformAccessToken()
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`
    try {
      const response = await fetch('/api/platform/teams', { headers })
      if (!response.ok) throw new Error('无法加载团队列表')
      const data = await response.json()
      setTeams(data.teams || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法加载团队列表')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

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
      [team.name, team.slug, team.createdBy.name || '', team.createdBy.email]
        .some((value) => value.toLowerCase().includes(query)),
    )
  }, [teams, search])

  const activeCount = teams.filter((team) => team.status === 'ACTIVE').length
  const disabledCount = teams.filter((team) => team.status === 'DISABLED').length

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">平台控制台</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">团队管理</h1>
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
          <p className="mt-2 text-2xl font-semibold">{teams.length}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">正常团队</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-600">{activeCount}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">已停用</p>
          <p className="mt-2 text-2xl font-semibold text-destructive">{disabledCount}</p>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索团队、创建人..."
          className="h-10 w-full rounded-md border border-border bg-card pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {error && <div className="rounded-md border border-destructive/30 bg-destructive-visible p-3 text-sm text-destructive">{error}</div>}

      {loading ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground">正在加载团队...</div>
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
                    <ShieldCheck className={`h-4 w-4 ${team.status === 'ACTIVE' ? 'text-emerald-600' : 'text-destructive'}`} />
                    <h2 className="truncate text-base font-semibold">{team.name}</h2>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">@{team.slug}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${team.status === 'ACTIVE' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-destructive/10 text-destructive'}`}>
                  {team.status === 'ACTIVE' ? '正常' : '已停用'}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">创建人</p>
                  <p className="mt-1 truncate">{team.createdBy.name || team.createdBy.email}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">成员 / 项目</p>
                  <p className="mt-1">{team._count.members} / {team._count.projects}</p>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-2 border-t border-border pt-3">
                <Link
                  href={`/platform/teams/${team.id}`}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-95"
                >
                  <Users className="h-4 w-4" />
                  授权与配额
                </Link>
                <button
                  type="button"
                  onClick={() => setStatus(team, team.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE')}
                  className={`inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm ${
                    team.status === 'ACTIVE'
                      ? 'border-destructive/30 text-destructive hover:bg-destructive/10'
                      : 'border-emerald-600/30 text-emerald-700 hover:bg-emerald-600/10'
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
