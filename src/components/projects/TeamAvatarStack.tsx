'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Users } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { InitialsAvatar } from '@/components/InitialsAvatar'
import { useAuth } from '@/components/AuthProvider'
import { appConfirm } from '@/components/AppDialogProvider'
import { apiDelete, apiFetch, apiPatch } from '@/lib/api-client'
import { cn } from '@/lib/utils'

interface TeamMemberRow {
  id: string
  role: string
  status: string
  teamNickname?: string | null
  createdAt?: string
  user: {
    id: string
    name: string | null
    email: string
    phone: string | null
    avatarUrl: string | null
  }
}

const ROLE_RANK: Record<string, number> = { OWNER: 0, ADMIN: 1, MEMBER: 2 }
const ROLE_LABEL: Record<string, string> = { OWNER: '创建人', ADMIN: '管理员', MEMBER: '成员' }
const COLLAPSED_COUNT = 3
const EXPANDED_COUNT = 5
const CARD_CLOSE_DELAY_MS = 220

function memberName(member: TeamMemberRow) {
  return member.teamNickname || member.user.name || member.user.email || '成员'
}

function sortMembers(rows: TeamMemberRow[]) {
  return [...rows].sort((a, b) => (ROLE_RANK[a.role] ?? 3) - (ROLE_RANK[b.role] ?? 3))
}

/** 项目中心顶栏的团队成员脸谱：重叠头像，点一下向左散开；鼠标移到头像上出成员卡。 */
export default function TeamAvatarStack({ teamId }: { teamId: string | null }) {
  const t = useTranslations('projects')
  const { user } = useAuth()
  const [members, setMembers] = useState<TeamMemberRow[] | null>(null)
  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | null>(null)

  const cancelClose = () => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      setActiveId(null)
      setError('')
    }, CARD_CLOSE_DELAY_MS)
  }

  const showMember = (id: string) => {
    cancelClose()
    setError('')
    setActiveId(id)
  }

  useEffect(() => () => cancelClose(), [])

  useEffect(() => {
    if (!teamId) {
      setMembers([])
      return
    }
    let cancelled = false
    setMembers(null)
    setOpen(false)
    setActiveId(null)
    apiFetch(`/api/teams/${teamId}/members`, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return
        setMembers(sortMembers(((data?.members || []) as TeamMemberRow[]).filter((member) => member.status === 'ACTIVE')))
      })
      .catch(() => {
        if (!cancelled) setMembers([])
      })
    return () => { cancelled = true }
  }, [teamId])

  useEffect(() => {
    if (!open && !activeId) return
    const closeOnOutside = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return
      setOpen(false)
      setActiveId(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setActiveId(null)
      if (!activeId) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open, activeId])

  if (!members || members.length === 0) {
    return (
      <Button asChild variant="outline" size="icon" className="h-9 w-9">
        <Link href="/studio/team/members" aria-label={t('projectMembers')} title={t('projectMembers')}>
          <Users className="h-4 w-4" />
        </Link>
      </Button>
    )
  }

  const visible = members.slice(0, open ? EXPANDED_COUNT : COLLAPSED_COUNT)
  const hidden = members.length - visible.length
  const label = t('projectMemberCount', { count: members.length })
  const active = activeId ? members.find((member) => member.id === activeId) || null : null
  const isSelf = active?.user.id === user?.id
  const canChangeRole = Boolean(active && !isSelf && active.role !== 'OWNER' && user?.teamRole === 'OWNER')
  const canRemove = Boolean(active && !isSelf && active.role !== 'OWNER' && (user?.teamRole === 'OWNER' || (user?.teamRole === 'ADMIN' && active.role === 'MEMBER')))

  const changeRole = async (role: 'MEMBER' | 'ADMIN') => {
    if (!teamId || !active || busy || active.role === role) return
    setBusy(true)
    setError('')
    try {
      await apiPatch(`/api/teams/${teamId}/members/${active.user.id}`, { role })
      setMembers((current) => current ? sortMembers(current.map((member) => member.id === active.id ? { ...member, role } : member)) : current)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '修改角色失败')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!teamId || !active || busy) return
    if (!await appConfirm(`将 ${memberName(active)} 移出团队？`)) return
    setBusy(true)
    setError('')
    try {
      await apiDelete(`/api/teams/${teamId}/members/${active.user.id}`)
      setMembers((current) => current ? current.filter((member) => member.id !== active.id) : current)
      setActiveId(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '移除失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={label}
      className="relative flex items-center"
      onMouseEnter={cancelClose}
      onMouseLeave={scheduleClose}
    >
      <div className="flex items-center justify-end">
        {visible.map((member, index) => {
          const name = memberName(member)
          return (
            <button
              key={member.id}
              type="button"
              onClick={() => { if (open) showMember(member.id); else setOpen(true) }}
              onMouseEnter={() => showMember(member.id)}
              onFocus={() => showMember(member.id)}
              title={name}
              aria-label={`${name}，${ROLE_LABEL[member.role] || member.role}`}
              aria-haspopup="dialog"
              className={cn(
                'relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-2 ring-popover transition-[margin] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                index > 0 && (open ? 'ml-2' : '-ml-2'),
              )}
            >
              <InitialsAvatar name={name} src={member.user.avatarUrl} size="sm" className="pointer-events-none h-full w-full" />
            </button>
          )
        })}
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-label={open ? '收起成员' : `展开其余 ${hidden} 位成员`}
            className={cn(
              'relative inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-muted px-1 text-[10px] font-medium tabular-nums text-muted-foreground ring-2 ring-popover transition-[margin] duration-200',
              visible.length > 0 && (open ? 'ml-2' : '-ml-2'),
            )}
          >
            +{hidden}
          </button>
        )}
      </div>

      {active && (
        <div
          role="dialog"
          aria-label={`${memberName(active)} 的成员信息`}
          data-member-card
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          onFocusCapture={cancelClose}
          className="absolute right-0 top-[calc(100%+18px)] z-[60] w-[300px] rounded-lg border border-border bg-popover p-4 text-left shadow-elevation-lg"
        >
          <div className="flex items-start gap-3">
            <InitialsAvatar name={memberName(active)} src={active.user.avatarUrl} size="lg" />
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="truncate text-base font-semibold text-foreground">{memberName(active)}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {ROLE_LABEL[active.role] || active.role}
                {active.user.email ? ` · ${active.user.email}` : ''}
              </p>
              {active.user.phone && <p className="mt-0.5 text-xs text-muted-foreground">{active.user.phone}</p>}
            </div>
          </div>

          {active.createdAt && (
            <p className="mt-3 text-xs text-muted-foreground">
              加入于 {new Date(active.createdAt).toLocaleDateString('zh-CN')}
            </p>
          )}

          {(canChangeRole || canRemove) && (
            <div className="mt-3 space-y-3 border-t border-border pt-3">
              {canChangeRole && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">团队角色</p>
                  <div className="mt-1.5 inline-flex rounded-md bg-muted p-0.5">
                    {(['MEMBER', 'ADMIN'] as const).map((role) => (
                      <button
                        key={role}
                        type="button"
                        disabled={busy || active.role === role}
                        onClick={() => void changeRole(role)}
                        className={cn(
                          'rounded px-2.5 py-1 text-xs transition-colors disabled:opacity-100',
                          active.role === role ? 'bg-popover font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {ROLE_LABEL[role]}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {canRemove && (
                <button
                  type="button"
                  onClick={() => void remove()}
                  disabled={busy}
                  className="text-sm font-medium text-destructive transition-opacity hover:opacity-80 disabled:opacity-50"
                >
                  移除成员
                </button>
              )}
            </div>
          )}

          {error && <p className="mt-2 text-sm text-destructive" role="alert">{error}</p>}
        </div>
      )}
    </div>
  )
}
