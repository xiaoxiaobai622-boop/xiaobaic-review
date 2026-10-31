'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Activity, FolderKanban, LayoutDashboard, ShieldCheck, Users } from 'lucide-react'
import { getPlatformAccessToken } from '@/lib/platform-token-store'
import PlatformTeamIdentity from '@/components/PlatformTeamIdentity'
import TeamOverviewPanel from './TeamOverviewPanel'
import TeamProjectsPanel from './TeamProjectsPanel'
import TeamMembersPanel from './TeamMembersPanel'
import TeamActivityPanel from './TeamActivityPanel'

type Feature = {
  key: string
  name: string
  category: string
  description: string | null
  defaultEnabled: boolean
}

type Grant = {
  featureKey: string
  enabled: boolean
  explicit: boolean
  feature: Feature
}

type Quota = {
  maxMembers: number
  maxProjects: number
  maxVideos: number
  maxStorageGB: number
  source: string
  sourceOrderId: string | null
  recorded: boolean
}

type TabKey = 'overview' | 'projects' | 'members' | 'activity' | 'access'

const TABS: Array<{ key: TabKey; label: string; icon: typeof Users }> = [
  { key: 'overview', label: '概览', icon: LayoutDashboard },
  { key: 'projects', label: '项目与链接', icon: FolderKanban },
  { key: 'members', label: '成员', icon: Users },
  { key: 'activity', label: '活跃', icon: Activity },
  { key: 'access', label: '授权与配额', icon: ShieldCheck },
]

function authHeaders(json = false) {
  const token = getPlatformAccessToken()
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

export default function PlatformTeamDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const [tab, setTab] = useState<TabKey>('overview')
  const [teamName, setTeamName] = useState('')
  const [identity, setIdentity] = useState<{ id: string; slug: string; shareKey: string } | null>(null)
  const [grants, setGrants] = useState<Grant[]>([])
  const [quota, setQuota] = useState<Quota | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [readErrors, setReadErrors] = useState<{ team: boolean; grants: boolean; quota: boolean }>({
    team: false,
    grants: false,
    quota: false,
  })

  useEffect(() => {
    if (!params?.id) return
    ;(async () => {
      const [summaryRes, grantsRes, quotaRes] = await Promise.all([
        fetch(`/api/platform/teams/${params.id}/summary`, { headers: authHeaders(), cache: 'no-store' }),
        fetch(`/api/platform/teams/${params.id}/grants`, { headers: authHeaders(), cache: 'no-store' }),
        fetch(`/api/platform/teams/${params.id}/quota`, { headers: authHeaders(), cache: 'no-store' }),
      ])
      if (summaryRes.ok) {
        const summaryData = await summaryRes.json()
        const team = summaryData.team
        if (team) {
          setTeamName(team.name)
          setIdentity({ id: team.id, slug: team.slug, shareKey: team.shareKey })
        }
      }
      if (grantsRes.ok) setGrants((await grantsRes.json()).grants || [])
      if (quotaRes.ok) {
        const quotaData = await quotaRes.json()
        setQuota(quotaData.quota)
      }
      setReadErrors({ team: !summaryRes.ok, grants: !grantsRes.ok, quota: !quotaRes.ok })
      setLoading(false)
    })()
  }, [params?.id])

  const grouped = useMemo(() => {
    const map = new Map<string, Grant[]>()
    for (const grant of grants) {
      const list = map.get(grant.feature.category) || []
      list.push(grant)
      map.set(grant.feature.category, list)
    }
    return Array.from(map.entries())
  }, [grants])

  const setGrant = (featureKey: string, enabled: boolean) => {
    setGrants((current) =>
      current.map((grant) => (grant.featureKey === featureKey ? { ...grant, enabled } : grant)),
    )
  }

  const saveGrants = async () => {
    if (!params?.id) return
    const changed = grants
      .filter((grant) => grant.explicit || grant.enabled !== grant.feature.defaultEnabled)
      .map((grant) => ({ featureKey: grant.featureKey, enabled: grant.enabled }))
    if (changed.length === 0) {
      setMessage('这几项都还跟着平台默认值，没有要保存的改动')
      return
    }
    setSaving(true)
    setMessage('')
    const response = await fetch(`/api/platform/teams/${params.id}/grants`, {
      method: 'PATCH',
      headers: authHeaders(true),
      body: JSON.stringify({ grants: changed }),
    })
    if (response.ok) {
      const keys = new Set(changed.map((grant) => grant.featureKey))
      setGrants((current) => current.map((grant) => (keys.has(grant.featureKey) ? { ...grant, explicit: true } : grant)))
    }
    setMessage(response.ok ? '功能授权已保存' : '保存失败')
    setSaving(false)
  }

  const saveQuota = async () => {
    if (!params?.id || !quota) return
    setSaving(true)
    setMessage('')
    const response = await fetch(`/api/platform/teams/${params.id}/quota`, {
      method: 'PATCH',
      headers: authHeaders(true),
      body: JSON.stringify({
        maxMembers: quota.maxMembers,
        maxProjects: quota.maxProjects,
        maxVideos: quota.maxVideos,
        maxStorageGB: quota.maxStorageGB,
      }),
    })
    const data = await response.json().catch(() => null)
    if (response.ok) {
      if (data?.quota) setQuota(data.quota)
      setMessage('配额已保存')
    } else {
      setMessage('保存失败')
    }
    setSaving(false)
  }

  return (
    <div className="space-y-4">
      <button type="button" onClick={() => router.push('/platform/teams')} className="text-sm text-muted-foreground hover:text-foreground">
        返回团队管理
      </button>
      <h1 className="text-2xl font-semibold">{teamName || (readErrors.team ? '团队信息读取失败' : '团队 360')}</h1>
      {identity ? (
        <div className="space-y-1">
          <PlatformTeamIdentity team={identity} />
          <p className="text-xs text-muted-foreground">
            团队 ID 用来在接口和日志里定位这一队；加入链接拼的是团队标识，客户手上那条地址开头是分享键。所有时间按北京时区显示。
          </p>
        </div>
      ) : readErrors.team ? (
        <p className="text-sm text-destructive">这枚团队的身份串读取失败，请刷新本页重试；在读到之前，下面几块内容对不上是哪一队。</p>
      ) : null}

      <div className="scrollbar-hidden -mx-1 overflow-x-auto border-b border-border">
        <div className="flex min-w-max gap-1 px-1" role="tablist" aria-label="团队 360">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors ${tab === key ? 'border-primary font-medium text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {params?.id && tab === 'overview' && <TeamOverviewPanel teamId={params.id} onOpenMembers={() => setTab('members')} />}
      {params?.id && tab === 'projects' && <TeamProjectsPanel teamId={params.id} />}
      {params?.id && tab === 'members' && <TeamMembersPanel teamId={params.id} />}
      {params?.id && tab === 'activity' && <TeamActivityPanel teamId={params.id} />}

      {tab === 'access' && (
        <div className="space-y-3">
          {message && <p className="text-sm text-muted-foreground">{message}</p>}

          {loading ? (
            <p className="text-sm text-muted-foreground">正在读取该团队的功能授权…</p>
          ) : readErrors.grants ? (
            <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive-visible p-4">
              <p className="text-sm font-medium text-destructive">功能授权读取失败</p>
              <p className="mt-1 text-sm text-muted-foreground">这里不猜这个团队有哪些授权，请刷新本页重试。</p>
            </div>
          ) : grouped.length === 0 ? (
            <div className="rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-semibold">功能授权</h2>
              <p className="mt-1 text-sm text-muted-foreground">平台上还没有定义任何可授权的功能，所以这里没有开关可给。</p>
            </div>
          ) : (
            <div className="space-y-3">
              {grouped.map(([category, list]) => (
                <div key={category} className="rounded-lg border border-border bg-card p-4">
                  <h2 className="mb-3 text-sm font-semibold">{category}</h2>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {list.map((grant) => (
                      <label key={grant.featureKey} className="flex items-start gap-3 rounded-md border border-border p-3">
                        <input
                          type="checkbox"
                          checked={grant.enabled}
                          onChange={(event) => setGrant(grant.featureKey, event.target.checked)}
                          className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                        />
                        <span>
                          <span className="block text-sm font-medium">{grant.feature.name}</span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {grant.explicit ? '这一队单独设过' : `平台默认${grant.enabled ? '开着' : '关着'}`}
                          </span>
                          {grant.feature.description && <span className="mt-1 block text-xs text-muted-foreground">{grant.feature.description}</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <button type="button" onClick={saveGrants} disabled={saving} className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-60">
                保存功能授权
              </button>
            </div>
          )}

          {readErrors.quota ? (
            <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive-visible p-4">
              <p className="text-sm font-medium text-destructive">团队配额读取失败</p>
              <p className="mt-1 text-sm text-muted-foreground">请先刷新本页读到当前额度，再决定要不要改。</p>
            </div>
          ) : quota && (
            <div className="rounded-lg border border-border bg-card p-4">
              <h2 className="mb-3 text-sm font-semibold">团队配额</h2>
              <div className="grid max-w-3xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {([
                  ['maxMembers', '最大成员数'],
                  ['maxProjects', '最大项目数（0=不限）'],
                  ['maxVideos', '最大视频数（0=不限）'],
                  ['maxStorageGB', '存储上限 GB'],
                ] as const).map(([key, label]) => (
                  <label key={key} className="space-y-1">
                    <span className="text-xs text-muted-foreground">{label}</span>
                    <input
                      type="number"
                      min={key === 'maxProjects' || key === 'maxVideos' ? 0 : 1}
                      value={quota[key]}
                      onChange={(event) => {
                        const value = Number(event.target.value)
                        setQuota({ ...quota, [key]: Number.isFinite(value) ? value : 0 })
                      }}
                      className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
                    />
                  </label>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {!quota.recorded
                  ? '这个团队名下还没有单独的额度记录，上面四格是内测期统一默认值；在这里保存一次才会为它写下属于自己的一行。'
                  : quota.source === 'MANUAL'
                    ? '额度来源：这里手动改过，续费时会被套餐重置'
                    : '额度来源：随套餐续费写回来'}
              </p>
              <button type="button" onClick={saveQuota} disabled={saving} className="mt-4 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-60">
                保存配额
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
