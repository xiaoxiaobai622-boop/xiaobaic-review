'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRightLeft, Building2, Check, Copy, Link2, MailPlus, MoreVertical, Power, ShieldCheck, UserPlus, X } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { appConfirm } from '@/components/AppDialogProvider'
import { useAuth } from '@/components/AuthProvider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StudioPageSkeleton } from '@/components/StudioPageSkeleton'
import { Input } from '@/components/ui/input'
import { apiDelete, apiFetch, apiPatch, apiPost } from '@/lib/api-client'
import { maskPhoneDisplay } from '@/lib/phone-display'
import { canProject, canTeam, type ProjectAction, type TeamAction } from '@/lib/project-policy'
import { useActionFeedback, ActionFeedback } from '@/components/ActionFeedback'

type Role = 'OWNER' | 'ADMIN' | 'MEMBER'
type InviteMethod = 'PHONE' | 'LINK'
type Member = {
  id: string
  role: Role
  status: string
  projectAccessScope: 'ALL_PROJECTS' | 'ASSIGNED_ONLY'
  defaultProjectRole: 'REVIEWER' | 'EDITOR'
  department: string | null
  lastActiveAt: string | null
  createdAt: string
  updatedAt?: string
  user: { id: string; name: string | null; email: string; phone: string | null; updatedAt?: string }
}
type RequestItem = { id: string; status: string; message: string | null; createdAt: string; user: { id: string; name: string | null; email: string; phone: string | null } }
type ProjectOption = { id: string; title: string; restricted?: boolean }
type ProjectGrantRole = 'PROJECT_ADMIN' | 'EDITOR' | 'REVIEWER'
type ProjectMemberRow = {
  id: string
  name: string | null
  source: 'teamAdmin' | 'allProjects' | 'assigned'
  projectRole: ProjectGrantRole | null
}
type ProjectMemberGroup = {
  projectId: string
  projectTitle: string
  restricted: boolean
  members: ProjectMemberRow[]
}
type Invite = {
  id: string
  method: InviteMethod
  phone: string | null
  email: string | null
  role: Role
  projectAccessScope: 'ALL_PROJECTS' | 'ASSIGNED_ONLY'
  defaultProjectRole: 'REVIEWER' | 'EDITOR'
  projects?: Array<{ projectId: string; role: ProjectGrantRole; project?: { title: string } }>
  status: string
  createdAt: string
  expiresAt: string
  acceptedAt: string | null
  declinedAt: string | null
  token?: string
}

const roleLabel: Record<Role, string> = { OWNER: '负责人', ADMIN: '管理员', MEMBER: '成员' }
const scopeLabel: Record<'ALL_PROJECTS' | 'ASSIGNED_ONLY', string> = { ALL_PROJECTS: '全部项目', ASSIGNED_ONLY: '指定项目' }
const projectRoleLabel: Record<'REVIEWER' | 'EDITOR', string> = { REVIEWER: '审阅者', EDITOR: '编辑者' }
const roleTone: Record<Role, string> = { OWNER: 'bg-amber-500/10 text-amber-700 dark:text-amber-300', ADMIN: 'bg-primary-visible text-primary', MEMBER: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' }
const inviteMethodLabel: Record<InviteMethod, string> = { PHONE: '手机号邀请', LINK: '链接邀请' }
const teamMatrix: Array<{ action: TeamAction; label: string }> = [
  { action: 'manageTeamSettings', label: '团队资料' },
  { action: 'manageBilling', label: '套餐/账单' },
  { action: 'inviteMember', label: '邀请成员' },
  { action: 'removeMember', label: '移除成员' },
  { action: 'changeRole', label: '修改团队角色' },
  { action: 'disableMember', label: '停用成员' },
  { action: 'transferOwner', label: '转让负责人' },
  { action: 'dissolveTeam', label: '解散团队' },
  { action: 'createProject', label: '创建项目' },
  { action: 'archiveProject', label: '归档项目' },
  { action: 'deleteProject', label: '删除项目' },
  { action: 'manageClients', label: '管理客户目录' },
  { action: 'viewAudit', label: '查看审计' },
]
const projectMatrix: Array<{ action: ProjectAction; label: string }> = [
  { action: 'view', label: '查看项目' },
  { action: 'comment', label: '批注' },
  { action: 'download', label: '下载' },
  { action: 'upload', label: '上传/改版本' },
  { action: 'edit', label: '编辑/删除素材' },
  { action: 'manageMembers', label: '管理项目成员' },
  { action: 'manageSettings', label: '项目设置/受限' },
  { action: 'share', label: '分享链接' },
  { action: 'approve', label: '审批' },
  { action: 'viewStats', label: '查看统计' },
]
const inviteStatusLabel: Record<string, string> = {
  PENDING: '待接受',
  ACCEPTED: '已接受',
  DECLINED: '已拒绝',
  REVOKED: '已撤销',
  EXPIRED: '已过期',
}
const inviteStatusTone: Record<string, string> = {
  PENDING: 'bg-primary-visible text-primary',
  ACCEPTED: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  DECLINED: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  REVOKED: 'bg-muted text-muted-foreground',
  EXPIRED: 'bg-muted text-muted-foreground',
}

function userLabel(user: { name: string | null; email: string; phone: string | null }) { return user.name || maskPhoneDisplay(user.phone) || user.email }

function initials(member: Member) { return userLabel(member.user).slice(0, 1).toUpperCase() }

/** 带链接的动作结果：常驻直到手动关闭，不像 toast 那样几秒后消失，方便反复复制。 */
function InviteLinkResult({ link, onCopy, onClose }: { link: string; onCopy: () => void; onClose: () => void }) {
  if (!link) return null
  return (
    <div className="flex max-w-xl items-center gap-2 rounded-md border border-border bg-muted/30 p-2">
      <code className="min-w-0 flex-1 truncate rounded bg-background/70 px-2 py-1 text-xs text-foreground" title={link}>{link}</code>
      <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={onCopy}><Copy className="h-3.5 w-3.5" />复制链接</Button>
      <Button type="button" size="sm" variant="ghost" className="shrink-0" onClick={onClose} aria-label="关闭链接结果"><X className="h-3.5 w-3.5" /></Button>
    </div>
  )
}

export default function TeamMembersPage() {
  const { user } = useAuth()
  const searchParams = useSearchParams()
  const tab = searchParams?.get('tab') || 'seats'
  const [teamId, setTeamId] = useState<string | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [requests, setRequests] = useState<RequestItem[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [projectMemberGroups, setProjectMemberGroups] = useState<ProjectMemberGroup[]>([])
  const [projectFilter, setProjectFilter] = useState('ALL')
  const [projectMemberQuery, setProjectMemberQuery] = useState('')
  const [inviteProjects, setInviteProjects] = useState<Record<string, ProjectGrantRole>>({})
  const [phone, setPhone] = useState('')
  const [inviteMethod, setInviteMethod] = useState<InviteMethod>('PHONE')
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteRole, setInviteRole] = useState<'ADMIN' | 'MEMBER'>('MEMBER')
  const [inviteScope, setInviteScope] = useState<'ALL_PROJECTS' | 'ASSIGNED_ONLY'>('ALL_PROJECTS')
  const [inviteDefaultRole, setInviteDefaultRole] = useState<'REVIEWER' | 'EDITOR'>('EDITOR')
  const [selected, setSelected] = useState<string[]>([])
  const [memberQuery, setMemberQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<'ALL' | Role>('ALL')
  const [scopeFilter, setScopeFilter] = useState<'ALL' | 'ALL_PROJECTS' | 'ASSIGNED_ONLY'>('ALL')
  const [loading, setLoading] = useState(true)
  // error 只承载页面级加载失败（顶部）；各动作的成功/错误就近放在所属卡片。
  const [error, setError] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [pendingLink, setPendingLink] = useState('')
  const inviteFeedback = useActionFeedback()
  const pendingFeedback = useActionFeedback()
  const membersFeedback = useActionFeedback()
  const requestsFeedback = useActionFeedback()
  /** 席位上限由服务端套餐给（0＝不限）；这里写死过 10，套餐是 5，进度条永远只画半条。 */
  const [seatCap, setSeatCap] = useState<number | null>(null)

  const canManage = user?.teamRole === 'OWNER' || user?.teamRole === 'ADMIN'
  const load = async (id: string) => {
    setError('')
    // 审核申请和邀请列表只对负责人/管理员开放；成员页不请求，免得每次进页都吃一个 403。
    const [memberRes, requestRes, inviteRes, overviewRes, projectRes] = await Promise.all([
      apiFetch(`/api/teams/${id}/members`, { cache: 'no-store' }),
      canManage ? apiFetch(`/api/teams/${id}/join-requests`, { cache: 'no-store' }) : Promise.resolve(null),
      canManage ? apiFetch(`/api/teams/${id}/invitations`, { cache: 'no-store' }) : Promise.resolve(null),
      apiFetch(`/api/teams/${id}/overview`, { cache: 'no-store' }),
      canManage ? apiFetch('/api/projects', { cache: 'no-store' }) : Promise.resolve(null),
    ])
    if (!memberRes.ok) throw new Error('无法加载成员')
    setMembers((await memberRes.json()).members || [])
    setRequests(requestRes?.ok ? ((await requestRes.json()).requests || []) : [])
    setInvites(inviteRes?.ok ? ((await inviteRes.json()).invites || []) : [])
    setProjects(projectRes?.ok ? ((await projectRes.json()).projects || []).map((project: any) => ({ id: project.id, title: project.title, restricted: Boolean(project.restricted) })) : [])
    const cap = overviewRes.ok ? Number((await overviewRes.json())?.quota?.maxMembers) : Number.NaN
    setSeatCap(Number.isFinite(cap) ? cap : null)
  }

  useEffect(() => {
    ;(async () => { try { const response = await apiFetch('/api/team-center', { cache: 'no-store' }); const data = await response.json(); const id = data.activeTeamId || data.teams?.[0]?.team.id; if (!id) { setLoading(false); return } setTeamId(id) } catch (reason) { setError(reason instanceof Error ? reason.message : '成员数据加载失败'); setLoading(false) } })()
  }, [])

  useEffect(() => {
    if (!teamId) return
    let cancelled = false
    ;(async () => {
      try { await load(teamId) } catch (reason) { setError(reason instanceof Error ? reason.message : '成员数据加载失败') } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [teamId, canManage])

  useEffect(() => {
    if (tab !== 'projects' || !canManage || projects.length === 0) return
    let cancelled = false
    ;(async () => {
      const groups = await Promise.all(projects.slice(0, 50).map(async (project) => {
        const response = await apiFetch(`/api/projects/${project.id}/members`, { cache: 'no-store' })
        if (!response.ok) return null
        const data = await response.json()
        return {
          projectId: project.id,
          projectTitle: project.title,
          restricted: Boolean(project.restricted),
          members: (data.members || []).map((member: any) => ({
            id: member.id,
            name: member.name,
            source: member.source,
            projectRole: member.projectRole ?? null,
          })),
        } as ProjectMemberGroup
      }))
      if (!cancelled) setProjectMemberGroups(groups.filter((group): group is ProjectMemberGroup => Boolean(group)))
    })()
    return () => { cancelled = true }
  }, [tab, canManage, projects])

  const activeMembers = members.filter((member) => member.status === 'ACTIVE')
  const disabledMembers = members.filter((member) => member.status === 'DISABLED')
  const pendingInvites = invites.filter((invite) => invite.status === 'PENDING')
  const memberMatches = (member: Member) => {
    const q = memberQuery.trim().toLowerCase()
    const haystack = [member.user.name, member.user.email, member.user.phone].filter(Boolean).join(' ').toLowerCase()
    if (q && !haystack.includes(q)) return false
    if (roleFilter !== 'ALL' && member.role !== roleFilter) return false
    if (scopeFilter !== 'ALL' && member.projectAccessScope !== scopeFilter) return false
    return true
  }
  const filteredActiveMembers = activeMembers.filter(memberMatches)
  const filteredDisabledMembers = disabledMembers.filter(memberMatches)
  const selectableMembers = filteredActiveMembers.filter((member) => member.role !== 'OWNER')
  const seatFull = seatCap !== null && seatCap > 0 && activeMembers.length >= seatCap
  const projectRoleText = (role: ProjectGrantRole | null) => role === 'PROJECT_ADMIN' ? '项目管理员' : role === 'EDITOR' ? '编辑' : role === 'REVIEWER' ? '审阅' : '—'
  const sourceText = (source: ProjectMemberRow['source']) => source === 'teamAdmin' ? '团队管理员（隐式项目管理员）' : source === 'allProjects' ? '全部项目成员（只读）' : '本项目授权'
  const visibleProjectGroups = projectMemberGroups
    .filter((group) => projectFilter === 'ALL' || group.projectId === projectFilter)
    .map((group) => ({
      ...group,
      members: group.members.filter((member) => {
        const q = projectMemberQuery.trim().toLowerCase()
        return !q || (member.name || '').toLowerCase().includes(q) || member.id.toLowerCase().includes(q)
      }),
    }))
    .filter((group) => group.members.length > 0)
  const departmentGroups = Array.from(
    activeMembers.reduce((groups, member) => {
      const key = member.department?.trim() || '未分组'
      groups.set(key, [...(groups.get(key) || []), member])
      return groups
    }, new Map<string, Member[]>()),
  ).sort(([a], [b]) => a.localeCompare(b, 'zh-CN'))
  const canDisableTarget = (member: Member) => member.role !== 'OWNER' && (user?.teamRole === 'OWNER' || (user?.teamRole === 'ADMIN' && member.role === 'MEMBER'))
  const canRemoveTarget = (member: Member) => member.role !== 'OWNER' && (user?.teamRole === 'OWNER' || (user?.teamRole === 'ADMIN' && member.role === 'MEMBER'))

  const refresh = async () => { if (!teamId) return; await load(teamId); setSelected([]) }
  const invite = async () => {
    if (!teamId || inviteBusy) return
    if (inviteMethod === 'PHONE' && !/^1\d{10}$/.test(phone)) {
      inviteFeedback.show('error', '请输入有效的 11 位手机号')
      return
    }
    const grants = Object.entries(inviteProjects).map(([projectId, role]) => ({ projectId, role }))
    if (inviteScope === 'ASSIGNED_ONLY' && grants.length === 0) {
      inviteFeedback.show('error', '请至少选择一个项目，或把项目访问改为“全部项目”')
      return
    }
    setInviteBusy(true)
    inviteFeedback.clear()
    try {
      const result = await apiPost<{ invite: { token: string; expiresAt: string } }>(`/api/teams/${teamId}/invitations`, {
        method: inviteMethod,
        phone: inviteMethod === 'PHONE' ? phone : null,
        email: null,
        role: inviteRole,
        projectAccessScope: inviteScope,
        defaultProjectRole: inviteDefaultRole,
        projects: inviteScope === 'ASSIGNED_ONLY' ? grants : undefined,
      })
      if (inviteMethod === 'PHONE') setPhone('')
      setInviteProjects({})
      setInviteLink(`${window.location.origin}/studio/team/invite/${encodeURIComponent(result.invite.token)}`)
      inviteFeedback.show('success', inviteMethod === 'LINK' ? '链接邀请已生成，复制后发给对方' : '邀请已创建，请把邀请链接发给对方')
      await refresh()
      // 从页头按钮触发时，把邀请卡滚进视野，确保提示与链接看得见。
      document.getElementById('invite-member-card')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    } catch (reason) {
      inviteFeedback.show('error', reason instanceof Error ? reason.message : '邀请失败')
    } finally {
      setInviteBusy(false)
    }
  }
  const toggleInviteProject = (projectId: string, checked: boolean) => {
    setInviteProjects((current) => {
      const next = { ...current }
      if (checked) next[projectId] = 'REVIEWER'
      else delete next[projectId]
      return next
    })
  }
  const setInviteProjectRole = (projectId: string, role: ProjectGrantRole) => {
    setInviteProjects((current) => ({ ...current, [projectId]: role }))
  }
  const copyLink = async (link: string, show: (kind: 'success' | 'error', text: string) => void) => {
    if (!link) return
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(link)
      show('success', '邀请链接已复制')
    } catch {
      show('error', '复制失败，请长按链接手动复制')
    }
  }
  const remove = async (id: string) => { if (!teamId || !await appConfirm('确认移除该成员？')) return; try { await apiDelete(`/api/teams/${teamId}/members/${id}`); await refresh(); membersFeedback.show('success', '成员已移除') } catch (reason) { membersFeedback.show('error', reason instanceof Error ? reason.message : '移除失败') } }
  const bulkRemove = async () => { if (!selected.length || !await appConfirm(`确认移除选中的 ${selected.length} 名成员？`)) return; try { await Promise.all(selected.map((id) => apiDelete(`/api/teams/${teamId}/members/${id}`))); await refresh(); membersFeedback.show('success', `已移除 ${selected.length} 名成员`) } catch (reason) { membersFeedback.show('error', reason instanceof Error ? reason.message : '批量移除失败') } }
  const bulkDisable = async () => {
    if (!teamId || !selected.length) return
    if (!await appConfirm(`确认停用选中的 ${selected.length} 名成员？停用会立即释放席位。`)) return
    try {
      await Promise.all(selected.map((id) => apiPatch(`/api/teams/${teamId}/members/${id}`, { status: 'DISABLED' })))
      await refresh()
      membersFeedback.show('success', `已停用 ${selected.length} 名成员`)
    } catch (reason) {
      membersFeedback.show('error', reason instanceof Error ? reason.message : '批量停用失败')
    }
  }
  const changeRole = async (userId: string, role: 'ADMIN' | 'MEMBER') => { if (!teamId) return; try { await apiPatch(`/api/teams/${teamId}/members/${userId}`, { role }); await refresh(); membersFeedback.show('success', '团队角色已更新') } catch (reason) { membersFeedback.show('error', reason instanceof Error ? reason.message : '修改角色失败') } }
  const changeAccess = async (userId: string, patch: { projectAccessScope?: 'ALL_PROJECTS' | 'ASSIGNED_ONLY'; defaultProjectRole?: 'REVIEWER' | 'EDITOR' }) => {    if (!teamId) return
    try {
      await apiPatch(`/api/teams/${teamId}/members/${userId}`, patch)
      await refresh()
    } catch (reason) {
      membersFeedback.show('error', reason instanceof Error ? reason.message : '修改项目权限失败')
    }
  }
  const setStatus = async (userId: string, status: 'ACTIVE' | 'DISABLED') => {
    if (!teamId) return
    try {
      await apiPatch(`/api/teams/${teamId}/members/${userId}`, { status })
      await refresh()
      membersFeedback.show('success', status === 'ACTIVE' ? '成员已启用' : '成员已停用')
    } catch (reason) {
      membersFeedback.show('error', reason instanceof Error ? reason.message : '修改成员状态失败')
    }
  }
  const changeDepartment = async (userId: string, department: string) => {
    if (!teamId) return
    try {
      await apiPatch(`/api/teams/${teamId}/members/${userId}`, { department })
      await refresh()
    } catch (reason) {
      membersFeedback.show('error', reason instanceof Error ? reason.message : '修改部门失败')
    }
  }
  const transferOwner = async (userId: string, name: string) => {    if (!teamId) return
    const ok = await appConfirm({
      title: '转让团队',
      message: `确认把团队转让给 ${name}？转让后你会降为管理员，且无法撤销。`,
      confirmLabel: '转让',
      tone: 'destructive',
    })
    if (!ok) return
    try {
      await apiPost(`/api/teams/${teamId}/transfer-owner`, { targetUserId: userId })
      window.location.reload()
    } catch (reason) {
      membersFeedback.show('error', reason instanceof Error ? reason.message : '转让团队失败')
    }
  }
  const review = async (id: string, status: 'APPROVED' | 'REJECTED') => { if (!teamId) return; try { await apiPatch(`/api/teams/${teamId}/join-requests/${id}`, { status }); await refresh(); requestsFeedback.show('success', status === 'APPROVED' ? '已通过申请' : '已拒绝申请') } catch (reason) { requestsFeedback.show('error', reason instanceof Error ? reason.message : '审核失败') } }
  const revokeInvite = async (entry: Invite) => {
    const target = entry.method === 'LINK'
      ? '这个链接邀请'
      : maskPhoneDisplay(entry.phone) || entry.email || '该成员'
    if (!teamId || !await appConfirm(`撤销对 ${target} 的邀请？`)) return
    try {
      await apiDelete(`/api/teams/${teamId}/invitations/${entry.id}`)
      await refresh()
      pendingFeedback.show('success', '邀请已撤销')
    } catch (reason) {
      pendingFeedback.show('error', reason instanceof Error ? reason.message : '撤销邀请失败')
    }
  }
  const regenerateInvite = async (entry: Invite) => {
    if (!teamId) return
    const confirmed = await appConfirm(
      entry.method === 'LINK'
        ? '重新生成后旧链接立即失效，继续？'
        : '重发后旧邀请链接立即失效，继续？',
    )
    if (!confirmed) return
    try {
      const result = await apiPost<{ invite: { token: string } }>(`/api/teams/${teamId}/invitations`, {
        regenerateFrom: entry.id,
      })
      setPendingLink(`${window.location.origin}/studio/team/invite/${encodeURIComponent(result.invite.token)}`)
      pendingFeedback.show('success', entry.method === 'LINK' ? '链接已重新生成，旧链接已失效' : '邀请已重发，旧链接已失效')
      await refresh()
    } catch (reason) {
      pendingFeedback.show('error', reason instanceof Error ? reason.message : '重新生成邀请失败')
    }
  }

  if (loading) return <StudioPageSkeleton label="正在加载成员管理..." />
  if (!teamId) return <Card><CardContent className="py-16 text-center text-sm text-muted-foreground">请先加入一个团队。</CardContent></Card>

  return <div className="space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-2xl font-semibold tracking-normal">{canManage ? '成员管理' : '团队成员'}</h1><p className="mt-1 text-sm text-muted-foreground">{canManage ? '管理团队成员、组织结构和项目成员。' : '查看团队里有谁。邀请或移除成员需要团队负责人或管理员权限。'}</p></div>{tab === 'seats' && canManage && <Button onClick={invite} disabled={inviteBusy || seatFull} title={seatFull ? '席位已满，请先停用/移除成员或升级套餐' : undefined}>{inviteMethod === 'LINK' ? <Link2 className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}{inviteBusy ? '处理中...' : seatFull ? '席位已满' : inviteMethod === 'LINK' ? '生成链接' : '邀请成员'}</Button>}</div>
    {error && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive-visible p-3 text-sm text-destructive">{error}</div>}

    {tab === 'seats' && <>
      <Card><CardHeader className="pb-3"><CardTitle className="text-base">席位使用</CardTitle></CardHeader><CardContent><div className="flex flex-wrap items-end justify-between gap-3"><div><span className="text-2xl font-semibold">{activeMembers.length}</span><span className="ml-1 text-sm text-muted-foreground">{seatCap ? ` / ${seatCap} 位成员` : '位成员'}</span><p className="mt-1 text-xs text-muted-foreground">已启用 {activeMembers.length} · 待接受 {pendingInvites.length}（不占席） · 已停用 {disabledMembers.length}（不占席）</p>{seatFull && <p className="mt-2 text-xs text-destructive">席位已满：先停用/移除成员，或升级套餐。待接受邀请不占席，但在满员时不能创建新邀请。</p>}</div><span className="text-sm text-muted-foreground">包含负责人和管理员</span></div>{seatCap ? <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full transition-[width] ${seatFull ? 'bg-destructive' : 'bg-primary'}`} style={{ width: `${Math.min(100, activeMembers.length / seatCap * 100)}%` }} /></div> : <p className="mt-2 text-xs text-muted-foreground">{seatCap === 0 ? '当前套餐不限席位。' : '席位上限加载中。'}</p>}</CardContent></Card>
      {canManage && <Card id="invite-member-card"><CardHeader><CardTitle className="text-base">邀请成员</CardTitle></CardHeader><CardContent className="space-y-3">
        <div role="tablist" aria-label="邀请方式" className="inline-flex rounded-lg border border-border bg-muted/30 p-1">
          <button type="button" role="tab" aria-selected={inviteMethod === 'PHONE'} onClick={() => setInviteMethod('PHONE')} className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm transition-colors ${inviteMethod === 'PHONE' ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}><MailPlus className="h-3.5 w-3.5" />手机号邀请</button>
          <button type="button" role="tab" aria-selected={inviteMethod === 'LINK'} onClick={() => setInviteMethod('LINK')} className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm transition-colors ${inviteMethod === 'LINK' ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}><Link2 className="h-3.5 w-3.5" />链接邀请</button>
        </div>
        {inviteMethod === 'PHONE' ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_130px_140px_140px_auto]">
          <Input value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, ''))} maxLength={11} placeholder="手机号" aria-label="手机号" />
          <select aria-label="团队角色" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as 'ADMIN' | 'MEMBER')} className="h-10 rounded-lg border border-input bg-background px-3 text-sm"><option value="MEMBER">普通成员</option><option value="ADMIN">管理员</option></select>
          <select aria-label="项目访问范围" value={inviteScope} onChange={(event) => setInviteScope(event.target.value as 'ALL_PROJECTS' | 'ASSIGNED_ONLY')} className="h-10 rounded-lg border border-input bg-background px-3 text-sm"><option value="ALL_PROJECTS">全部项目</option><option value="ASSIGNED_ONLY">指定项目</option></select>
          <select aria-label="默认项目角色" value={inviteDefaultRole} onChange={(event) => setInviteDefaultRole(event.target.value as 'REVIEWER' | 'EDITOR')} className="h-10 rounded-lg border border-input bg-background px-3 text-sm"><option value="EDITOR">编辑者</option><option value="REVIEWER">审阅者</option></select>
          <Button type="button" onClick={invite} disabled={inviteBusy}><MailPlus className="h-4 w-4" />{inviteBusy ? '处理中...' : '发送邀请'}</Button>
        </div> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[130px_140px_140px_auto]">
          <select aria-label="团队角色" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as 'ADMIN' | 'MEMBER')} className="h-10 rounded-lg border border-input bg-background px-3 text-sm"><option value="MEMBER">普通成员</option><option value="ADMIN">管理员</option></select>
          <select aria-label="项目访问范围" value={inviteScope} onChange={(event) => setInviteScope(event.target.value as 'ALL_PROJECTS' | 'ASSIGNED_ONLY')} className="h-10 rounded-lg border border-input bg-background px-3 text-sm"><option value="ALL_PROJECTS">全部项目</option><option value="ASSIGNED_ONLY">指定项目</option></select>
          <select aria-label="默认项目角色" value={inviteDefaultRole} onChange={(event) => setInviteDefaultRole(event.target.value as 'REVIEWER' | 'EDITOR')} className="h-10 rounded-lg border border-input bg-background px-3 text-sm"><option value="EDITOR">编辑者</option><option value="REVIEWER">审阅者</option></select>
          <Button type="button" onClick={invite} disabled={inviteBusy}><Link2 className="h-4 w-4" />{inviteBusy ? '处理中...' : '生成链接'}</Button>
        </div>}
        {inviteMethod === 'LINK' && <p className="text-xs text-muted-foreground">链接邀请不绑定手机号，7 天内有效；首个接受或拒绝后失效，可随时重新生成。</p>}
        {inviteScope === 'ASSIGNED_ONLY' && <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">项目与项目角色</p>
              <p className="text-xs text-muted-foreground">接受邀请后自动写入这些项目成员行；至少选择一个项目。</p>
            </div>
            <span className="text-xs text-muted-foreground">已选 {Object.keys(inviteProjects).length} 个</span>
          </div>
          {projects.length === 0 ? <p className="py-3 text-sm text-muted-foreground">暂无可分配项目。先创建项目，或把访问范围改为“全部项目”。</p> : <div className="max-h-56 divide-y divide-border overflow-y-auto rounded-md border border-border bg-background">
            {projects.map((project) => {
              const role = inviteProjects[project.id]
              return <div key={project.id} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <label className="flex min-w-0 items-center gap-2 text-sm">
                  <input type="checkbox" checked={role !== undefined} onChange={(event) => toggleInviteProject(project.id, event.target.checked)} />
                  <span className="truncate">{project.title}</span>
                </label>
                {role && <select aria-label={`${project.title} 的项目角色`} value={role} onChange={(event) => setInviteProjectRole(project.id, event.target.value as ProjectGrantRole)} className="h-8 rounded-md border border-input bg-background px-2 text-xs"><option value="REVIEWER">审阅者</option><option value="EDITOR">编辑者</option><option value="PROJECT_ADMIN">项目管理员</option></select>}
              </div>
            })}
          </div>}
        </div>}
        {(inviteFeedback.feedback || inviteLink) && <div className="space-y-2"><ActionFeedback feedback={inviteFeedback.feedback} onDismiss={inviteFeedback.clear} /><InviteLinkResult link={inviteLink} onCopy={() => void copyLink(inviteLink, inviteFeedback.show)} onClose={() => setInviteLink('')} /></div>}
      </CardContent></Card>}
      <Card><CardContent className="flex flex-wrap items-center gap-2 pt-4"><Input value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} placeholder="搜索姓名 / 手机号 / 邮箱" className="h-9 w-full sm:w-56" /><select aria-label="按团队角色筛选" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as 'ALL' | Role)} className="h-9 rounded-lg border border-input bg-background px-2 text-sm"><option value="ALL">全部团队角色</option><option value="OWNER">负责人</option><option value="ADMIN">管理员</option><option value="MEMBER">成员</option></select><select aria-label="按项目访问筛选" value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value as 'ALL' | 'ALL_PROJECTS' | 'ASSIGNED_ONLY')} className="h-9 rounded-lg border border-input bg-background px-2 text-sm"><option value="ALL">全部项目访问</option><option value="ALL_PROJECTS">全部项目</option><option value="ASSIGNED_ONLY">指定项目</option></select><span className="ml-auto text-xs text-muted-foreground">匹配 {filteredActiveMembers.length} 位已启用成员</span></CardContent></Card>
      <Card><CardHeader className="flex flex-row items-center justify-between space-y-0"><CardTitle className="text-base">已启用成员 <span className="ml-1 text-sm font-normal text-muted-foreground">{filteredActiveMembers.length}</span></CardTitle>{canManage && <div className="flex gap-2"><Button variant="outline" size="sm" onClick={bulkDisable} disabled={!selected.length}>批量停用</Button><Button variant="outline" size="sm" onClick={bulkRemove} disabled={!selected.length}>批量移除</Button></div>}</CardHeader>{membersFeedback.feedback && <div className="px-6 pb-2"><ActionFeedback feedback={membersFeedback.feedback} onDismiss={membersFeedback.clear} /></div>}<CardContent className="overflow-x-auto p-0"><table className="w-full min-w-[960px] text-sm"><thead><tr className="border-y border-border bg-muted/40 text-left text-xs text-muted-foreground"><th className="w-12 px-5 py-3"><input type="checkbox" aria-label="全选成员" disabled={!canManage} checked={selectableMembers.length > 0 && selected.length === selectableMembers.length} onChange={(event) => setSelected(event.target.checked ? selectableMembers.map((member) => member.user.id) : [])} /></th><th className="px-3 py-3 font-medium">昵称</th><th className="px-3 py-3 font-medium">角色</th><th className="px-3 py-3 font-medium">项目访问</th><th className="px-3 py-3 font-medium">最后活跃时间</th><th className="px-5 py-3 text-right font-medium">操作</th></tr></thead><tbody>{filteredActiveMembers.map((member) => <tr key={member.id} className="border-b border-border last:border-0"><td className="px-5 py-3">{member.role !== 'OWNER' && <input type="checkbox" disabled={!canManage} aria-label={`选择 ${userLabel(member.user)}`} checked={selected.includes(member.user.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, member.user.id] : current.filter((id) => id !== member.user.id))} />}</td><td className="px-3 py-3"><div className="flex items-center gap-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">{initials(member)}</span><div><p className="font-medium">{member.user.name || maskPhoneDisplay(member.user.phone) || '未命名成员'}</p><p className="text-xs text-muted-foreground">{maskPhoneDisplay(member.user.phone) || member.user.email}</p></div></div></td><td className="px-3 py-3">{member.role === 'OWNER' || user?.teamRole !== 'OWNER' ? <span className={`rounded-full px-2 py-1 text-xs ${roleTone[member.role]}`}>{roleLabel[member.role]}</span> : <select disabled={!canManage} aria-label={`修改 ${member.user.name || member.user.email} 的角色`} value={member.role} onChange={(event) => void changeRole(member.user.id, event.target.value as 'ADMIN' | 'MEMBER')} className="h-8 rounded-md border border-input bg-background px-2 text-xs"><option value="ADMIN">管理员</option><option value="MEMBER">成员</option></select>}</td><td className="px-3 py-3">{member.role !== 'MEMBER' ? <span className="text-xs text-muted-foreground">全部项目 · 管理</span> : canManage ? <div className="flex items-center gap-1"><select aria-label={`${userLabel(member.user)} 的项目访问`} value={member.projectAccessScope} onChange={(event) => void changeAccess(member.user.id, { projectAccessScope: event.target.value as 'ALL_PROJECTS' | 'ASSIGNED_ONLY' })} className="h-8 rounded-md border border-input bg-background px-1.5 text-xs"><option value="ALL_PROJECTS">全部项目</option><option value="ASSIGNED_ONLY">指定项目</option></select><select aria-label={`${userLabel(member.user)} 的默认项目角色`} value={member.defaultProjectRole} onChange={(event) => void changeAccess(member.user.id, { defaultProjectRole: event.target.value as 'REVIEWER' | 'EDITOR' })} className="h-8 rounded-md border border-input bg-background px-1.5 text-xs"><option value="REVIEWER">审阅者</option><option value="EDITOR">编辑者</option></select></div> : <span className="text-xs text-muted-foreground">{scopeLabel[member.projectAccessScope]} · {projectRoleLabel[member.defaultProjectRole]}</span>}</td><td className="px-3 py-3 text-muted-foreground">{member.lastActiveAt ? new Date(member.lastActiveAt).toLocaleDateString('zh-CN') : '从未活跃'}</td><td className="px-5 py-3 text-right">{canManage && <div className="flex justify-end gap-1">{user?.teamRole === 'OWNER' && member.role !== 'OWNER' && <button type="button" title="转让团队" aria-label="转让团队" onClick={() => void transferOwner(member.user.id, userLabel(member.user))} className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"><ArrowRightLeft className="h-4 w-4" /></button>}{canDisableTarget(member) && <button type="button" title="停用成员" aria-label="停用成员" onClick={() => void setStatus(member.user.id, 'DISABLED')} className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"><Power className="h-4 w-4" /></button>}{canRemoveTarget(member) && <button type="button" title="移除成员" aria-label="移除成员" onClick={() => void remove(member.user.id)} className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-destructive"><MoreVertical className="h-4 w-4" /></button>}</div>}</td></tr>)}</tbody></table>{filteredActiveMembers.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted-foreground">{activeMembers.length === 0 ? '还没有已启用成员。点击右上角“邀请成员”开始。' : '没有匹配的成员，调整搜索或筛选条件。'}</p>}</CardContent></Card>
      {canManage && <Card><CardHeader className="flex flex-row items-center justify-between space-y-0"><CardTitle className="text-base">已停用成员 <span className="ml-1 text-sm font-normal text-muted-foreground">{filteredDisabledMembers.length}</span></CardTitle><span className="text-xs text-muted-foreground">不占席位</span></CardHeader><CardContent>{filteredDisabledMembers.length === 0 ? <p className="py-6 text-sm text-muted-foreground">{disabledMembers.length === 0 ? '暂无已停用成员。' : '没有匹配的已停用成员。'}</p> : <div className="divide-y divide-border">{filteredDisabledMembers.map((member) => <div key={member.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">{userLabel(member.user)}</p><p className="mt-1 text-xs text-muted-foreground">{roleLabel[member.role]} · {member.lastActiveAt ? `最后活跃 ${new Date(member.lastActiveAt).toLocaleDateString('zh-CN')}` : '从未活跃'}</p></div><div className="flex gap-2">{canDisableTarget(member) && <Button size="sm" variant="outline" onClick={() => void setStatus(member.user.id, 'ACTIVE')}>启用</Button>}{canRemoveTarget(member) && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void remove(member.user.id)}>移除</Button>}</div></div>)}</div>}</CardContent></Card>}
      {canManage && <Card><CardHeader className="flex flex-row items-center justify-between space-y-0"><CardTitle className="text-base">待接受邀请</CardTitle><span className="text-xs text-muted-foreground">{pendingInvites.length} 条</span></CardHeader>{(pendingFeedback.feedback || pendingLink) && <div className="space-y-2 px-6 pb-2"><ActionFeedback feedback={pendingFeedback.feedback} onDismiss={pendingFeedback.clear} /><InviteLinkResult link={pendingLink} onCopy={() => void copyLink(pendingLink, pendingFeedback.show)} onClose={() => setPendingLink('')} /></div>}<CardContent>{pendingInvites.length === 0 ? <p className="py-6 text-sm text-muted-foreground">暂无待接受邀请。用下方“邀请成员”创建手机号邀请或链接邀请。</p> : <div className="divide-y divide-border">{pendingInvites.map((entry) => {
        const status = entry.status
        return <div key={entry.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">{entry.method === 'LINK' ? '链接邀请' : maskPhoneDisplay(entry.phone) || entry.email || '未填写联系方式'}</p>
              <span className={`rounded-full px-2 py-0.5 text-xs ${inviteStatusTone[status] || 'bg-muted text-muted-foreground'}`}>{inviteStatusLabel[status] || status}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{inviteMethodLabel[entry.method]} · {roleLabel[entry.role]} · {scopeLabel[entry.projectAccessScope]} · {projectRoleLabel[entry.defaultProjectRole]} · 有效期至 {new Date(entry.expiresAt).toLocaleString('zh-CN')}</p>
            {entry.projects && entry.projects.length > 0 && <p className="mt-1 text-xs text-muted-foreground">项目：{entry.projects.map((project) => `${project.project?.title || project.projectId}（${project.role === 'PROJECT_ADMIN' ? '项目管理员' : project.role === 'EDITOR' ? '编辑' : '审阅'}）`).join('、')}</p>}
          </div>
          {status === 'PENDING' && <div className="flex shrink-0 gap-2"><Button size="sm" variant="outline" onClick={() => void regenerateInvite(entry)}>{entry.method === 'LINK' ? '重新生成' : '重发'}</Button><Button size="sm" variant="ghost" className="text-destructive" onClick={() => void revokeInvite(entry)}>撤销</Button></div>}
        </div>
      })}</div>}</CardContent></Card>}
      {canManage && <Card><CardHeader className="flex flex-row items-center justify-between space-y-0"><CardTitle className="text-base">成员审批</CardTitle><span className="text-xs text-muted-foreground">{requests.length} 条申请</span></CardHeader>{requestsFeedback.feedback && <div className="px-6 pb-2"><ActionFeedback feedback={requestsFeedback.feedback} onDismiss={requestsFeedback.clear} /></div>}<CardContent>{requests.length === 0 ? <p className="text-sm text-muted-foreground">暂无待审核申请。</p> : <div className="divide-y divide-border">{requests.map((request) => <div key={request.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">{userLabel(request.user)}</p><p className="mt-1 text-xs text-muted-foreground">{request.message || '未填写申请说明'} · {new Date(request.createdAt).toLocaleDateString('zh-CN')}</p></div><div className="flex gap-2"><Button size="sm" onClick={() => void review(request.id, 'APPROVED')}><Check className="h-3.5 w-3.5" />通过</Button><Button size="sm" variant="outline" onClick={() => void review(request.id, 'REJECTED')}><X className="h-3.5 w-3.5" />拒绝</Button></div></div>)}</div>}</CardContent></Card>}
    </>}

    {tab === 'org' && <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Building2 className="h-4 w-4 text-primary" />组织结构</CardTitle></CardHeader><CardContent className="space-y-5">{departmentGroups.length === 0 ? <p className="py-8 text-sm text-muted-foreground">还没有成员。邀请成员后可按部门分组。</p> : departmentGroups.map(([department, groupMembers]) => <section key={department}><h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">{department}<span className="text-xs font-normal text-muted-foreground">{groupMembers.length} 人</span></h3><div className="divide-y divide-border rounded-lg border border-border">{groupMembers.map((member) => <div key={member.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="truncate text-sm font-medium">{userLabel(member.user)}</p><p className="text-xs text-muted-foreground">{roleLabel[member.role]}</p></div>{canManage ? <Input key={`${member.id}-${member.department || ''}`} defaultValue={member.department || ''} placeholder="填写部门" aria-label={`${userLabel(member.user)} 的部门`} className="h-8 w-full sm:w-48" onBlur={(event) => { const next = event.target.value.trim(); if (next !== (member.department || '')) void changeDepartment(member.user.id, next) }} /> : <span className="text-xs text-muted-foreground">{member.department || '未分组'}</span>}</div>)}</div></section>)}</CardContent></Card>}
    {tab === 'roles' && <div className="space-y-5">
      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-primary" />团队角色 × 团队动作</CardTitle></CardHeader><CardContent className="overflow-x-auto p-0"><table className="w-full min-w-[560px] text-sm"><thead><tr className="border-y border-border bg-muted/40 text-left text-xs text-muted-foreground"><th className="px-4 py-3 font-medium">动作</th>{(['OWNER', 'ADMIN', 'MEMBER'] as Role[]).map((role) => <th key={role} className="px-4 py-3 text-center font-medium">{roleLabel[role]}</th>)}</tr></thead><tbody>{teamMatrix.map((item) => <tr key={item.action} className="border-b border-border last:border-0"><td className="px-4 py-2.5">{item.label}</td>{(['OWNER', 'ADMIN', 'MEMBER'] as Role[]).map((role) => <td key={role} className="px-4 py-2.5 text-center">{canTeam(role, item.action) ? <span className="text-emerald-600">允许</span> : <span className="text-muted-foreground">—</span>}</td>)}</tr>)}</tbody></table></CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-primary" />项目角色 × 项目动作</CardTitle></CardHeader><CardContent className="overflow-x-auto p-0"><table className="w-full min-w-[760px] text-sm"><thead><tr className="border-y border-border bg-muted/40 text-left text-xs text-muted-foreground"><th className="px-4 py-3 font-medium">动作</th>{(['PROJECT_ADMIN', 'EDITOR', 'REVIEWER'] as const).map((role) => <th key={role} className="px-4 py-3 text-center font-medium">{role === 'PROJECT_ADMIN' ? '项目管理员' : role === 'EDITOR' ? '编辑' : '审阅'}</th>)}</tr></thead><tbody>{projectMatrix.map((item) => <tr key={item.action} className="border-b border-border last:border-0"><td className="px-4 py-2.5">{item.label}</td>{(['PROJECT_ADMIN', 'EDITOR', 'REVIEWER'] as const).map((role) => <td key={role} className="px-4 py-2.5 text-center">{canProject(role, item.action) ? <span className="text-emerald-600">允许</span> : <span className="text-muted-foreground">—</span>}</td>)}</tr>)}</tbody></table></CardContent></Card>
      <p className="text-xs text-muted-foreground">团队 OWNER/ADMIN 隐式拥有全部项目的项目管理员能力；MEMBER 的项目能力由“项目访问范围 + 默认项目角色 + 项目成员行”共同决定。此页为只读矩阵，不支持自定义角色。</p>
    </div>}
    {tab === 'projects' && <div className="space-y-4">
      <Card><CardContent className="flex flex-wrap items-center gap-2 pt-4"><select aria-label="选择项目" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} className="h-9 rounded-lg border border-input bg-background px-2 text-sm"><option value="ALL">全部项目</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select><Input value={projectMemberQuery} onChange={(event) => setProjectMemberQuery(event.target.value)} placeholder="搜索成员" className="h-9 w-full sm:w-56" /><span className="ml-auto text-xs text-muted-foreground">{projectMemberGroups.length} 个项目 · 仅 OWNER/ADMIN 可管理</span></CardContent></Card>
      {visibleProjectGroups.length === 0 ? <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">{projectMemberGroups.length === 0 ? '暂无项目，或项目成员数据仍在加载。' : '没有匹配的项目成员。'}</CardContent></Card> : visibleProjectGroups.map((group) => <Card key={group.projectId}><CardHeader className="flex flex-row items-center justify-between space-y-0"><CardTitle className="text-base">{group.projectTitle} <span className="ml-1 text-sm font-normal text-muted-foreground">{group.members.length} 人</span></CardTitle>{group.restricted && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700">受限项目</span>}</CardHeader><CardContent className="overflow-x-auto p-0"><table className="w-full min-w-[520px] text-sm"><thead><tr className="border-y border-border bg-muted/40 text-left text-xs text-muted-foreground"><th className="px-4 py-2.5 font-medium">成员</th><th className="px-4 py-2.5 font-medium">项目角色</th><th className="px-4 py-2.5 font-medium">来源</th></tr></thead><tbody>{group.members.map((member) => <tr key={member.id} className="border-b border-border last:border-0"><td className="px-4 py-2.5">{member.name || member.id}</td><td className="px-4 py-2.5">{projectRoleText(member.projectRole)}</td><td className="px-4 py-2.5 text-xs text-muted-foreground">{sourceText(member.source)}</td></tr>)}</tbody></table></CardContent></Card>)}
    </div>}
    {tab === 'external' && <Card><CardHeader><CardTitle className="text-base">外部联系人</CardTitle></CardHeader><CardContent><p className="py-6 text-sm text-muted-foreground">客户和外部联系人不在团队成员表里，也不占团队席位。请到客户管理里维护客户公司、联系人和项目收件人。</p><Link href="/studio/clients" className="inline-flex h-9 items-center rounded-md border border-input bg-background px-3 text-sm hover:bg-accent">打开客户管理</Link></CardContent></Card>}
  </div>
}
