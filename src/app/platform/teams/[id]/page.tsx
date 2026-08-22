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
}

export default function PlatformTeamDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const [teamName, setTeamName] = useState('')
  const [grants, setGrants] = useState<Grant[]>([])
  const [quota, setQuota] = useState<Quota | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!params?.id) return
    ;(async () => {
      const token = getPlatformAccessToken()
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`
      const [teamsRes, grantsRes, quotaRes] = await Promise.all([
        fetch('/api/platform/teams', { headers }),
        fetch(`/api/platform/teams/${params.id}/grants`, { headers }),
        fetch(`/api/platform/teams/${params.id}/quota`, { headers }),
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
    const token = getPlatformAccessToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    const response = await fetch(`/api/platform/teams/${params.id}/grants`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ grants: grants.map((grant) => ({ featureKey: grant.featureKey, enabled: grant.enabled })) }),
    })
    setMessage(response.ok ? '功能授权已保存' : '保存失败')
    setSaving(false)
  }

  const saveQuota = async () => {
    if (!params?.id || !quota) return
    setSaving(true)
    setMessage('')
    const token = getPlatformAccessToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    const response = await fetch(`/api/platform/teams/${params.id}/quota`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(quota),
    })
    setMessage(response.ok ? '配额已保存' : '保存失败')
    setSaving(false)
  }

  return (
    <div className="space-y-6">
      <button type="button" onClick={() => router.push('/platform/teams')} className="text-sm text-muted-foreground hover:text-foreground">
        返回团队管理
      </button>
      <h1 className="text-2xl font-semibold">{teamName || '团队授权'}</h1>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}

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
      </div>

      <button type="button" onClick={saveGrants} disabled={saving} className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-60">
        保存功能授权
      </button>

      {quota && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">团队配额</h2>
          <div className="grid gap-3 sm:grid-cols-4">
            {([
              ['maxMembers', '最大成员数'],
              ['maxProjects', '最大项目数'],
              ['maxVideos', '最大视频数'],
              ['maxStorageGB', '存储上限 GB'],
            ] as const).map(([key, label]) => (
              <label key={key} className="space-y-1">
                <span className="text-xs text-muted-foreground">{label}</span>
                <input
                  type="number"
                  min={1}
                  value={quota[key]}
                  onChange={(event) => setQuota({ ...quota, [key]: Number(event.target.value) || 1 })}
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
                />
              </label>
            ))}
          </div>
          <button type="button" onClick={saveQuota} disabled={saving} className="mt-4 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-60">
            保存配额
          </button>
        </div>
      )}
    </div>
  )
}
