'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StudioPageSkeleton } from '@/components/StudioPageSkeleton'
import { apiFetch } from '@/lib/api-client'

type AuditActor = { id: string; name: string | null; email: string | null }
type AuditEvent = {
  id: string
  action: string
  metadata: unknown
  createdAt: string
  actor: AuditActor | null
  target: AuditActor | null
}
type TeamMemberOption = { user: { id: string; name: string | null; email: string } }

const actionLabels: Record<string, string> = {
  INVITE_CREATED: '创建邀请',
  INVITE_REVOKED: '撤销邀请',
  INVITE_ACCEPTED: '接受邀请',
  JOIN_APPROVED: '通过加入申请',
  JOIN_REJECTED: '拒绝加入申请',
  ROLE_CHANGED: '修改团队角色',
  MEMBER_ACCESS_CHANGED: '修改项目访问',
  PROJECT_ROLE_CHANGED: '修改项目角色',
  MEMBER_DISABLED: '停用成员',
  MEMBER_ENABLED: '启用成员',
  MEMBER_REMOVED: '移除成员',
  MEMBER_LEFT: '成员退出',
  OWNER_TRANSFERRED: '转让负责人',
  SEAT_LIMIT_HIT: '席位已满',
  PROJECT_RESTRICTED_CHANGED: '修改受限项目',
}

function actorLabel(actor: AuditActor | null) {
  return actor?.name || actor?.email || actor?.id || '系统'
}

export default function TeamAuditPage() {
  const [teamId, setTeamId] = useState<string | null>(null)
  const [members, setMembers] = useState<TeamMemberOption[]>([])
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [action, setAction] = useState('ALL')
  const [actorUserId, setActorUserId] = useState('ALL')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async (id: string) => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (action !== 'ALL') params.set('action', action)
      if (actorUserId !== 'ALL') params.set('actorUserId', actorUserId)
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      const response = await apiFetch(`/api/teams/${id}/audit?${params.toString()}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(response.status === 403 ? '只有团队负责人或管理员可以查看操作日志。' : '操作日志加载失败')
      const data = await response.json()
      setEvents(data.events || [])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作日志加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    ;(async () => {
      try {
        const center = await apiFetch('/api/team-center', { cache: 'no-store' })
        const data = await center.json()
        const id = data.activeTeamId || data.teams?.[0]?.team.id
        if (!id) { setLoading(false); return }
        setTeamId(id)
        const memberResponse = await apiFetch(`/api/teams/${id}/members`, { cache: 'no-store' })
        if (memberResponse.ok) setMembers((await memberResponse.json()).members || [])
        await load(id)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '操作日志加载失败')
        setLoading(false)
      }
    })()
  }, [])

  if (loading) return <StudioPageSkeleton label="正在加载操作日志..." />

  return <div className="space-y-5">
    <div><h1 className="text-2xl font-semibold tracking-normal">操作日志</h1><p className="mt-1 text-sm text-muted-foreground">成员邀请、角色、项目访问、停用/移除和负责人转让的审计记录。</p></div>
    <Card><CardContent className="flex flex-wrap items-end gap-2 pt-4">
      <label className="text-xs text-muted-foreground">开始日期<Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1 h-9 w-36" /></label>
      <label className="text-xs text-muted-foreground">结束日期<Input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="mt-1 h-9 w-36" /></label>
      <label className="text-xs text-muted-foreground">操作人<select value={actorUserId} onChange={(event) => setActorUserId(event.target.value)} className="mt-1 h-9 rounded-lg border border-input bg-background px-2 text-sm"><option value="ALL">全部操作人</option>{members.map((member) => <option key={member.user.id} value={member.user.id}>{member.user.name || member.user.email}</option>)}</select></label>
      <label className="text-xs text-muted-foreground">动作<select value={action} onChange={(event) => setAction(event.target.value)} className="mt-1 h-9 rounded-lg border border-input bg-background px-2 text-sm"><option value="ALL">全部动作</option>{Object.entries(actionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <Button type="button" onClick={() => { if (teamId) void load(teamId) }}>筛选</Button>
    </CardContent></Card>
    {error ? <Card><CardContent className="py-12 text-center" role="alert"><p className="text-sm text-destructive">{error}</p>{teamId && <Button variant="outline" className="mt-3" onClick={() => void load(teamId)}>重试</Button>}</CardContent></Card> : <Card><CardHeader><CardTitle className="text-base">审计记录 <span className="ml-1 text-sm font-normal text-muted-foreground">{events.length} 条</span></CardTitle></CardHeader><CardContent className="overflow-x-auto p-0">{events.length === 0 ? <div className="py-12 text-center"><p className="text-sm font-medium">没有匹配的操作日志</p><p className="mt-1 text-sm text-muted-foreground">调整日期、操作人或动作后重新筛选；成员操作发生后会立即出现在这里。</p></div> : <table className="w-full min-w-[760px] text-sm"><thead><tr className="border-y border-border bg-muted/40 text-left text-xs text-muted-foreground"><th className="px-4 py-3 font-medium">时间</th><th className="px-4 py-3 font-medium">操作人</th><th className="px-4 py-3 font-medium">对象</th><th className="px-4 py-3 font-medium">动作</th><th className="px-4 py-3 font-medium">详情</th></tr></thead><tbody>{events.map((event) => <tr key={event.id} className="border-b border-border last:border-0"><td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{new Date(event.createdAt).toLocaleString('zh-CN')}</td><td className="px-4 py-3">{actorLabel(event.actor)}</td><td className="px-4 py-3">{event.target ? actorLabel(event.target) : '—'}</td><td className="px-4 py-3"><span className="rounded-full bg-muted px-2 py-0.5 text-xs">{actionLabels[event.action] || event.action}</span></td><td className="max-w-[320px] truncate px-4 py-3 text-xs text-muted-foreground" title={event.metadata ? JSON.stringify(event.metadata) : undefined}>{event.metadata ? JSON.stringify(event.metadata) : '—'}</td></tr>)}</tbody></table>}</CardContent></Card>}
  </div>
}
