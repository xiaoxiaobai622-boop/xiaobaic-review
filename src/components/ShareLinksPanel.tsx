'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Copy, ExternalLink, Link2, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { appAlert, appConfirm } from '@/components/AppDialogProvider'
import { apiFetch } from '@/lib/api-client'
import { copyTextToClipboard } from '@/lib/clipboard'

type ShareLink = {
  id: string; url: string; name: string; type: string; scopeType: string; scopeId: string | null
  permissions: string[]; authMode: string; expiresAt: string | null; maxViews: number | null
  viewCount: number; status: string; createdAt: string
}

export default function ShareLinksPanel({ project }: { project: any }) {
  const [links, setLinks] = useState<ShareLink[]>([])
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const folders = useMemo(() => Array.isArray(project.folders) ? project.folders : [], [project.folders])
  const videos = useMemo(() => Array.isArray(project.videos) ? project.videos : [], [project.videos])
  const load = useCallback(async () => {
    const response = await apiFetch(`/api/projects/${project.id}/share-links`, { cache: 'no-store' })
    if (response.ok) setLinks((await response.json()).shareLinks || [])
  }, [project.id])
  useEffect(() => { void load() }, [load])
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

  const scopeLabel = (link: ShareLink) => {
    if (link.scopeType === 'PROJECT') return '整个项目'
    if (link.scopeType === 'FOLDER') return folders.find((item: any) => item.id === link.scopeId)?.name || '文件夹'
    return videos.find((item: any) => item.id === link.scopeId)?.name || '视频'
  }

  return <div className="mt-4 rounded-md border border-border bg-card">
    <div className="border-b border-border px-4 py-3">
      <div><h3 className="flex items-center gap-2 text-sm font-semibold"><Link2 className="h-4 w-4 text-primary" />分享记录</h3><p className="mt-1 text-xs text-muted-foreground">请从文件夹或视频的三个点菜单创建分享</p></div>
    </div>
    <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-muted/30 text-xs text-muted-foreground"><tr><th className="px-4 py-2.5 font-medium">分享名称</th><th className="px-4 py-2.5 font-medium">范围</th><th className="px-4 py-2.5 font-medium">查看次数</th><th className="px-4 py-2.5 font-medium">创建时间</th><th className="px-4 py-2.5 font-medium">状态</th><th className="px-4 py-2.5 font-medium">操作</th></tr></thead><tbody className="divide-y divide-border">{links.map(link => <tr key={link.id}><td className="px-4 py-3"><div className="font-medium">{link.name}</div><div className="text-xs text-muted-foreground">{link.type === 'COLLECT' ? '收录分享' : link.permissions.includes('comment') ? '审阅分享' : '交付分享'}</div></td><td className="px-4 py-3">{scopeLabel(link)}</td><td className="px-4 py-3 tabular-nums">{link.viewCount}{link.maxViews !== null ? ` / ${link.maxViews}` : ''}</td><td className="px-4 py-3 text-xs text-muted-foreground">{new Date(link.createdAt).toLocaleString()}</td><td className="px-4 py-3"><span className={link.status === 'ACTIVE' ? 'text-emerald-600' : 'text-muted-foreground'}>{link.status === 'ACTIVE' ? '有效' : link.status === 'REVOKED' ? '已取消' : '已过期'}</span></td><td className="px-4 py-3"><div className="flex items-center gap-1"><Button variant="ghost" size="icon" className="h-8 w-8" title="复制链接" onClick={async () => { if (await copyTextToClipboard(link.url)) { setCopiedId(link.id); setTimeout(() => setCopiedId(null), 1500) } }} >{copiedId === link.id ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}</Button><Button variant="ghost" size="icon" className="h-8 w-8" title="打开" onClick={() => window.open(link.url, '_blank', 'noopener,noreferrer')}><ExternalLink className="h-4 w-4" /></Button>{link.status === 'ACTIVE' && <Button variant="ghost" size="icon" className="h-8 w-8 text-amber-600" title="取消分享" onClick={() => void mutate(link, 'revoke')}><RotateCcw className="h-4 w-4" /></Button>}<Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="删除记录" onClick={() => void mutate(link, 'delete')}><Trash2 className="h-4 w-4" /></Button></div></td></tr>)}{links.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">还没有分享记录</td></tr>}</tbody></table></div>
  </div>
}
