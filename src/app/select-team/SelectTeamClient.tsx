'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowRight, Check, Loader2, RotateCcw } from 'lucide-react'
import { useTranslations } from 'next-intl'
import BrandLogo from '@/components/BrandLogo'
import { Button } from '@/components/ui/button'
import { apiFetch, apiPost } from '@/lib/api-client'
import { safeReturnUrl } from '@/lib/return-url'
import { getActiveTeamId, setActiveTeamId } from '@/lib/team-store'

type TeamMembership = {
  role: 'OWNER' | 'ADMIN' | 'MEMBER'
  team: {
    id: string
    name: string
    slug: string
    avatarUrl: string | null
    status?: string
    createdBy?: { id: string; name: string | null } | null
  }
}

export default function SelectTeamClient() {
  const t = useTranslations('selectTeam')
  const tc = useTranslations('common')
  const searchParams = useSearchParams()
  const returnUrl = safeReturnUrl(searchParams?.get('returnUrl'), '/studio/projects')
  const [teams, setTeams] = useState<TeamMembership[] | null>(null)
  const [error, setError] = useState('')
  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const activeTeamId = getActiveTeamId()

  const roleLabel = (role: TeamMembership['role']) =>
    role === 'OWNER' ? t('roleOwner') : role === 'ADMIN' ? t('roleAdmin') : t('roleMember')

  const load = useCallback(async () => {
    setError('')
    try {
      const response = await apiFetch('/api/auth/session', { cache: 'no-store' })
      if (response.status === 401) {
        const selectUrl = `/select-team?returnUrl=${encodeURIComponent(returnUrl)}`
        window.location.href = `/login?returnUrl=${encodeURIComponent(selectUrl)}`
        return
      }
      if (!response.ok) {
        setError(t('failed'))
        return
      }
      const data = await response.json().catch(() => null)
      const nextTeams: TeamMembership[] = Array.isArray(data?.user?.teams) ? data.user.teams : []
      if (nextTeams.length === 1) {
        setActiveTeamId(nextTeams[0].team.id)
        window.location.replace(returnUrl)
        return
      }
      setTeams(nextTeams)
    } catch {
      setError(t('failed'))
    }
  }, [returnUrl, t])

  useEffect(() => {
    void load()
  }, [load])

  const chooseTeam = async (teamId: string) => {
    if (switchingId) return
    setSwitchingId(teamId)
    setError('')
    try {
      await apiPost('/api/teams/switch', { teamId })
      setActiveTeamId(teamId)
      window.location.replace(returnUrl)
    } catch {
      setError(t('failed'))
      setSwitchingId(null)
    }
  }

  const createdTeams = (teams ?? []).filter((item) => item.role === 'OWNER')
  const joinedTeams = (teams ?? []).filter((item) => item.role !== 'OWNER')

  const renderGroup = (label: string, items: TeamMembership[]) => {
    if (items.length === 0) return null
    return (
      <div>
        <p className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <div className="space-y-1">
          {items.map((item) => {
            const disabled = item.team.status === 'DISABLED'
            const busy = switchingId === item.team.id
            return (
              <button
                key={item.team.id}
                type="button"
                onClick={() => void chooseTeam(item.team.id)}
                disabled={disabled || switchingId !== null}
                aria-label={`${t('enter')} · ${item.team.name}`}
                className={`group flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
                  item.team.id === activeTeamId
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-transparent hover:border-border hover:bg-accent/60'
                } disabled:cursor-not-allowed disabled:opacity-55`}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-primary">
                  {item.team.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{item.team.name}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {item.team.createdBy?.name || roleLabel(item.role)}
                    {disabled ? ` · ${t('disabled')}` : ''}
                  </span>
                </span>
                {busy ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                ) : item.team.id === activeTeamId ? (
                  <Check className="h-4 w-4 shrink-0 text-primary" />
                ) : (
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                )}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card px-3 shadow-elevation-sm">
            <BrandLogo size={30} className="max-w-full object-contain" ariaHidden />
          </span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{t('description')}</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-3 shadow-elevation-lg">
          {teams === null && !error ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : error && teams === null ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-sm text-destructive">{error}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                {tc('retry')}
              </Button>
            </div>
          ) : teams && teams.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-sm text-muted-foreground">{t('empty')}</p>
              <Button asChild size="sm">
                <Link href="/studio/team">{t('teamCenter')}</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {renderGroup(t('created'), createdTeams)}
              {renderGroup(t('joined'), joinedTeams)}
              {error && <p className="px-2 pb-1 text-xs text-destructive">{error}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
