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

type Role = 'OWNER' | 'ADMIN' | 'MEMBER'
type InviteMethod = 'PHONE' | 'LINK'
type Member = {
  id: string
  role: Role
  status: string
  projectAccessScope: 'ALL_PROJECTS' | 'ASSIGNED_ONLY'
  defaultProjectRole: 'REVIEWER' | 'EDITOR'
  lastActiveAt: string | null
  createdAt: string
  updatedAt?: string
  user: { id: string; name: string | null; email: string; phone: string | null; updatedAt?: string }
}
type RequestItem = { id: string; status: string; message: string | null; createdAt: string; user: { id: string; name: string | null; email: string; phone: string | null } }
type Invite = {
  id: string
  method: InviteMethod
  phone: string | null
  email: string | null
  role: Role
  projectAccessScope: 'ALL_PROJECTS' | 'ASSIGNED_ONLY'
  defaultProjectRole: 'REVIEWER' | 'EDITOR'
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

export default function TeamMembersPage() {
  const { user } = useAuth()
  const searchParams = useSearchParams()
  const tab = searchParams?.get('tab') || 'seats'
  const [teamId, setTeamId] = useState<string | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [requests, setRequests] = useState<RequestItem[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [phone, setPhone] = useState('')
  const [inviteMethod, setInviteMethod] = useState<InviteMethod>('PHONE')
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteRole, setInviteRole] = useState<'ADMIN' | 'MEMBER'>('MEMBER')
  const [inviteScope, setInviteScope] = useState<'ALL_PROJECTS' | 'ASSIGNED_ONLY'>('ALL_PROJECTS')
  const [inviteDefaultRole, setInviteDefaultRole] = useState<'REVIEWER' | 'EDITOR'>('EDITOR')
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  /** 席位上限由服务端套餐给（0＝不限）；这里写死过 10，套餐是 5，进度条永远只画半条。 */
  const [seatCap, setSeatCap] = useState<number | null>(null)

  const canManage = user?.teamRole === 'OWNER' || user?.teamRole === 'ADMIN'
  const load = async (id: string) => {
    setError('')
    // 审核申请和邀请列表只对负责人/管理员开放；成员页不请求，免得每次进页都吃一个 403。
    const [memberRes, requestRes, inviteRes, overviewRes] = await Promise.all([
      apiFetch(`/api/teams/${id}/members`, { cache: 'no-store' }),
      canManage ? apiFetch(`/api/teams/${id}/join-requests`, { cache: 'no-store' }) : Promise.resolve(null),
      canManage ? apiFetch(`/api/teams/${id}/invitations`, { cache: 'no-store' }) : Promise.resolve(null),
      apiFetch(`/api/teams/${id}/overview`, { cache: 'no-store' }),
    ])
    if (!memberRes.ok) throw new Error('无法加载成员')
    setMembers((await memberRes.json()).members || [])
    setRequests(requestRes?.ok ? ((await requestRes.json()).requests || []) : [])
    setInvites(inviteRes?.ok ? ((await inviteRes.json()).invites || []) : [])
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

  const activeMembers = members.filter((member) => member.status === 'ACTIVE')
  const disabledMembers = members.filter((member) => member.status === 'DISABLED')
  const pendingInvites = invites.filter((invite) => invite.status === 'PENDING')
  const selectableMembers = activeMembers.filter((member) => member.role !== 'OWNER')
  const canDisableTarget = (member: Member) => member.role !== 'OWNER' && (user?.teamRole === 'OWNER' || (user?.teamRole === 'ADMIN' && member.role === 'MEMBER'))
  const canRemoveTarget = (member: Member) => member.role !== 'OWNER' && (user?.teamRole === 'OWNER' || (user?.teamRole === 'ADMIN' && member.role === 'MEMBER'))

  const refresh = async () => { if (!teamId) return; await load(teamId); setSelected([]) }
  const invite = async () => {
    if (!teamId || inviteBusy) return
    if (inviteMethod === 'PHONE' && !/^1\d{10}$/.test(phone)) {
      setError('请输入有效的 11 位手机号')
      return
    }
    setInviteBusy(true)
    setError('')
    try {
      const result = await apiPost<{ invite: { token: string; expiresAt: string } }>(`/api/teams/${teamId}/invitations`, {
        method: inviteMethod,
        phone: inviteMethod === 'PHONE' ? phone : null,
        email: null,
        role: inviteRole,
        projectAccessScope: inviteScope,
        defaultProjectRole: inviteDefaultRole,
      })
      if (inviteMethod === 'PHONE') setPhone('')
      setNotice(inviteMethod === 'LINK' ? '链接邀请已生成，复制后发给对方' : '邀请已创建，请把邀请链接发给对方')
      setInviteLink(`${window.location.origin}/studio/team/invite/${encodeURIComponent(result.invite.token)}`)
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '邀请失败')
    } finally {
      setInviteBusy(false)
    }
  }
  const copyInviteLink = async () => {
    if (!inviteLink) return
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(inviteLink)
      setNotice('邀请链接已复制')
    } catch {
      setNotice('复制失败，请长按链接手动复制')
    }
  }
  const remove = async (id: string) => { if (!teamId || !await appConfirm('确认移除该成员？')) return; try { await apiDelete(`/api/teams/${teamId}/members/${id}`); await refresh() } catch (reason) { setError(reason instanceof Error ? reason.message : '移除失败') } }
  const bulkRemove = async () => { if (!selected.length || !await appConfirm(`确认移除选中的 ${selected.length} 名成员？`)) return; try { await Promise.all(selected.map((id) => apiDelete(`/api/teams/${teamId}/members/${id}`))); await refresh() } catch (reason) { setError(reason instanceof Error ? reason.message : '批量移除失败') } }
  const changeRole = async (userId: string, role: 'ADMIN' | 'MEMBER') => { if (!teamId) return; try { await apiPatch(`/api/teams/${teamId}/members/${userId}`, { role }); await refresh() } catch (reason) { setError(reason instanceof Error ? reason.message : '修改角色失败') } }
  const changeAccess = async (userId: string, patch: { projectAccessScope?: 'ALL_PROJECTS' | 'ASSIGNED_ONLY'; defaultProjectRole?: 'REVIEWER' | 'EDITOR' }) => {
    if (!teamId) return
    try {
      await apiPatch(`/api/teams/${teamId}/members/${userId}`, patch)
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '修改项目权限失败')
    }
  }
  const setStatus = async (userId: string, status: 'ACTIVE' | 'DISABLED') => {
    if (!teamId) return
    try {
      await apiPatch(`/api/teams/${teamId}/members/${userId}`, { status })
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '修改成员状态失败')
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
      setError(reason instanceof Error ? reason.message : '转让团队失败')
    }
  }
  const review = async (id: string, status: 'APPROVED' | 'REJECTED') => { if (!teamId) return; try { await apiPatch(`/api/teams/${teamId}/join-requests/${id}`, { status }); await refresh() } catch (reason) { setError(reason instanceof Error ? reason.message : '审核失败') } }
  const revokeInvite = async (entry: Invite) => {
    const target = entry.method === 'LINK'
      ? '这个链接邀请'
      : maskPhoneDisplay(entry.phone) || entry.email || '该成员'
    if (!teamId || !await appConfirm(`撤销对 ${target} 的邀请？`)) return
    try {
      await apiDelete(`/api/teams/${teamId}/invitations/${entry.id}`)
      await refresh()
      setNotice('邀请已撤销')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '撤销邀请失败')
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
      setInviteLink(`${window.location.origin}/studio/team/invite/${encodeURIComponent(result.invite.token)}`)
      setNotice(entry.method === 'LINK' ? '链接已重新生成，旧链接已失效' : '邀请已重发，旧链接已失效')
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '重新生成邀请失败')
    }
  }

  if (loading) return <StudioPageSkeleton label="正在加载成员管理..." />
  if (!teamId) return <Card><CardContent className="py-16 text-center text-sm text-muted-foreground">请先加入一个团队。</CardContent></Card>

  return <div className="space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-2xl font-semibold tracking-normal">{canManage ? '成员管理' : '团队成员'}</h1><p className="mt-1 text-sm text-muted-foreground">{canManage ? '管理团队成员、组织结构和项目成员。' : '查看团队里有谁。邀请或移除成员需要团队负责人或管理员权限。'}</p></div>{tab === 'seats' && canManage && <Button onClick={invite} disabled={inviteBusy}>{inviteMethod === 'LINK' ? <Link2 className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}{inviteBusy ? '处理中...' : inviteMethod === 'LINK' ? '生成链接' : '邀请成员'}</Button>}</div>
    {error && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive-visible p-3 text-sm text-destructive">{error}</div>}
    {notice && <div role="status" className="rounded-md border border-success/30 bg-success-visible p-3 text-sm text-success">{notice}{inviteLink && <div className="mt-2 flex max-w-xl items-center gap-2"><code className="min-w-0 flex-1 truncate rounded bg-background/70 px-2 py-1 text-xs text-foreground">{inviteLink}</code><Button type="button" size="sm" variant="outline" onClick={() => void copyInviteLink()}><Copy className="h-3.5 w-3.5" />复制链接</Button></div>}</div>}

    {tab === 'seats' && <>
      <Card><CardHeader className="pb-3"><CardTitle className="text-base">席位使用</CardTitle></CardHeader><CardContent><div className="flex items-end justify-between gap-4"><div><span className="text-2xl font-semibold">{activeMembers.length}</span><span className="ml-1 text-sm text-muted-foreground">{seatCap ? ` / ${seatCap} 位成员` : '位成员'}</span></div><span className="text-sm text-muted-foreground">包含负责人和管理员</span></div>{seatCap ? <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.min(100, activeMembers.length / seatCap * 100)}%` }} /></div> : <p className="mt-2 text-xs text-muted-foreground">{seatCap === 0 ? '当前套餐不限席位。' : '席位上限加载中。'}</p>}</CardContent></Card>
      <Card><CardHeader className="flex flex-row items-center justify-between space-y-0"><CardTitle className="text-base">团队内部成员</CardTitle>{canManage && <Button variant="outline" size="sm" onClick={bulkRemove} disabled={!selected.length}>批量移除</Button>}</CardHeader><CardContent className="overflow-x-auto p-0"><table className="w-full min-w-[960px] text-sm"><thead><tr className="border-y border-border bg-muted/40 text-left text-xs text-muted-foreground"><th className="w-12 px-5 py-3"><input type="checkbox" aria-label="全选成员" disabled={!canManage} checked={selectableMembers.length > 0 && selected.length === selectableMembers.length} onChange={(event) => setSelected(event.target.checked ? selectableMembers.map((member) => member.user.id) : [])} /></th><th className="px-3 py-3 font-medium">昵称</th><th className="px-3 py-3 font-medium">角色</th><th className="px-3 py-3 font-medium">项目访问</th><th className="px-3 py-3 font-medium">最后活跃时间</th><th className="px-5 py-3 text-right font-medium">操作</th></tr></thead><tbody>{activeMembers.map((member) => <tr key={member.id} className="border-b border-border last:border-0"><td className="px-5 py-3">{member.role !== 'OWNER' && <input type="checkbox" disabled={!canManage} aria-label={`选择 ${userLabel(member.user)}`} checked={selected.includes(member.user.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, member.user.id] : current.filter((id) => id !== member.user.id))} />}</td><td className="px-3 py-3"><div className="flex items-center gap-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">{initials(member)}</span><div><p className="font-medium">{member.user.name || maskPhoneDisplay(member.user.phone) || '未命名成员'}</p><p className="text-xs text-muted-foreground">{maskPhoneDisplay(member.user.phone) || member.user.email}</p></div></div></td><td className="px-3 py-3">{member.role === 'OWNER' || user?.teamRole !== 'OWNER' ? <span className={`rounded-full px-2 py-1 text-xs ${roleTone[member.role]}`}>{roleLabel[member.role]}</span> : <select disabled={!canManage} aria-label={`修改 ${member.user.name || member.user.email} 的角色`} value={member.role} onChange={(event) => void changeRole(member.user.id, event.target.value as 'ADMIN' | 'MEMBER')} className="h-8 rounded-md border border-input bg-background px-2 text-xs"><option value="ADMIN">管理员</option><option value="MEMBER">成员</option></select>}</td><td className="px-3 py-3">{member.role !== 'MEMBER' ? <span className="text-xs text-muted-foreground">全部项目 · 管理</span> : canManage ? <div className="flex items-center gap-1"><select aria-label={`${userLabel(member.user)} 的项目访问`} value={member.projectAccessScope} onChange={(event) => void changeAccess(member.user.id, { projectAccessScope: event.target.value as 'ALL_PROJECTS' | 'ASSIGNED_ONLY' })} className="h-8 rounded-md border border-input bg-background px-1.5 text-xs"><option value="ALL_PROJECTS">全部项目</option><option value="ASSIGNED_ONLY">指定项目</option></select><select aria-label={`${userLabel(member.user)} 的默认项目角色`} value={member.defaultProjectRole} onChange={(event) => void changeAccess(member.user.id, { defaultProjectRole: event.target.value as 'REVIEWER' | 'EDITOR' })} className="h-8 rounded-md border border-input bg-background px-1.5 text-xs"><option value="REVIEWER">审阅者</option><option value="EDITOR">编辑者</option></select></div> : <span className="text-xs text-muted-foreground">{scopeLabel[member.projectAccessScope]} · {projectRoleLabel[member.defaultProjectRole]}</span>}</td><td className="px-3 py-3 text-muted-foreground">{member.lastActiveAt ? new Date(member.lastActiveAt).toLocaleDateString('zh-CN') : '从未活跃'}</td><td className="px-5 py-3 text-right">{canManage && <div className="flex justify-end gap-1">{user?.teamRole === 'OWNER' && member.role !== 'OWNER' && <button type="button" title="转让团队" aria-label="转让团队" onClick={() => void transferOwner(member.user.id, userLabel(member.user))} className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"><ArrowRightLeft className="h-4 w-4" /></button>}{canDisableTarget(member) && <button type="button" title="停用成员" aria-label="停用成员" onClick={() => void setStatus(member.user.id, 'DISABLED')} className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"><Power className="h-4 w-4" /></button>}{canRemoveTarget(member) && <button type="button" title="移除成员" aria-label="移除成员" onClick={() => void remove(member.user.id)} className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-destructive"><MoreVertical className="h-4 w-4" /></button>}</div>}</td></tr>)}</tbody></table></CardContent></Card>
      {canManage && disabledMembers.length > 0 && <Card><CardHeader><CardTitle className="text-base">已停用成员</CardTitle></CardHeader><CardContent><div className="divide-y divide-border">{disabledMembers.map((member) => <div key={member.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">{userLabel(member.user)}</p><p className="mt-1 text-xs text-muted-foreground">{roleLabel[member.role]} · {member.lastActiveAt ? `最后活跃 ${new Date(member.lastActiveAt).toLocaleDateString('zh-CN')}` : '从未活跃'}</p></div><div className="flex gap-2">{canDisableTarget(member) && <Button size="sm" variant="outline" onClick={() => void setStatus(member.user.id, 'ACTIVE')}>启用</Button>}{canRemoveTarget(member) && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void remove(member.user.id)}>移除</Button>}</div></div>)}</div></CardContent></Card>}
      {canManage && <Card><CardHeader className="flex flex-row items-center justify-between space-y-0"><CardTitle className="text-base">邀请记录</CardTitle><span className="text-xs text-muted-foreground">{pendingInvites.length} 条待接受</span></CardHeader><CardContent>{invites.length === 0 ? <p className="py-6 text-sm text-muted-foreground">暂无邀请记录。</p> : <div className="divide-y divide-border">{invites.map((entry) => {
        const status = entry.status
        return <div key={entry.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">{entry.method === 'LINK' ? '链接邀请' : maskPhoneDisplay(entry.phone) || entry.email || '未填写联系方式'}</p>
              <span className={`rounded-full px-2 py-0.5 text-xs ${inviteStatusTone[status] || 'bg-muted text-muted-foreground'}`}>{inviteStatusLabel[status] || status}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{inviteMethodLabel[entry.method]} · {roleLabel[entry.role]} · {scopeLabel[entry.projectAccessScope]} · {projectRoleLabel[entry.defaultProjectRole]} · 有效期至 {new Date(entry.expiresAt).toLocaleString('zh-CN')}</p>
          </div>
          {status === 'PENDING' && <div className="flex shrink-0 gap-2"><Button size="sm" variant="outline" onClick={() => void regenerateInvite(entry)}>{entry.method === 'LINK' ? '重新生成' : '重发'}</Button><Button size="sm" variant="ghost" className="text-destructive" onClick={() => void revokeInvite(entry)}>撤销</Button></div>}
        </div>
      })}</div>}</CardContent></Card>}
      {canManage && <Card><CardHeader><CardTitle className="text-base">邀请成员</CardTitle></CardHeader><CardContent className="space-y-3">
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
        {inviteScope === 'ASSIGNED_ONLY' && <p className="text-xs text-muted-foreground">项目协作者接受后不会自动获得项目；请在“项目成员”面板里分配项目，或让对方在项目里被加入。</p>}
      </CardContent></Card>}
      {canManage && <Card><CardHeader className="flex flex-row items-center justify-between space-y-0"><CardTitle className="text-base">成员审批</CardTitle><span className="text-xs text-muted-foreground">{requests.length} 条申请</span></CardHeader><CardContent>{requests.length === 0 ? <p className="text-sm text-muted-foreground">暂无待审核申请。</p> : <div className="divide-y divide-border">{requests.map((request) => <div key={request.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">{userLabel(request.user)}</p><p className="mt-1 text-xs text-muted-foreground">{request.message || '未填写申请说明'} · {new Date(request.createdAt).toLocaleDateString('zh-CN')}</p></div><div className="flex gap-2"><Button size="sm" onClick={() => void review(request.id, 'APPROVED')}><Check className="h-3.5 w-3.5" />通过</Button><Button size="sm" variant="outline" onClick={() => void review(request.id, 'REJECTED')}><X className="h-3.5 w-3.5" />拒绝</Button></div></div>)}</div>}</CardContent></Card>}
    </>}

    {tab === 'org' && <Card><CardHeader><CardTitle className="text-base">组织结构</CardTitle></CardHeader><CardContent><div className="rounded-lg border border-border bg-muted/30 p-4"><div className="flex items-center gap-2 text-sm font-medium"><Building2 className="h-4 w-4 text-primary" />团队成员</div><div className="mt-3 space-y-2 pl-6">{activeMembers.map((member) => <div key={member.id} className="flex items-center justify-between border-l border-border pl-3 text-sm"><span>{userLabel(member.user)}</span><span className={`rounded-full px-2 py-1 text-xs ${roleTone[member.role]}`}>{roleLabel[member.role]}</span></div>)}</div></div></CardContent></Card>}
    {tab === 'roles' && <div className="grid gap-4 md:grid-cols-3">{(['OWNER', 'ADMIN', 'MEMBER'] as Role[]).map((role) => <Card key={role}><CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-primary" />{roleLabel[role]}</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">{role === 'OWNER' ? '拥有团队最高权限，可管理成员和团队资料。' : role === 'ADMIN' ? '可邀请成员、管理项目和处理加入申请。' : '可参与团队项目和审阅流程。'}</p><p className="mt-3 text-lg font-semibold">{activeMembers.filter((member) => member.role === role).length}<span className="ml-1 text-xs font-normal text-muted-foreground">人</span></p></CardContent></Card>)}</div>}
    {tab === 'projects' && <Card><CardHeader><CardTitle className="text-base">项目成员</CardTitle></CardHeader><CardContent><div className="grid gap-3 sm:grid-cols-2">{activeMembers.map((member) => <div key={member.id} className="flex items-center justify-between rounded-lg border border-border p-3"><div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-visible text-xs font-medium text-primary">{initials(member)}</span><span className="text-sm">{userLabel(member.user)}</span></div><span className="text-xs text-muted-foreground">已加入 {new Date(member.createdAt).toLocaleDateString('zh-CN')}</span></div>)}</div></CardContent></Card>}
    {tab === 'external' && <Card><CardHeader><CardTitle className="text-base">外部联系人</CardTitle></CardHeader><CardContent><p className="py-6 text-sm text-muted-foreground">客户和外部联系人不在团队成员表里，也不占团队席位。请到客户管理里维护客户公司、联系人和项目收件人。</p><Link href="/studio/clients" className="inline-flex h-9 items-center rounded-md border border-input bg-background px-3 text-sm hover:bg-accent">打开客户管理</Link></CardContent></Card>}
  </div>
}
