'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Building2, Check, Copy, Pencil, Plus, UserRound } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { appPrompt } from '@/components/AppDialogProvider'
import TeamOverview from '@/components/TeamOverview'
import { useAuth } from '@/components/AuthProvider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { apiFetch, apiPatch, apiPost } from '@/lib/api-client'
import { getActiveTeamId, setActiveTeamId } from '@/lib/team-store'

type TeamRole = 'OWNER' | 'ADMIN' | 'MEMBER'
type TeamCenterItem = {
  role: TeamRole
  team: { id: string; name: string; slug: string; avatarUrl: string | null; _count?: { members: number; projects: number } }
}
type TeamData = TeamCenterItem['team'] & { createdAt: string; createdById: string }

function TeamInfoPanel({ team, role }: { team: TeamData; role: TeamRole | null }) {
  const [name, setName] = useState(team.name)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => setName(team.name), [team.name])

  const save = async () => {
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      await apiPatch(`/api/teams/${team.id}`, { name: name.trim() })
      setEditing(false)
      window.location.reload()
    } finally { setSaving(false) }
  }

  const copyLink = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}/studio/team/join?q=${team.slug}`)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return <div className="space-y-5">
    <Card><CardHeader><CardTitle className="text-base">基本资料</CardTitle></CardHeader><CardContent className="grid gap-5 sm:grid-cols-2">
      <div><p className="text-xs text-muted-foreground">团队名称</p>{editing ? <div className="mt-2 flex gap-2"><input autoFocus value={name} onChange={(event) => setName(event.target.value)} className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary" /><Button size="sm" onClick={save} disabled={saving}>保存</Button><Button size="sm" variant="outline" onClick={() => { setName(team.name); setEditing(false) }}>取消</Button></div> : <div className="mt-2 flex items-center gap-2"><p className="text-base font-medium">{team.name}</p>{role === 'OWNER' && <button type="button" className="rounded-md p-1 text-muted-foreground hover:bg-accent" aria-label="修改团队名称" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" /></button>}</div>}</div>
      <div><p className="text-xs text-muted-foreground">团队标识</p><p className="mt-2 font-mono text-sm">{team.slug}</p></div>
      <div className="sm:col-span-2"><p className="text-xs text-muted-foreground">团队加入链接</p><div className="mt-2 flex max-w-xl items-center gap-2"><code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-2 text-xs">{window.location.origin}/studio/team/join?q={team.slug}</code><Button variant="outline" size="sm" onClick={copyLink}><Copy className="h-3.5 w-3.5" />{copied ? '已复制' : '复制链接'}</Button></div></div>
    </CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">团队规模</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4"><div><p className="text-xs text-muted-foreground">成员</p><p className="mt-1 text-xl font-semibold">{team._count?.members ?? 0}</p></div><div><p className="text-xs text-muted-foreground">项目</p><p className="mt-1 text-xl font-semibold">{team._count?.projects ?? 0}</p></div><div><p className="text-xs text-muted-foreground">创建时间</p><p className="mt-1 text-sm">{new Date(team.createdAt).toLocaleDateString('zh-CN')}</p></div></CardContent></Card>
  </div>
}

function PersonalInfoPanel() {
  const { user } = useAuth()
  return <div className="space-y-5"><Card><CardHeader><CardTitle className="text-base">个人资料</CardTitle></CardHeader><CardContent><div className="flex items-center gap-4"><div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-visible text-xl font-semibold text-primary">{user?.name?.slice(0, 1) || user?.email?.slice(0, 1).toUpperCase() || '我'}</div><div><p className="font-medium">{user?.name || '未设置姓名'}</p><p className="mt-1 text-sm text-muted-foreground">{user?.phone || user?.email}</p></div></div><Button asChild className="mt-5" variant="outline"><Link href="/profile"><UserRound className="h-4 w-4" />编辑个人信息<ArrowRight className="h-4 w-4" /></Link></Button></CardContent></Card></div>
}

export default function TeamPage() {
  const { user } = useAuth()
  const searchParams = useSearchParams()
  const tab = searchParams?.get('tab') || 'overview'
  const [teams, setTeams] = useState<TeamCenterItem[]>([])
  const [activeTeamId, setActiveTeamIdState] = useState<string | null>(getActiveTeamId())
  const [team, setTeam] = useState<TeamData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const response = await apiFetch('/api/team-center')
        if (!response.ok) throw new Error('无法加载团队')
        const data = await response.json()
        if (cancelled) return
        const nextTeams = data.teams || []
        setTeams(nextTeams)
        const nextId = nextTeams.some((item: TeamCenterItem) => item.team.id === activeTeamId) ? activeTeamId : data.activeTeamId || nextTeams[0]?.team.id || null
        setActiveTeamIdState(nextId)
        if (nextId) setActiveTeamId(nextId)
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '无法加载团队')
      } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [activeTeamId])

  useEffect(() => {
    if (!activeTeamId) return
    apiFetch(`/api/teams/${activeTeamId}`).then(async (response) => {
      if (!response.ok) throw new Error('无法加载团队信息')
      const data = await response.json()
      setTeam(data.team)
    }).catch((reason) => setError(reason instanceof Error ? reason.message : '无法加载团队信息'))
  }, [activeTeamId])

  const activeRole = useMemo(() => teams.find((item) => item.team.id === activeTeamId)?.role || user?.teamRole || null, [activeTeamId, teams, user?.teamRole])

  const createTeam = async () => {
    const name = await appPrompt({ title: '新建团队', message: '创建后可以邀请成员共同管理项目。', inputLabel: '团队名称', placeholder: '例如：小小白团队', required: true, maxLength: 80, confirmLabel: '创建' })
    if (!name?.trim()) return
    try {
      const data = await apiPost<{ team: { id: string } }>('/api/teams', { name: name.trim() })
      setActiveTeamId(data.team.id)
      setActiveTeamIdState(data.team.id)
      window.location.reload()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '创建团队失败') }
  }

  if (loading) return <div className="py-12 text-sm text-muted-foreground">正在加载团队管理...</div>

  return <div className="space-y-6">
    <div className="flex items-center justify-between gap-3">{tab === 'overview' ? <div><h1 className="text-2xl font-semibold tracking-normal">团队概览</h1><p className="mt-1 text-sm text-muted-foreground">{team?.name || '选择一个团队'}</p></div> : <span aria-hidden="true" />}<Button variant="outline" onClick={createTeam}><Plus className="h-4 w-4" />新建团队</Button></div>
    {error && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive-visible p-3 text-sm text-destructive">{error}</div>}
    {teams.length > 1 && <Card><CardContent className="flex flex-wrap gap-2 p-3">{teams.map((item) => <button key={item.team.id} type="button" onClick={() => { setActiveTeamId(item.team.id); setActiveTeamIdState(item.team.id) }} className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${item.team.id === activeTeamId ? 'border-primary bg-primary-visible text-primary' : 'border-border text-muted-foreground hover:bg-accent'}`}><Building2 className="h-4 w-4" />{item.team.name}{item.team.id === activeTeamId && <Check className="h-3.5 w-3.5" />}</button>)}</CardContent></Card>}
    {!team ? <Card><CardContent className="py-16 text-center"><Building2 className="mx-auto h-10 w-10 text-muted-foreground" /><p className="mt-3 text-sm text-muted-foreground">还没有团队，先创建一个团队开始管理。</p><Button className="mt-4" onClick={createTeam}><Plus className="h-4 w-4" />创建团队</Button></CardContent></Card> : tab === 'team' ? <TeamInfoPanel team={team} role={activeRole} /> : tab === 'personal' ? <PersonalInfoPanel /> : <TeamOverview teamId={team.id} showHeading={false} />}
  </div>
}
