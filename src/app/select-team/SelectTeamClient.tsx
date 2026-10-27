'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ChevronRight, Loader2, RotateCcw } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout'
import { Button } from '@/components/ui/button'
import { apiFetch, apiPost } from '@/lib/api-client'
import { safeReturnUrl } from '@/lib/return-url'
import { getActiveTeamId, setActiveTeamId } from '@/lib/team-store'
import { cn } from '@/lib/utils'

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

function TeamAvatar({ team }: { team: TeamMembership['team'] }) {
  const [broken, setBroken] = useState(false)
  if (team.avatarUrl && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={team.avatarUrl}
        alt=""
        className="h-9 w-9 shrink-0 rounded-lg object-cover ring-1 ring-inset ring-foreground/10"
        onError={() => setBroken(true)}
      />
    )
  }
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-[13px] font-semibold text-primary ring-1 ring-inset ring-primary/15">
      {team.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

function SkeletonRows() {
  return (
    <div className="animate-pulse motion-reduce:animate-none">
      <div className="flex items-center justify-between px-4 pb-2 pt-3.5">
        <span className="h-2.5 w-16 rounded bg-foreground/10" />
        <span className="h-2.5 w-3 rounded bg-foreground/10" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 border-t border-border/70 px-4 py-3">
          <span className="h-9 w-9 rounded-lg bg-foreground/10" />
          <span className="flex-1 space-y-2">
            <span className="block h-3 w-28 rounded bg-foreground/10" />
            <span className="block h-2.5 w-16 rounded bg-foreground/[0.06]" />
          </span>
        </div>
      ))}
    </div>
  )
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
      <section aria-label={label}>
        <div className="flex items-center justify-between px-4 pb-2 pt-3.5">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</h2>
          <span className="text-[11px] tabular-nums text-muted-foreground">{items.length}</span>
        </div>
        <ul>
          {items.map((item) => {
            const disabled = item.team.status === 'DISABLED'
            const busy = switchingId === item.team.id
            const current = item.team.id === activeTeamId
            return (
              <li key={item.team.id} className="border-t border-border/70">
                <button
                  type="button"
                  onClick={() => void chooseTeam(item.team.id)}
                  disabled={disabled || switchingId !== null}
                  aria-label={`${t('enter')} · ${item.team.name}`}
                  aria-current={current ? 'true' : undefined}
                  className={cn(
                    'group flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors duration-[var(--motion-base)]',
                    'hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-primary/25',
                    'disabled:cursor-not-allowed disabled:hover:bg-transparent',
                    disabled && 'opacity-50',
                  )}
                >
                  <TeamAvatar team={item.team} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium leading-5 text-foreground">{item.team.name}</span>
                    <span className="mt-0.5 block truncate text-xs leading-4 text-muted-foreground">
                      {item.team.createdBy?.name || roleLabel(item.role)}
                    </span>
                  </span>
                  {disabled ? (
                    <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[11px] font-medium leading-4 text-muted-foreground">
                      {t('disabled')}
                    </span>
                  ) : current ? (
                    <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium leading-4 text-primary">
                      {t('current')}
                    </span>
                  ) : null}
                  {busy ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                  ) : (
                    <ChevronRight
                      className={cn(
                        'h-4 w-4 shrink-0 text-muted-foreground/60 transition-[transform,color] duration-[var(--motion-base)]',
                        !disabled && 'group-hover:translate-x-0.5 group-hover:text-foreground',
                      )}
                    />
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </section>
    )
  }

  return (
    <AuthSplitLayout>
      <div className="w-full max-w-[400px] animate-in fade-in slide-in-from-bottom-1 duration-200 ease-out fill-mode-both motion-reduce:animate-none">
        <h1 className="text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] text-foreground">{t('title')}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('description')}</p>

        <div className="mt-8 overflow-hidden rounded-xl border border-border bg-popover shadow-elevation-md">
          {teams === null && !error ? (
            <SkeletonRows />
          ) : error && teams === null ? (
            <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
              <p className="text-sm text-destructive">{error}</p>
              <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => void load()}>
                <RotateCcw className="h-3.5 w-3.5" />
                {tc('retry')}
              </Button>
            </div>
          ) : teams && teams.length === 0 ? (
            <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
              <p className="text-sm text-muted-foreground">{t('empty')}</p>
              <Button asChild size="sm" className="rounded-lg">
                <Link href="/studio/team">{t('teamCenter')}</Link>
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-border/70">
              {renderGroup(t('created'), createdTeams)}
              {renderGroup(t('joined'), joinedTeams)}
              {error && (
                <p role="alert" className="px-4 py-3 text-xs text-destructive">{error}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </AuthSplitLayout>
  )
}
