'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { getPlatformAccessToken } from '@/lib/platform-token-store'

type Feature = {
  key: string
  name: string
  category: string
  description: string | null
}

type Grant = {
  featureKey: string
  enabled: boolean
  feature: Feature
}

type Quota = {
  maxMembers: number
  maxProjects: number
  maxVideos: number
  maxStorageGB: number
  // GET 返回的是 TeamQuota 整行，所以这两枚溯源字段本来就在响应里（Task 13 只是把它们读出来）。
  // 只读展示用：下面 saveQuota 的请求体只发四枚数值键，绝不把 source 发回服务端。
  source: string
  sourceOrderId: string | null
}

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
  const [teamName, setTeamName] = useState('')
  const [grants, setGrants] = useState<Grant[]>([])
  const [quota, setQuota] = useState<Quota | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  // 三发请求各自记账：哪一发没成功就在哪一块说清楚，否则「读失败」会被画成「这个团队什么都没有」。
  const [readErrors, setReadErrors] = useState<{ team: boolean; grants: boolean; quota: boolean }>({
    team: false,
    grants: false,
    quota: false,
  })

  useEffect(() => {
    if (!params?.id) return
    ;(async () => {
      const [teamsRes, grantsRes, quotaRes] = await Promise.all([
        fetch('/api/platform/teams', { headers: authHeaders() }),
        fetch(`/api/platform/teams/${params.id}/grants`, { headers: authHeaders() }),
        fetch(`/api/platform/teams/${params.id}/quota`, { headers: authHeaders() }),
      ])
      if (teamsRes.ok) {
        const teamsData = await teamsRes.json()
        const team = teamsData.teams.find((item: any) => item.id === params.id)
        if (team) setTeamName(team.name)
      }
      if (grantsRes.ok) setGrants((await grantsRes.json()).grants || [])
      if (quotaRes.ok) {
        const quotaData = await quotaRes.json()
        setQuota(quotaData.quota)
      }
      setReadErrors({ team: !teamsRes.ok, grants: !grantsRes.ok, quota: !quotaRes.ok })
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
    setSaving(true)
    setMessage('')
    const response = await fetch(`/api/platform/teams/${params.id}/grants`, {
      method: 'PATCH',
      headers: authHeaders(true),
      body: JSON.stringify({ grants: grants.map((grant) => ({ featureKey: grant.featureKey, enabled: grant.enabled })) }),
    })
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
      // 只发四枚数值键：整个 quota 对象里现在带着 source/sourceOrderId，PUT 回去就等于让这边去
      // 声明额度的来源。来源是服务端的事（手改这一处会写成 MANUAL），界面只读不写。
      body: JSON.stringify({
        maxMembers: quota.maxMembers,
        maxProjects: quota.maxProjects,
        maxVideos: quota.maxVideos,
        maxStorageGB: quota.maxStorageGB,
      }),
    })
    const data = await response.json().catch(() => null)
    if (response.ok) {
      // 手改这一处会把来源写成 MANUAL（服务端的 PATCH 说了算）。采纳响应里的整行，
      // 否则界面会停在保存前那句「随套餐续费」，正好在来源刚变的那一刻说谎。
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
      <h1 className="text-2xl font-semibold">{teamName || (readErrors.team ? '团队信息读取失败' : '团队授权')}</h1>
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
          <p className="mt-1 text-sm text-muted-foreground">该团队还没有任何功能授权记录，因此下面没有可勾选的开关。</p>
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
          {/* 额度来源：PLAN 是续费写回来的，MANUAL 是运营在这里手改过的 —— 后者会在下一次确认到账时
              被套餐重置（OrderConfirmDialog 那句「当前额度是手动调整的，将被本套餐重置」用的就是同一枚字段）。 */}
          <p className="mt-3 text-xs text-muted-foreground">
            额度来源：{quota.source === 'MANUAL' ? '手动调整，续费时会被套餐重置' : '随套餐续费'}
          </p>
          <button type="button" onClick={saveQuota} disabled={saving} className="mt-4 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-60">
            保存配额
          </button>
        </div>
      )}
    </div>
  )
}
