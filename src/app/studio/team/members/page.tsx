'use client'

import { useEffect, useState } from 'react'
import { Building2, Check, Copy, MailPlus, MoreVertical, ShieldCheck, UserPlus, Users, X } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { appConfirm } from '@/components/AppDialogProvider'
import { useAuth } from '@/components/AuthProvider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { apiDelete, apiFetch, apiPatch, apiPost } from '@/lib/api-client'

type Role = 'OWNER' | 'ADMIN' | 'MEMBER'
type Member = { id: string; role: Role; status: string; createdAt: string; updatedAt?: string; user: { id: string; name: string | null; email: string; phone: string | null; updatedAt?: string } }
type RequestItem = { id: string; status: string; message: string | null; createdAt: string; user: { id: string; name: string | null; email: string; phone: string | null } }
type Invite = { id: string; phone: string | null; email: string | null; role: Role; status: string; createdAt: string; expiresAt: string; token?: string }

const roleLabel: Record<Role, string> = { OWNER: '负责人', ADMIN: '管理员', MEMBER: '成员' }
const roleTone: Record<Role, string> = { OWNER: 'bg-amber-500/10 text-amber-700 dark:text-amber-300', ADMIN: 'bg-primary-visible text-primary', MEMBER: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' }

function initials(member: Member) { return (member.user.name || member.user.phone || member.user.email).slice(0, 1).toUpperCase() }

export default function TeamMembersPage() {
  const { user } = useAuth()
  const searchParams = useSearchParams()
  const tab = searchParams?.get('tab') || 'seats'
  const [teamId, setTeamId] = useState<string | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [requests, setRequests] = useState<RequestItem[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [phone, setPhone] = useState('')
  const [inviteRole, setInviteRole] = useState<'ADMIN' | 'MEMBER'>('MEMBER')
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [inviteLink, setInviteLink] = useState('')

  const load = async (id: string) => {
    const [memberRes, requestRes, inviteRes] = await Promise.all([apiFetch(`/api/teams/${id}/members`), apiFetch(`/api/teams/${id}/join-requests`), apiFetch(`/api/teams/${id}/invitations`)] )
    if (!memberRes.ok) throw new Error('无法加载成员')
    setMembers((await memberRes.json()).members || [])
    setRequests(requestRes.ok ? ((await requestRes.json()).requests || []) : [])
    setInvites(inviteRes.ok ? ((await inviteRes.json()).invites || []) : [])
  }

  useEffect(() => {
    ;(async () => { try { const response = await apiFetch('/api/team-center'); const data = await response.json(); const id = data.activeTeamId || data.teams?.[0]?.team.id; if (!id) return; setTeamId(id); await load(id) } catch (reason) { setError(reason instanceof Error ? reason.message : '成员数据加载失败') } finally { setLoading(false) } })()
  }, [])

  const canManage = user?.teamRole === 'OWNER' || user?.teamRole === 'ADMIN'
  const activeMembers = members.filter((member) => member.status === 'ACTIVE')

  const refresh = async () => { if (!teamId) return; await load(teamId); setSelected([]) }
  const invite = async () => {
    if (!teamId || !/^1\d{10}$/.test(phone)) { setError('请输入有效的 11 位手机号'); return }
    try {
      const result = await apiPost<{ invite: { token: string; expiresAt: string } }>(`/api/teams/${teamId}/invitations`, { phone, email: null, role: inviteRole })
      setPhone('')
      setNotice('邀请已创建，请把邀请链接发给对方')
      setInviteLink(`${window.location.origin}/studio/team/invite/${encodeURIComponent(result.invite.token)}`)
      await refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '邀请失败') }
  }
  const copyInviteLink = async () => {
    if (!inviteLink) return
    await navigator.clipboard.writeText(inviteLink)
    setNotice('邀请链接已复制')
  }
  const remove = async (id: string) => { if (!teamId || !await appConfirm('确认移除该成员？')) return; try { await apiDelete(`/api/teams/${teamId}/members/${id}`); await refresh() } catch (reason) { setError(reason instanceof Error ? reason.message : '移除失败') } }
  const bulkRemove = async () => { if (!selected.length || !await appConfirm(`确认移除选中的 ${selected.length} 名成员？`)) return; try { await Promise.all(selected.map((id) => apiDelete(`/api/teams/${teamId}/members/${id}`))); await refresh() } catch (reason) { setError(reason instanceof Error ? reason.message : '批量移除失败') } }
  const changeRole = async (userId: string, role: 'ADMIN' | 'MEMBER') => { if (!teamId) return; try { await apiPatch(`/api/teams/${teamId}/members/${userId}`, { role }); await refresh() } catch (reason) { setError(reason instanceof Error ? reason.message : '修改角色失败') } }
  const review = async (id: string, status: 'APPROVED' | 'REJECTED') => { if (!teamId) return; try { await apiPatch(`/api/teams/${teamId}/join-requests/${id}`, { status }); await refresh() } catch (reason) { setError(reason instanceof Error ? reason.message : '审核失败') } }

  if (loading) return <div className="py-12 text-sm text-muted-foreground">正在加载成员管理...</div>
  if (!teamId) return <Card><CardContent className="py-16 text-center text-sm text-muted-foreground">请先加入一个团队。</CardContent></Card>

  return <div className="space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-2xl font-semibold tracking-normal">成员管理</h1><p className="mt-1 text-sm text-muted-foreground">管理团队成员、组织结构和项目成员。</p></div>{tab === 'seats' && <Button onClick={invite} disabled={!canManage}><UserPlus className="h-4 w-4" />邀请成员</Button>}</div>
    {error && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive-visible p-3 text-sm text-destructive">{error}</div>}
    {notice && <div role="status" className="rounded-md border border-success/30 bg-success-visible p-3 text-sm text-success">{notice}{inviteLink && <div className="mt-2 flex max-w-xl items-center gap-2"><code className="min-w-0 flex-1 truncate rounded bg-background/70 px-2 py-1 text-xs text-foreground">{inviteLink}</code><Button type="button" size="sm" variant="outline" onClick={() => void copyInviteLink()}><Copy className="h-3.5 w-3.5" />复制链接</Button></div>}</div>}

    {tab === 'seats' && <>
      <Card><CardHeader className="pb-3"><CardTitle className="text-base">席位使用</CardTitle></CardHeader><CardContent><div className="flex items-end justify-between gap-4"><div><span className="text-2xl font-semibold">{activeMembers.length}</span><span className="ml-1 text-sm text-muted-foreground">位成员</span></div><span className="text-sm text-muted-foreground">包含负责人和管理员</span></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, activeMembers.length / 10 * 100)}%` }} /></div></CardContent></Card>
      <Card><CardHeader className="flex flex-row items-center justify-between space-y-0"><CardTitle className="text-base">团队内部成员</CardTitle><Button variant="outline" size="sm" onClick={bulkRemove} disabled={!canManage || !selected.length}>批量移除</Button></CardHeader><CardContent className="overflow-x-auto p-0"><table className="w-full min-w-[680px] text-sm"><thead><tr className="border-y border-border bg-muted/40 text-left text-xs text-muted-foreground"><th className="w-12 px-5 py-3"><input type="checkbox" aria-label="全选成员" disabled={!canManage} checked={selected.length === activeMembers.filter((member) => member.role !== 'OWNER').length && activeMembers.some((member) => member.role !== 'OWNER')} onChange={(event) => setSelected(event.target.checked ? activeMembers.filter((member) => member.role !== 'OWNER').map((member) => member.user.id) : [])} /></th><th className="px-3 py-3 font-medium">昵称</th><th className="px-3 py-3 font-medium">角色</th><th className="px-3 py-3 font-medium">最后活跃时间</th><th className="px-5 py-3 text-right font-medium">操作</th></tr></thead><tbody>{activeMembers.map((member) => <tr key={member.id} className="border-b border-border last:border-0"><td className="px-5 py-3">{member.role !== 'OWNER' && <input type="checkbox" disabled={!canManage} aria-label={`选择 ${member.user.name || member.user.phone || member.user.email}`} checked={selected.includes(member.user.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, member.user.id] : current.filter((id) => id !== member.user.id))} />}</td><td className="px-3 py-3"><div className="flex items-center gap-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">{initials(member)}</span><div><p className="font-medium">{member.user.name || member.user.phone || '未命名成员'}</p><p className="text-xs text-muted-foreground">{member.user.phone || member.user.email}</p></div></div></td><td className="px-3 py-3">{member.role === 'OWNER' ? <span className={`rounded-full px-2 py-1 text-xs ${roleTone[member.role]}`}>{roleLabel[member.role]}</span> : <select disabled={!canManage} aria-label={`修改 ${member.user.name || member.user.email} 的角色`} value={member.role} onChange={(event) => void changeRole(member.user.id, event.target.value as 'ADMIN' | 'MEMBER')} className="h-8 rounded-md border border-input bg-background px-2 text-xs"><option value="ADMIN">管理员</option><option value="MEMBER">成员</option></select>}</td><td className="px-3 py-3 text-muted-foreground">{new Date(member.user.updatedAt || member.updatedAt || member.createdAt).toLocaleDateString('zh-CN')}</td><td className="px-5 py-3 text-right">{canManage && <button type="button" title="成员操作" aria-label="成员操作" onClick={() => void remove(member.user.id)} className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-destructive"><MoreVertical className="h-4 w-4" /></button>}</td></tr>)}</tbody></table></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">邀请成员</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px_auto]"><Input disabled={!canManage} value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, ''))} maxLength={11} placeholder="手机号" /><select disabled={!canManage} value={inviteRole} onChange={(event) => setInviteRole(event.target.value as 'ADMIN' | 'MEMBER')} className="h-10 rounded-lg border border-input bg-background px-3 text-sm"><option value="MEMBER">普通成员</option><option value="ADMIN">管理员</option></select><Button disabled={!canManage} onClick={invite}><MailPlus className="h-4 w-4" />发送邀请</Button></CardContent></Card>
      {canManage && <Card><CardHeader className="flex flex-row items-center justify-between space-y-0"><CardTitle className="text-base">成员审批</CardTitle><span className="text-xs text-muted-foreground">{requests.length} 条申请</span></CardHeader><CardContent>{requests.length === 0 ? <p className="text-sm text-muted-foreground">暂无待审核申请。</p> : <div className="divide-y divide-border">{requests.map((request) => <div key={request.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">{request.user.name || request.user.phone || request.user.email}</p><p className="mt-1 text-xs text-muted-foreground">{request.message || '未填写申请说明'} · {new Date(request.createdAt).toLocaleDateString('zh-CN')}</p></div><div className="flex gap-2"><Button size="sm" onClick={() => void review(request.id, 'APPROVED')}><Check className="h-3.5 w-3.5" />通过</Button><Button size="sm" variant="outline" onClick={() => void review(request.id, 'REJECTED')}><X className="h-3.5 w-3.5" />拒绝</Button></div></div>)}</div>}</CardContent></Card>}
    </>}

    {tab === 'org' && <Card><CardHeader><CardTitle className="text-base">组织结构</CardTitle></CardHeader><CardContent><div className="rounded-lg border border-border bg-muted/30 p-4"><div className="flex items-center gap-2 text-sm font-medium"><Building2 className="h-4 w-4 text-primary" />团队成员</div><div className="mt-3 space-y-2 pl-6">{activeMembers.map((member) => <div key={member.id} className="flex items-center justify-between border-l border-border pl-3 text-sm"><span>{member.user.name || member.user.phone || member.user.email}</span><span className={`rounded-full px-2 py-1 text-xs ${roleTone[member.role]}`}>{roleLabel[member.role]}</span></div>)}</div></div></CardContent></Card>}
    {tab === 'roles' && <div className="grid gap-4 md:grid-cols-3">{(['OWNER', 'ADMIN', 'MEMBER'] as Role[]).map((role) => <Card key={role}><CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-primary" />{roleLabel[role]}</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">{role === 'OWNER' ? '拥有团队最高权限，可管理成员和团队资料。' : role === 'ADMIN' ? '可邀请成员、管理项目和处理加入申请。' : '可参与团队项目和审阅流程。'}</p><p className="mt-3 text-lg font-semibold">{activeMembers.filter((member) => member.role === role).length}<span className="ml-1 text-xs font-normal text-muted-foreground">人</span></p></CardContent></Card>)}</div>}
    {tab === 'projects' && <Card><CardHeader><CardTitle className="text-base">项目成员</CardTitle></CardHeader><CardContent><div className="grid gap-3 sm:grid-cols-2">{activeMembers.map((member) => <div key={member.id} className="flex items-center justify-between rounded-lg border border-border p-3"><div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-visible text-xs font-medium text-primary">{initials(member)}</span><span className="text-sm">{member.user.name || member.user.phone || member.user.email}</span></div><span className="text-xs text-muted-foreground">已加入 {new Date(member.createdAt).toLocaleDateString('zh-CN')}</span></div>)}</div></CardContent></Card>}
    {tab === 'external' && <Card><CardHeader><CardTitle className="text-base">外部联系人</CardTitle></CardHeader><CardContent>{invites.length === 0 ? <div className="py-12 text-center text-sm text-muted-foreground">暂无外部联系人邀请记录。</div> : <div className="divide-y divide-border">{invites.map((invite) => <div key={invite.id} className="flex items-center justify-between py-3"><div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground"><Users className="h-4 w-4" /></span><div><p className="text-sm font-medium">{invite.phone || invite.email}</p><p className="text-xs text-muted-foreground">{invite.status === 'PENDING' ? '待接受' : invite.status}</p></div></div><time className="text-xs text-muted-foreground">{new Date(invite.createdAt).toLocaleDateString('zh-CN')}</time></div>)}</div>}</CardContent></Card>}
  </div>
}
