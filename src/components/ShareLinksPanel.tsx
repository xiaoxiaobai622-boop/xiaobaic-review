'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Copy, ExternalLink, FolderUp, History, Link2, Loader2, RefreshCw, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { appAlert, appConfirm } from '@/components/AppDialogProvider'
import CreateShareDialog, { type ShareTarget } from '@/components/CreateShareDialog'
import { apiFetch } from '@/lib/api-client'
import { copyTextToClipboard } from '@/lib/clipboard'

type ShareLink = {
  id: string; url: string; name: string; type: string; scopeType: string; scopeId: string | null
  permissions: string[]; authMode: string; expiresAt: string | null; maxViews: number | null
  viewCount: number; status: string; createdAt: string
}

/** The project's own address. It is a real link row, so it carries the same
 *  expiry, view count and access records as any 审阅分享. */
type MasterLink = {
  id: string; name: string; url: string; authMode: string; hasPassword: boolean
  permissions: string[]; status: string; expiresAt: string | null; maxViews: number | null; viewCount: number
}

/** What the two shared cells actually read; both row kinds satisfy it. */
type LinkExpiryFields = Pick<ShareLink, 'expiresAt' | 'status'>
type LinkIdentityFields = Pick<ShareLink, 'id' | 'name'>

type AccessRecord = { id: string; createdAt: string; accessMethod: string; email: string | null; ipAddress: string | null }

/** Same three words the master-link row above already uses, so one visit means one thing. */
const ACCESS_METHOD_LABEL: Record<string, string> = {
  NONE: '免密访问',
  PASSWORD: '访问口令',
  OTP: '邮箱验证码',
  GUEST: '访客身份',
}

/**
 * `status` already reads 已过期 once the deadline passes (the list endpoint
 * derives it), so this column only ever answers "到什么时候" for a link that is
 * still open — repeating the verdict here would be two labels for one fact.
 */
function ExpiryCell({ link, nowMs }: { link: LinkExpiryFields, nowMs: number }) {
  if (!link.expiresAt) return <span className="text-xs text-muted-foreground">长期有效</span>
  const expiresAt = new Date(link.expiresAt)
  const daysLeft = Math.ceil((expiresAt.getTime() - nowMs) / 86_400_000)
  return <div>
    <div className="text-xs tabular-nums">{expiresAt.toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
    {link.status === 'ACTIVE' && nowMs > 0 && <div className="text-xs text-muted-foreground">剩 {daysLeft} 天</div>}
  </div>
}

function AccessRecordsDialog({ projectId, link, onOpenChange }: { projectId: string, link: LinkIdentityFields | null, onOpenChange: (open: boolean) => void }) {
  const [records, setRecords] = useState<AccessRecord[] | null>(null)
  const [total, setTotal] = useState(0)
  const [trackingEnabled, setTrackingEnabled] = useState(true)
  const [failed, setFailed] = useState(false)
  const load = useCallback(async () => {
    if (!link) return
    setRecords(null)
    setFailed(false)
    try {
      const response = await apiFetch(`/api/projects/${projectId}/share-links/${link.id}/accesses`, { cache: 'no-store' })
      if (!response.ok) throw new Error('failed')
      const data = await response.json()
      setRecords(Array.isArray(data.accesses) ? data.accesses : [])
      setTotal(typeof data.total === 'number' ? data.total : 0)
      setTrackingEnabled(data.trackingEnabled !== false)
    } catch {
      setFailed(true)
    }
  }, [projectId, link])
  useEffect(() => { void load() }, [load])

  return <Dialog open={Boolean(link)} onOpenChange={onOpenChange}>
    <DialogContent className="w-[calc(100%-2rem)] max-w-[560px] !rounded-lg">
      <DialogHeader>
        <DialogTitle>访问记录{link ? ` · ${link.name}` : ''}</DialogTitle>
        <DialogDescription>{!trackingEnabled ? '访问记录未开启，这条链接被打开时不会留下记录' : records && total > records.length ? `只统计通过这条链接打开的访问，共 ${total} 次，下面显示最新 ${records.length} 条` : '只统计通过这条链接打开的访问'}</DialogDescription>
      </DialogHeader>
      {failed && <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-sm"><span className="flex-1 text-foreground">读取失败</span><Button variant="outline" size="sm" className="h-8" onClick={() => void load()}>重试</Button></div>}
      {!failed && records === null && <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}
      {!failed && records !== null && records.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">{trackingEnabled ? '还没有人打开过这条链接' : '没有可显示的访问'}</p>}
      {!failed && records !== null && records.length > 0 && <div className="max-h-[60vh] overflow-y-auto">
        <table className="w-full text-left text-sm"><thead className="bg-muted/30 text-xs text-muted-foreground"><tr><th className="px-2 py-2 font-medium">时间</th><th className="px-2 py-2 font-medium">方式</th><th className="px-2 py-2 font-medium">访客</th></tr></thead>
          <tbody className="divide-y divide-border">{records.map(record => <tr key={record.id}><td className="px-2 py-2.5 text-xs tabular-nums text-muted-foreground">{new Date(record.createdAt).toLocaleString()}</td><td className="px-2 py-2.5 text-xs">{ACCESS_METHOD_LABEL[record.accessMethod] || record.accessMethod}</td><td className="max-w-[220px] truncate px-2 py-2.5 text-xs" title={record.email || record.ipAddress || ''}>{record.email || record.ipAddress || '—'}</td></tr>)}</tbody>
        </table>
      </div>}
    </DialogContent>
  </Dialog>
}

export default function ShareLinksPanel({ project, onCountChange }: { project: any, onCountChange?: (count: number) => void }) {
  const [links, setLinks] = useState<ShareLink[]>([])
  const [master, setMaster] = useState<MasterLink | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [rotating, setRotating] = useState(false)
  const [accessLink, setAccessLink] = useState<LinkIdentityFields | null>(null)
  const [collectTarget, setCollectTarget] = useState<ShareTarget | null>(null)
  const [nowMs, setNowMs] = useState(0)
  const folders = useMemo(() => Array.isArray(project.folders) ? project.folders : [], [project.folders])
  const videos = useMemo(() => Array.isArray(project.videos) ? project.videos : [], [project.videos])
  const load = useCallback(async () => {
    const response = await apiFetch(`/api/projects/${project.id}/share-links`, { cache: 'no-store' })
    if (!response.ok) return
    const data = await response.json()
    setLinks(data.shareLinks || [])
    setMaster(data.masterLink || null)
    // 剩余天数要有基准点，但基准点不能在 render 里取（服务器与水合各取一次就对不上）。
    setNowMs(Date.now())
  }, [project.id])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    onCountChange?.(links.length)
  }, [links, onCountChange])
  useEffect(() => {
    const refresh = () => void load()
    window.addEventListener('shareLinksChanged', refresh)
    return () => window.removeEventListener('shareLinksChanged', refresh)
  }, [load])

  const mutate = async (link: ShareLink, action: 'revoke' | 'delete') => {
    if (action === 'delete' && !await appConfirm('删除这条分享记录？视频和项目内容不会被删除。')) return
    const response = await apiFetch(`/api/projects/${project.id}/share-links/${link.id}`, { method: action === 'delete' ? 'DELETE' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: action === 'revoke' ? JSON.stringify({ status: 'REVOKED' }) : undefined })
    if (!response.ok) { appAlert('操作失败'); return }
    if (action === 'delete') setLinks(current => current.filter(item => item.id !== link.id))
    else setLinks(current => current.map(item => item.id === link.id ? { ...item, status: 'REVOKED' } : item))
  }

  const rotateMaster = async () => {
    if (!await appConfirm('重置项目主链接地址？已经发出的邮件、飞书消息里的旧地址会立刻打不开，正在观看的访客也需要重新进入。')) return
    setRotating(true)
    try {
      const response = await apiFetch(`/api/projects/${project.id}/share-slug/rotate`, { method: 'POST' })
      if (!response.ok) { appAlert((await response.json().catch(() => ({})))?.error || '重置失败'); return }
      await load()
    } finally {
      setRotating(false)
    }
  }

  const scopeLabel = (link: ShareLink) => {
    if (link.scopeType === 'PROJECT') return '整个项目'
    if (link.scopeType === 'FOLDER') return folders.find((item: any) => item.id === link.scopeId)?.name || '文件夹'
    const video = videos.find((item: any) => item.id === link.scopeId)
    if (!video) return '视频'
    // A single-version link has to read differently from a whole-file link,
    // otherwise the two rows look like the same share twice.
    return link.scopeType === 'VIDEO_VERSION' ? `${video.name} ${video.versionLabel || `v${video.version}`}` : video.name
  }

  return <div className="mt-4 rounded-md border border-border bg-card">
    <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
      <div><h3 className="flex items-center gap-2 text-sm font-semibold"><Link2 className="h-4 w-4 text-primary" />分享记录</h3><p className="mt-1 text-xs text-muted-foreground">请从文件夹或视频的三个点菜单创建分享</p></div>
      {/* 上传接口在项目没开「允许客户提交素材」时一律 403，所以入口只在开着时才给。 */}
      {project.allowReverseShare && <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1.5 px-2.5 text-xs" onClick={() => setCollectTarget({ scopeType: 'PROJECT', scopeId: '', name: project.title })}><FolderUp className="h-4 w-4" />创建收录链接</Button>}
    </div>
    <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-sm"><thead className="bg-muted/30 text-xs text-muted-foreground"><tr><th className="px-4 py-2.5 font-medium">分享名称</th><th className="px-4 py-2.5 font-medium">范围</th><th className="px-4 py-2.5 font-medium">有效期</th><th className="px-4 py-2.5 font-medium">查看次数</th><th className="px-4 py-2.5 font-medium">创建时间</th><th className="px-4 py-2.5 font-medium">状态</th><th className="px-4 py-2.5 font-medium">操作</th></tr></thead><tbody className="divide-y divide-border">{master && <tr className="bg-primary/5"><td className="px-4 py-3"><div className="font-medium">项目主链接</div><div className="max-w-[280px] truncate text-xs text-muted-foreground" title={master.url}>{master.url}</div><div className="text-xs text-muted-foreground">{master.authMode === 'NONE' ? '免密访问' : master.authMode === 'OTP' ? '邮箱验证码' : master.hasPassword ? '访问口令' : '未设口令'} · {master.permissions.includes('comment') ? '可批注' : '不可批注'} · {master.permissions.includes('download') ? '可下载' : '不可下载'}</div></td><td className="px-4 py-3">整个项目</td><td className="px-4 py-3"><ExpiryCell link={master} nowMs={nowMs} /></td><td className="px-4 py-3 tabular-nums">{master.viewCount}{master.maxViews !== null ? ` / ${master.maxViews}` : ''}</td><td className="px-4 py-3 text-xs text-muted-foreground">—</td><td className="px-4 py-3"><span className={master.status === 'ACTIVE' ? 'text-emerald-600' : 'text-muted-foreground'}>{master.status === 'ACTIVE' ? '有效' : master.status === 'REVOKED' ? '已取消' : master.status === 'EXPIRED' ? '已过期' : '已归档'}</span></td><td className="px-4 py-3"><div className="flex items-center gap-1"><Button variant="ghost" size="icon" className="h-8 w-8" title="访问记录" aria-label="查看项目主链接的访问记录" onClick={() => setAccessLink(master)}><History className="h-4 w-4" /></Button><Button variant="ghost" size="icon" className="h-8 w-8" title="复制链接" onClick={async () => { if (await copyTextToClipboard(master.url)) { setCopiedId('master'); setTimeout(() => setCopiedId(null), 1500) } }}>{copiedId === 'master' ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}</Button><Button variant="ghost" size="icon" className="h-8 w-8" title="打开" onClick={() => window.open(master.url, '_blank', 'noopener,noreferrer')}><ExternalLink className="h-4 w-4" /></Button><Button variant="ghost" size="sm" className="h-8 shrink-0 gap-1.5 px-2 text-xs text-amber-700" disabled={rotating} onClick={() => void rotateMaster()} title="旧地址立刻失效"><RefreshCw className={`h-4 w-4${rotating ? ' animate-spin' : ''}`} />重置地址</Button></div></td></tr>}{links.map(link => <tr key={link.id}><td className="px-4 py-3"><div className="font-medium">{link.name}</div><div className="text-xs text-muted-foreground">{link.type === 'COLLECT' ? '收录分享' : link.permissions.includes('comment') ? '审阅分享' : '交付分享'}</div></td><td className="px-4 py-3">{scopeLabel(link)}</td><td className="px-4 py-3"><ExpiryCell link={link} nowMs={nowMs} /></td><td className="px-4 py-3 tabular-nums">{link.viewCount}{link.maxViews !== null ? ` / ${link.maxViews}` : ''}</td><td className="px-4 py-3 text-xs text-muted-foreground">{new Date(link.createdAt).toLocaleString()}</td><td className="px-4 py-3"><span className={link.status === 'ACTIVE' ? 'text-emerald-600' : 'text-muted-foreground'}>{link.status === 'ACTIVE' ? '有效' : link.status === 'REVOKED' ? '已取消' : '已过期'}</span></td><td className="px-4 py-3"><div className="flex items-center gap-1"><Button variant="ghost" size="icon" className="h-8 w-8" title="访问记录" aria-label="查看这条链接的访问记录" onClick={() => setAccessLink(link)}><History className="h-4 w-4" /></Button><Button variant="ghost" size="icon" className="h-8 w-8" title="复制链接" onClick={async () => { if (await copyTextToClipboard(link.url)) { setCopiedId(link.id); setTimeout(() => setCopiedId(null), 1500) } }} >{copiedId === link.id ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}</Button><Button variant="ghost" size="icon" className="h-8 w-8" title="打开" onClick={() => window.open(link.url, '_blank', 'noopener,noreferrer')}><ExternalLink className="h-4 w-4" /></Button>{link.status === 'ACTIVE' && <Button variant="ghost" size="icon" className="h-8 w-8 text-amber-600" title="取消分享" onClick={() => void mutate(link, 'revoke')}><RotateCcw className="h-4 w-4" /></Button>}<Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="删除记录" onClick={() => void mutate(link, 'delete')}><Trash2 className="h-4 w-4" /></Button></div></td></tr>)}{links.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">还没有分享记录</td></tr>}</tbody></table></div>
    <AccessRecordsDialog projectId={project.id} link={accessLink} onOpenChange={(open) => { if (!open) setAccessLink(null) }} />
    {collectTarget && <CreateShareDialog projectId={project.id} open preset="COLLECT" target={collectTarget} onOpenChange={(open) => { if (!open) setCollectTarget(null) }} onCreated={() => void load()} />}
  </div>
}
