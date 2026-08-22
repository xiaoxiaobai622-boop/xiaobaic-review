'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Building2,
  Check,
  Clock3,
  Copy,
  Crown,
  Inbox,
  LogOut,
  Pencil,
  Plus,
  Send,
  ShieldCheck,
  Trash2,
  UserCheck,
  Users,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAuth } from '@/components/AuthProvider'
import { apiDelete, apiFetch, apiPatch, apiPost } from '@/lib/api-client'
import { getActiveTeamId, setActiveTeamId } from '@/lib/team-store'

type TeamRole = 'OWNER' | 'ADMIN' | 'MEMBER'

type TeamCenterItem = {
  role: TeamRole
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

type IncomingInvite = {
  id: string
  teamId: string
  role: TeamRole
  token: string
  expiresAt: string
  createdAt: string
  team: { id: string; name: string; slug: string; avatarUrl: string | null }
}

type MyJoinRequest = {
  id: string
  teamId: string
  message: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  createdAt: string
  reviewedAt: string | null
  team: { id: string; name: string; slug: string; avatarUrl: string | null }
}

type Member = {
  id: string
  role: TeamRole
  status: string
  createdAt: string
  user: { id: string; name: string | null; email: string; phone: string | null }
}

type JoinRequest = {
  id: string
  status: string
  message: string | null
  createdAt: string
  user: { id: string; name: string | null; email: string; phone: string | null }
}

type InviteRecord = {
  id: string
  email: string | null
  phone: string | null
  role: TeamRole
  status: string
  expiresAt: string
  createdAt: string
  acceptedAt: string | null
}

const ROLE_LABELS: Record<TeamRole, string> = {
  OWNER: '创建人',
  ADMIN: '管理员',
  MEMBER: '成员',
}

const ROLE_CLASSES: Record<TeamRole, string> = {
  OWNER: 'bg-amber-500/15 text-amber-700 dark:text-amber-200',
  ADMIN: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-200',
  MEMBER: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-200',
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: '待审核',
  APPROVED: '已通过',
  REJECTED: '已拒绝',
  ACCEPTED: '已接受',
  REVOKED: '已撤回',
  EXPIRED: '已过期',
}

export default function TeamPage() {
  const { user } = useAuth()
  const [teams, setTeams] = useState<TeamCenterItem[]>([])
  const [incomingInvites, setIncomingInvites] = useState<IncomingInvite[]>([])
  const [myRequests, setMyRequests] = useState<MyJoinRequest[]>([])
  const [activeTeamId, setActiveTeamIdState] = useState<string | null>(getActiveTeamId())
  const [team, setTeam] = useState<{
    id: string
    name: string
    slug: string
    avatarUrl: string | null
    createdById: string
    createdAt: string
    _count: { projects: number; members: number }
  } | null>(null)
  const [currentRole, setCurrentRole] = useState<TeamRole | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [requests, setRequests] = useState<JoinRequest[]>([])
  const [invites, setInvites] = useState<InviteRecord[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [invitePhone, setInvitePhone] = useState('')
  const [inviteRole, setInviteRole] = useState<'MEMBER' | 'ADMIN'>('MEMBER')
  const [lastInviteUrl, setLastInviteUrl] = useState('')
  const [transferOpen, setTransferOpen] = useState(false)
  const [transferTargetId, setTransferTargetId] = useState('')
  const [editingTeamName, setEditingTeamName] = useState(false)
  const [teamNameDraft, setTeamNameDraft] = useState('')
  const [savingTeamName, setSavingTeamName] = useState(false)
  const [teamLinkCopied, setTeamLinkCopied] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refreshCenter = useCallback(async () => {
    const response = await apiFetch('/api/team-center')
    if (!response.ok) throw new Error('无法加载团队中心')
    const data = await response.json()
    setTeams(data.teams || [])
    setIncomingInvites(data.invitations || [])
    setMyRequests(data.joinRequests || [])

    const nextActiveId =
      activeTeamId && (data.teams || []).some((item: TeamCenterItem) => item.team.id === activeTeamId)
        ? activeTeamId
        : data.activeTeamId || data.teams?.[0]?.team.id || null
    setActiveTeamIdState(nextActiveId)
    if (nextActiveId) setActiveTeamId(nextActiveId)
    else localStorage.removeItem('vitransfer_active_team_id')
    return nextActiveId
  }, [activeTeamId])

  const refreshTeam = useCallback(async (teamId: string) => {
    const [teamRes, membersRes, requestsRes, invitesRes] = await Promise.all([
      apiFetch(`/api/teams/${teamId}`),
      apiFetch(`/api/teams/${teamId}/members`),
      apiFetch(`/api/teams/${teamId}/join-requests`),
      apiFetch(`/api/teams/${teamId}/invitations`),
    ])

    if (!teamRes.ok) {
      const data = await teamRes.json().catch(() => ({}))
      throw new Error(data.error || '无法加载团队')
    }

    const teamData = await teamRes.json()
    setTeam(teamData.team)
    setCurrentRole(teamData.currentRole)
    setMembers(membersRes.ok ? ((await membersRes.json()).members || []) : [])
    setRequests(requestsRes.ok ? ((await requestsRes.json()).requests || []) : [])
    setInvites(invitesRes.ok ? ((await invitesRes.json()).invites || []) : [])
  }, [])

  const refreshAll = useCallback(async () => {
    try {
      setError('')
      const nextTeamId = await refreshCenter()
      if (nextTeamId) await refreshTeam(nextTeamId)
    } catch (err) {
      setError(err instanceof Error ? err.message : '团队数据加载失败')
    }
  }, [refreshCenter, refreshTeam])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  useEffect(() => {
    if (!activeTeamId) return
    refreshTeam(activeTeamId).catch((err) => {
      setError(err instanceof Error ? err.message : '团队数据加载失败')
    })
  }, [activeTeamId, refreshTeam])

  const switchTeam = (teamId: string) => {
    setActiveTeamId(teamId)
    setActiveTeamIdState(teamId)
    setLastInviteUrl('')
  }

  const createTeam = async () => {
    const name = window.prompt('请输入新团队名称')
    if (!name?.trim()) return
    try {
      const created = await apiPost<{ team: { id: string } }>('/api/teams', { name: name.trim() })
      setActiveTeamId(created.team.id)
      setActiveTeamIdState(created.team.id)
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建团队失败')
    }
  }

  const invite = async () => {
    if (!activeTeamId || (!inviteEmail.trim() && !invitePhone.trim())) return
    try {
      setError('')
      const data = await apiPost<{ invite: { token: string } }>(`/api/teams/${activeTeamId}/invitations`, {
        email: inviteEmail.trim() || null,
        phone: invitePhone.trim() || null,
        role: inviteRole,
      })
      setInviteEmail('')
      setInvitePhone('')
      setLastInviteUrl(`${window.location.origin}/studio/team/invite/${data.invite.token}`)
      await refreshAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : '邀请失败')
    }
  }

  const acceptInvite = async (invite: IncomingInvite) => {
    try {
      setError('')
      await apiPost(`/api/teams/${invite.teamId}/invitations/${invite.token}/accept`, {})
      setActiveTeamId(invite.teamId)
      setActiveTeamIdState(invite.teamId)
      window.location.href = '/studio/projects'
    } catch (err) {
      setError(err instanceof Error ? err.message : '接受邀请失败')
    }
  }

  const declineInvite = async (invite: IncomingInvite) => {
    try {
      setError('')
      await apiPost(`/api/teams/${invite.teamId}/invitations/${invite.token}/decline`, {})
      await refreshCenter()
    } catch (err) {
      setError(err instanceof Error ? err.message : '拒绝邀请失败')
    }
  }

  const withdrawRequest = async (teamId: string) => {
    try {
      setError('')
      await apiDelete(`/api/teams/${teamId}/join-requests/my`)
      await refreshCenter()
    } catch (err) {
      setError(err instanceof Error ? err.message : '撤回申请失败')
    }
  }

  const review = async (requestId: string, status: 'APPROVED' | 'REJECTED') => {
    if (!activeTeamId) return
    try {
      setError('')
      await apiPatch(`/api/teams/${activeTeamId}/join-requests/${requestId}`, { status })
      await refreshAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : '审核失败')
    }
  }

  const removeMember = async (userId: string) => {
    if (!activeTeamId) return
    if (!window.confirm('确认移除该成员？')) return
    try {
      setError('')
      await apiDelete(`/api/teams/${activeTeamId}/members/${userId}`)
      await refreshAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : '移除成员失败')
    }
  }

  const changeRole = async (userId: string, role: 'ADMIN' | 'MEMBER') => {
    if (!activeTeamId) return
    try {
      setError('')
      await apiPatch(`/api/teams/${activeTeamId}/members/${userId}`, { role })
      await refreshAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : '修改角色失败')
    }
  }

  const leaveTeam = async () => {
    if (!activeTeamId) return
    if (!window.confirm('确认退出当前团队？')) return
    try {
      setError('')
      const result = await apiPost<{ nextTeamId: string | null }>(`/api/teams/${activeTeamId}/leave`, {})
      if (result.nextTeamId) setActiveTeamId(result.nextTeamId)
      else localStorage.removeItem('vitransfer_active_team_id')
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '退出团队失败')
    }
  }

  const transferOwner = async () => {
    if (!activeTeamId || !transferTargetId) return
    try {
      setError('')
      await apiPost(`/api/teams/${activeTeamId}/transfer-owner`, {
        targetUserId: transferTargetId,
      })
      setTransferOpen(false)
      await refreshAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : '转让团队失败')
    }
  }

  const deleteTeam = async () => {
    if (!activeTeamId) return
    if (!window.confirm('此操作会删除团队本身，团队中的项目不会被删除。确认继续？')) return
    try {
      setError('')
      await apiDelete(`/api/teams/${activeTeamId}`)
      localStorage.removeItem('vitransfer_active_team_id')
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除团队失败')
    }
  }

  const saveTeamName = async () => {
    const name = teamNameDraft.trim()
    if (!activeTeamId || !name) return
    setSavingTeamName(true)
    setError('')
    try {
      await apiPatch(`/api/teams/${activeTeamId}`, { name })
      setEditingTeamName(false)
      await refreshAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : '修改团队名称失败')
    } finally {
      setSavingTeamName(false)
    }
  }

  const copyTeamLink = async () => {
    if (!team) return
    const link = `${window.location.origin}/studio/team/join?q=${team.slug}`
    try {
      await navigator.clipboard.writeText(link)
      setTeamLinkCopied(true)
      window.setTimeout(() => setTeamLinkCopied(false), 1600)
    } catch {
      setError('复制失败，请手动复制团队链接')
    }
  }

  const revokeInvite = async (inviteId: string) => {
    if (!activeTeamId) return
    try {
      setError('')
      await apiDelete(`/api/teams/${activeTeamId}/invitations/${inviteId}`)
      await refreshAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : '撤回邀请失败')
    }
  }

  const canManage = currentRole === 'OWNER' || currentRole === 'ADMIN'
  const canChangeRoles = currentRole === 'OWNER'
  const activeTeam = teams.find((item) => item.team.id === activeTeamId)

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Building2 className="h-4 w-4" />
            团队中心
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">{team?.name || '我的团队'}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            一个人可以同时创建或加入多个团队，项目和设置按团队隔离。
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={createTeam}>
            <Plus className="mr-2 h-4 w-4" />
            创建团队
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link href="/studio/team/join">
              <LogOut className="mr-2 h-4 w-4" />
              申请加入
            </Link>
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive-visible p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-md border border-primary/20 bg-primary-visible p-3 text-sm text-foreground">
          {notice}
        </div>
      )}

      {teams.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>切换团队</CardTitle>
            <span className="text-xs text-muted-foreground">{teams.length} 个团队</span>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {teams.map((item) => (
              <button
                key={item.team.id}
                type="button"
                onClick={() => switchTeam(item.team.id)}
                className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                  item.team.id === activeTeamId
                    ? 'border-primary bg-primary-visible'
                    : 'border-border hover:bg-accent'
                }`}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-base font-semibold text-primary">
                  {item.team.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{item.team.name}</span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {ROLE_LABELS[item.role]}
                    {item.team._count ? ` · ${item.team._count.projects} 个项目` : ''}
                  </span>
                </span>
                {item.team.id === activeTeamId && <Check className="h-4 w-4 text-primary" />}
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {incomingInvites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Inbox className="h-5 w-5 text-primary" />
              我的邀请
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {incomingInvites.map((invite) => (
              <div
                key={invite.id}
                className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{invite.team.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    邀请你成为 {ROLE_LABELS[invite.role]} · {new Date(invite.expiresAt).toLocaleDateString()} 前有效
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" onClick={() => acceptInvite(invite)}>
                    <UserCheck className="mr-1.5 h-4 w-4" />
                    接受
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => declineInvite(invite)}>
                    <X className="mr-1.5 h-4 w-4" />
                    拒绝
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {myRequests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock3 className="h-5 w-5 text-primary" />
              我的申请
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {myRequests.map((request) => (
              <div
                key={request.id}
                className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{request.team.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {request.message || '未填写申请说明'} · {STATUS_LABELS[request.status] || request.status}
                  </p>
                </div>
                {request.status === 'PENDING' && (
                  <Button type="button" size="sm" variant="outline" onClick={() => withdrawRequest(request.teamId)}>
                    撤回
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {!activeTeam && teams.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">还没有团队，可以创建自己的团队，或申请加入已有团队。</p>
            <div className="mt-4 flex justify-center gap-2">
              <Button type="button" onClick={createTeam}>
                <Plus className="mr-2 h-4 w-4" />
                创建团队
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link href="/studio/team/join">申请加入团队</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {activeTeam && team && (
        <>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                当前团队信息
              </CardTitle>
              {currentRole && (
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${ROLE_CLASSES[currentRole]}`}>
                  {ROLE_LABELS[currentRole]}
                </span>
              )}
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">团队名称</p>
                {editingTeamName ? (
                  <div className="mt-1 flex gap-2">
                    <input
                      value={teamNameDraft}
                      onChange={(event) => setTeamNameDraft(event.target.value)}
                      className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-primary"
                    />
                    <Button type="button" size="sm" onClick={saveTeamName} disabled={savingTeamName || !teamNameDraft.trim()}>
                      保存
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setEditingTeamName(false)}>
                      取消
                    </Button>
                  </div>
                ) : (
                  <div className="mt-1 flex items-center gap-2">
                    <p className="text-sm font-medium">{team.name}</p>
                    {currentRole === 'OWNER' && (
                      <button
                        type="button"
                        aria-label="修改团队名称"
                        onClick={() => {
                          setTeamNameDraft(team.name)
                          setEditingTeamName(true)
                        }}
                        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">团队链接</p>
                <div className="mt-1 flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-mono">{window.location.origin}/studio/team/join?q={team.slug}</p>
                  <button
                    type="button"
                    onClick={copyTeamLink}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                    title={teamLinkCopied ? '已复制' : '复制团队链接'}
                  >
                    {teamLinkCopied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">成员 / 项目</p>
                <p className="mt-1 text-sm font-medium">{team._count.members} / {team._count.projects}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>成员</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {members.length === 0 && <p className="text-sm text-muted-foreground">暂无成员。</p>}
              {members.map((member) => (
                <div
                  key={member.id}
                  className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{member.user.name || member.user.email}</p>
                    <p className="truncate text-xs text-muted-foreground">{member.user.phone || member.user.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {canChangeRoles && member.role !== 'OWNER' ? (
                      <select
                        aria-label="修改成员角色"
                        value={member.role}
                        onChange={(event) => changeRole(member.user.id, event.target.value as 'ADMIN' | 'MEMBER')}
                        className="h-9 rounded-md border border-input bg-transparent px-2 text-xs"
                      >
                        <option value="MEMBER">成员</option>
                        <option value="ADMIN">管理员</option>
                      </select>
                    ) : (
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${ROLE_CLASSES[member.role]}`}>
                        {ROLE_LABELS[member.role]}
                      </span>
                    )}
                    {canManage && member.role !== 'OWNER' && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeMember(member.user.id)}>
                        移除
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {canManage && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>邀请成员</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-4">
                    <Input placeholder="邮箱" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} />
                    <Input placeholder="手机号" value={invitePhone} onChange={(event) => setInvitePhone(event.target.value)} />
                    <select
                      value={inviteRole}
                      onChange={(event) => setInviteRole(event.target.value as 'MEMBER' | 'ADMIN')}
                      className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
                    >
                      <option value="MEMBER">普通成员</option>
                      <option value="ADMIN">管理员</option>
                    </select>
                    <Button type="button" onClick={invite} disabled={!inviteEmail.trim() && !invitePhone.trim()}>
                      <Send className="mr-2 h-4 w-4" />
                      发送邀请
                    </Button>
                  </div>
                  {lastInviteUrl && (
                    <div className="rounded-md border border-primary/20 bg-primary-visible p-3">
                      <p className="text-xs text-muted-foreground">邀请链接</p>
                      <div className="mt-1 flex gap-2">
                        <input
                          readOnly
                          value={lastInviteUrl}
                          onFocus={(event) => event.currentTarget.select()}
                          className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => navigator.clipboard?.writeText(lastInviteUrl)}
                        >
                          复制
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>加入申请</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {requests.length === 0 && <p className="text-sm text-muted-foreground">暂无待审核申请。</p>}
                  {requests.map((request) => (
                    <div
                      key={request.id}
                      className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{request.user.name || request.user.email}</p>
                        {request.message && <p className="mt-1 text-xs text-muted-foreground">{request.message}</p>}
                      </div>
                      <div className="flex gap-2">
                        <Button type="button" size="sm" onClick={() => review(request.id, 'APPROVED')}>通过</Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => review(request.id, 'REJECTED')}>拒绝</Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>邀请记录</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {invites.length === 0 && <p className="text-sm text-muted-foreground">暂无邀请记录。</p>}
                  {invites.map((invite) => (
                    <div
                      key={invite.id}
                      className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm">{invite.email || invite.phone}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {ROLE_LABELS[invite.role]} · {STATUS_LABELS[invite.status] || invite.status}
                        </p>
                      </div>
                      {invite.status === 'PENDING' && (
                        <Button type="button" size="sm" variant="ghost" onClick={() => revokeInvite(invite.id)}>
                          撤回
                        </Button>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </>
          )}

          <Card>
            <CardHeader>
              <CardTitle>团队操作</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {currentRole !== 'OWNER' && (
                <div className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">退出当前团队</p>
                    <p className="mt-1 text-xs text-muted-foreground">退出后不会删除项目和团队，可重新加入或切换到其他团队。</p>
                  </div>
                  <Button type="button" variant="outline" onClick={leaveTeam}>
                    <LogOut className="mr-2 h-4 w-4" />
                    退出团队
                  </Button>
                </div>
              )}

              {currentRole === 'OWNER' && (
                <div className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">转让团队</p>
                    <p className="mt-1 text-xs text-muted-foreground">转让后你会成为管理员，新创建人拥有最高权限。</p>
                  </div>
                  <Button type="button" variant="outline" onClick={() => setTransferOpen(true)}>
                    <Crown className="mr-2 h-4 w-4" />
                    转让创建人
                  </Button>
                </div>
              )}

              {currentRole === 'OWNER' && (
                <div className="flex flex-col gap-2 rounded-lg border border-destructive/25 bg-destructive-visible p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-destructive">删除团队</p>
                    <p className="mt-1 text-xs text-muted-foreground">仅当团队没有项目且没有其他成员时才能删除。</p>
                  </div>
                  <Button type="button" variant="outline" onClick={deleteTeam}>
                    <Trash2 className="mr-2 h-4 w-4 text-destructive" />
                    删除团队
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-primary" />
              转让团队
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <label className="text-sm text-muted-foreground" htmlFor="transfer-target">选择新创建人</label>
            <select
              id="transfer-target"
              value={transferTargetId}
              onChange={(event) => setTransferTargetId(event.target.value)}
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">请选择成员</option>
              {members
                .filter((member) => member.role !== 'OWNER' && member.user.id !== user?.id)
                .map((member) => (
                  <option key={member.user.id} value={member.user.id}>
                    {member.user.name || member.user.email}
                  </option>
                ))}
            </select>
            <p className="text-xs text-muted-foreground">转让后你的角色会变为管理员。</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setTransferOpen(false)}>取消</Button>
              <Button type="button" onClick={transferOwner} disabled={!transferTargetId}>确认转让</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
