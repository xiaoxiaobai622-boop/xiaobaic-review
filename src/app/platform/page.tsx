'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Ban, CheckCircle2, ShieldCheck, Users } from 'lucide-react'
import { usePlatformAuth } from '@/components/PlatformAuthProvider'
import { getPlatformAccessToken } from '@/lib/platform-token-store'

export default function PlatformDashboardPage() {
  const { user } = usePlatformAuth()
  const [stats, setStats] = useState({ teams: 0, activeTeams: 0, disabledTeams: 0 })

  useEffect(() => {
    ;(async () => {
      const token = getPlatformAccessToken()
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`
      const response = await fetch('/api/platform/teams', { headers })
      if (!response.ok) return
      const data = await response.json()
      const teams = data.teams || []
      setStats({
        teams: teams.length,
        activeTeams: teams.filter((team: any) => team.status === 'ACTIVE').length,
        disabledTeams: teams.filter((team: any) => team.status === 'DISABLED').length,
      })
    })()
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" />
            平台控制台
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">团队总览</h1>
          <p className="mt-1 text-sm text-muted-foreground">当前登录：{user?.email}</p>
        </div>
        <Link href="/platform/teams" className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
          <Users className="h-4 w-4" />
          管理团队
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">团队总数</p>
          <p className="mt-2 text-2xl font-semibold">{stats.teams}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <p className="text-sm text-muted-foreground">正常团队</p>
          </div>
          <p className="mt-2 text-2xl font-semibold text-emerald-600">{stats.activeTeams}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <Ban className="h-4 w-4 text-destructive" />
            <p className="text-sm text-muted-foreground">已停用团队</p>
          </div>
          <p className="mt-2 text-2xl font-semibold text-destructive">{stats.disabledTeams}</p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">平台说明</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          平台控制台负责全平台团队概览、团队授权、功能开关和配额。平台运营账号不会进入团队项目后台，团队业务统一在 `/studio` 中管理。
        </p>
      </div>
    </div>
  )
}
