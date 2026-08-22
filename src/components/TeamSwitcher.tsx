'use client'

import { useEffect, useRef, useState } from 'react'
import { Building2, Check, ChevronDown, LogIn, Plus, Users, UserCog } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { apiFetch, apiPost } from '@/lib/api-client'
import { getActiveTeamId, setActiveTeamId } from '@/lib/team-store'
import { useAuth } from '@/components/AuthProvider'

type TeamItem = {
  role: 'OWNER' | 'ADMIN' | 'MEMBER'
  memberSince: string
  team: {
    id: string
    name: string
    slug: string
    avatarUrl: string | null
    createdBy?: { id: string; name: string | null; email: string }
    _count?: { members: number; projects: number }
  }
}

type InviteItem = {
  id: string
  teamId: string
  role: 'OWNER' | 'ADMIN' | 'MEMBER'
  token: string
  team: { id: string; name: string; slug: string; avatarUrl: string | null }
}

const ROLE_LABELS: Record<'OWNER' | 'ADMIN' | 'MEMBER', string> = {
  OWNER: '创建人',
  ADMIN: '管理员',
  MEMBER: '成员',
}

export default function TeamSwitcher() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [teams, setTeams] = useState<TeamItem[]>([])
  const [invitations, setInvitations] = useState<InviteItem[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [teamName, setTeamName] = useState('')
  const [error, setError] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  const activeTeamId = getActiveTeamId() || teams[0]?.team.id || null
  const activeTeam = teams.find((item) => item.team.id === activeTeamId) || teams[0]

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    if (open) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const response = await apiFetch('/api/team-center')
        if (!response.ok || cancelled) return
        const data = await response.json()
        setTeams(data.teams || [])
        setInvitations(data.invitations || [])
      } catch {
        // The header should still work even if the team center cannot load.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, user?.id])

  const selectTeam = async (teamId: string) => {
    setActiveTeamId(teamId)
    setOpen(false)
    try {
      await apiPost('/api/teams/switch', { teamId })
    } catch {
      // Local state is authoritative; the reload below will refresh auth.
    }
    window.location.reload()
  }

  const createTeam = async () => {
    const name = teamName.trim()
    if (!name) {
      setError('请输入团队名称')
      return
    }

    setError('')
    try {
      const created = await apiPost<{ team: { id: string } }>('/api/teams', { name })
      setActiveTeamId(created.team.id)
      setCreateOpen(false)
      setOpen(false)
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建团队失败')
    }
  }

  if (!user) return null

  const roleLabel = activeTeam ? ROLE_LABELS[activeTeam.role] : ''

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-9 w-48 shrink-0 items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent sm:w-56"
        aria-label="团队中心"
      >
        <Building2 className="h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-left">
          {activeTeam?.team.name || (teams.length === 0 ? '创建 / 加入团队' : '团队中心')}
        </span>
        {invitations.length > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
            {invitations.length}
          </span>
        )}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-lg border border-border bg-card shadow-elevation-lg">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
            <Building2 className="h-4 w-4 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{activeTeam?.team.name || '团队中心'}</p>
              {roleLabel && <p className="text-xs text-muted-foreground">{roleLabel}</p>}
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto p-1">
            {teams.length > 0 ? (
              teams.map((item) => (
                <button
                  key={item.team.id}
                  type="button"
                  onClick={() => selectTeam(item.team.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors ${
                    item.team.id === activeTeamId
                      ? 'bg-primary-visible text-foreground'
                      : 'hover:bg-accent'
                  }`}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-sm font-semibold text-primary">
                    {item.team.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item.team.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {ROLE_LABELS[item.role]}
                      {item.team._count ? ` · ${item.team._count.members} 人` : ''}
                    </span>
                  </span>
                  {item.team.id === activeTeamId && <Check className="h-4 w-4 text-primary" />}
                </button>
              ))
            ) : (
              <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                你还没有加入任何团队。
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-1 border-t border-border p-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setCreateOpen(true)
              }}
              className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Plus className="h-4 w-4" />
              创建团队
            </button>
            <Link
              href="/studio/team/join"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <LogIn className="h-4 w-4" />
              申请加入
            </Link>
            <Link
              href="/studio/team"
              onClick={() => setOpen(false)}
              className="col-span-2 flex items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <UserCog className="h-4 w-4" />
              团队管理
            </Link>
          </div>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              创建团队
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <label className="text-sm text-muted-foreground" htmlFor="team-switcher-name">
              团队名称
            </label>
            <input
              id="team-switcher-name"
              value={teamName}
              onChange={(event) => setTeamName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void createTeam()
              }}
              placeholder="例如：小白工作室"
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="button" className="w-full" onClick={createTeam}>
              创建并进入
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
