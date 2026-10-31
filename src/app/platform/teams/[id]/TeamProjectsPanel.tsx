'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Copy, ExternalLink, LoaderCircle, RefreshCw, Search } from 'lucide-react'
import type { LinkView, TeamProjectRow, TeamProjectsPage } from '@/lib/platform-team-360'
import { copyTextToClipboard } from '@/lib/clipboard'
import { formatBeijingDateTime, formatFileSize } from '@/lib/utils'
import {
  authModeLabel,
  linkStatusClass,
  linkStatusLabel,
  permissionLabel,
  platformJson,
  scopeLabel,
  statusLabel,
  typeLabel,
} from './team-panel-utils'

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'IN_REVIEW', label: '审片中' },
  { value: 'APPROVED', label: '已通过' },
  { value: 'SHARE_ONLY', label: '仅分享' },
  { value: 'ARCHIVED', label: '已归档' },
]

function LinkRow({ teamId, link, onError }: { teamId: string; link: LinkView; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const reveal = useCallback(async () => {
    setBusy(true)
    try {
      const data = await platformJson<{ url: string }>(`/api/platform/teams/${teamId}/links/${link.id}/reveal`, { method: 'POST' })
      return data.url
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : '无法读取链接')
      return null
    } finally {
      setBusy(false)
    }
  }, [link.id, onError, teamId])

  const copy = async () => {
    const url = await reveal()
    if (!url) return
    const ok = await copyTextToClipboard(url)
    if (!ok) {
      onError('复制失败，请手动展开链接')
      return
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const openReview = async () => {
    const url = await reveal()
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <tr className="border-b border-border/50 last:border-0">
      <td className="py-2 pr-3">
        <p className="font-medium">{link.name}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{link.isMaster ? '主链接' : '独立链接'} · {link.maskedToken}</p>
      </td>
      <td className="py-2 pr-3 text-xs">{typeLabel(link.type)}</td>
      <td className="py-2 pr-3 text-xs">{scopeLabel(link.scopeType)}</td>
      <td className="py-2 pr-3 text-xs">{link.permissions.map(permissionLabel).join('、') || '—'}</td>
      <td className="py-2 pr-3 text-xs">{authModeLabel(link.authMode)}</td>
      <td className="py-2 pr-3 text-xs">{link.expiresAt ? formatBeijingDateTime(link.expiresAt) : '无到期'}</td>
      <td className="py-2 pr-3 text-xs tabular-nums">{link.viewCount} / {link.maxViews ?? '不限'}</td>
      <td className="py-2 pr-3"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${linkStatusClass(link.status)}`}>{linkStatusLabel(link.status)}</span></td>
      <td className="py-2 pr-1">
        <div className="flex flex-wrap justify-end gap-1">
          <button type="button" onClick={() => void copy()} disabled={busy} className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-xs hover:bg-accent disabled:opacity-50">
            {busy ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <Copy className="h-3 w-3" />}{copied ? '已复制' : '复制'}
          </button>
          <button type="button" onClick={() => void openReview()} disabled={busy} className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-xs hover:bg-accent disabled:opacity-50">
            <ExternalLink className="h-3 w-3" />审片
          </button>
        </div>
      </td>
    </tr>
  )
}

function ProjectBlock({ teamId, project, onError }: { teamId: string; project: TeamProjectRow; onError: (message: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <>
      <tr className="border-b border-border/60">
        <td className="py-2.5 pr-3">
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setExpanded((value) => !value)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-accent" aria-label={expanded ? '收起链接' : '展开链接'} aria-expanded={expanded}>
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            <div className="min-w-0">
              <p className="truncate font-medium" title={project.title}>{project.title}</p>
              <p className="text-[11px] text-muted-foreground">{project.projectCode}</p>
            </div>
          </div>
        </td>
        <td className="py-2.5 pr-3 text-xs">{statusLabel(project.status)}</td>
        <td className="py-2.5 pr-3 text-right text-xs tabular-nums">{project.videos}</td>
        <td className="py-2.5 pr-3 text-right text-xs tabular-nums">{formatFileSize(project.storage.totalBytes)}</td>
        <td className="py-2.5 pr-3 text-xs">{project.lastActive.at ? formatBeijingDateTime(project.lastActive.at) : '未记录'}</td>
        <td className="py-2.5 pr-3 text-xs tabular-nums">{project.links.length}</td>
        <td className="py-2.5 text-right">
          <button type="button" onClick={() => window.open(`/studio/projects/${project.id}`, '_blank', 'noopener,noreferrer')} className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-xs hover:bg-accent">
            <ExternalLink className="h-3 w-3" />后台项目
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/60 bg-muted/20">
          <td colSpan={7} className="px-3 py-3">
            {project.links.length === 0 ? (
              <p className="text-xs text-muted-foreground">这个项目还没有分享链接。</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead><tr className="border-b border-border text-left text-[11px] text-muted-foreground"><th className="py-1.5 pr-3 font-medium">名称 / Token</th><th className="py-1.5 pr-3 font-medium">类型</th><th className="py-1.5 pr-3 font-medium">范围</th><th className="py-1.5 pr-3 font-medium">权限</th><th className="py-1.5 pr-3 font-medium">认证</th><th className="py-1.5 pr-3 font-medium">到期</th><th className="py-1.5 pr-3 font-medium">访问 / 上限</th><th className="py-1.5 pr-3 font-medium">状态</th><th className="py-1.5 text-right font-medium">操作</th></tr></thead>
                  <tbody>{project.links.map((link) => <LinkRow key={link.id} teamId={teamId} link={link} onError={onError} />)}</tbody>
                </table>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

export default function TeamProjectsPanel({ teamId }: { teamId: string }) {
  const [data, setData] = useState<TeamProjectsPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (search) params.set('search', search)
      if (status) params.set('status', status)
      setData(await platformJson<TeamProjectsPage>(`/api/platform/teams/${teamId}/projects?${params.toString()}`))
    } catch (reason) {
      setData(null)
      setError(reason instanceof Error ? reason.message : '项目与链接读取失败')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, search, status, teamId])

  useEffect(() => { void load() }, [load])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">项目与分享链接</h2>
          <p className="mt-1 text-xs text-muted-foreground">项目数含归档；视频数不含回收站；链接 token 默认掩码，复制/打开会写审计。</p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"><RefreshCw className="h-3.5 w-3.5" />刷新</button>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <form onSubmit={(event) => { event.preventDefault(); setPage(1); setSearch(searchInput.trim()) }} className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="搜项目名／项目编号" className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary" />
        </form>
        <select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value) }} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
          {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">共 {data?.total ?? '—'} 个项目</span>
      </div>

      {error && <div role="alert" className="mt-3 rounded-md border border-destructive/30 bg-destructive-visible p-3 text-sm text-destructive">{error}</div>}

      {loading ? (
        <div className="mt-3 space-y-2" aria-busy="true"><span className="sr-only" role="status" aria-live="polite">正在加载项目与链接</span>{[0, 1, 2].map((index) => <div key={index} className="skeleton h-10 rounded-md" />)}</div>
      ) : !data ? (
        <p className="mt-3 py-8 text-center text-sm text-muted-foreground">项目与链接读取失败，这里不显示 0。</p>
      ) : data.projects.length === 0 ? (
        <p className="mt-3 py-8 text-center text-sm text-muted-foreground">{search || status ? '没有匹配的项目。' : '这个团队还没有项目。'}</p>
      ) : (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="border-y border-border bg-muted/40 text-left text-xs text-muted-foreground"><th className="py-2 pr-3 font-medium">项目</th><th className="py-2 pr-3 font-medium">状态</th><th className="py-2 pr-3 text-right font-medium">视频</th><th className="py-2 pr-3 text-right font-medium">存储</th><th className="py-2 pr-3 font-medium">最后活跃</th><th className="py-2 pr-3 text-right font-medium">链接</th><th className="py-2 text-right font-medium">操作</th></tr></thead>
              <tbody>{data.projects.map((project) => <ProjectBlock key={project.id} teamId={teamId} project={project} onError={setError} />)}</tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>第 {data.page} / {totalPages} 页</span>
            <div className="flex gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded border border-border px-2 py-1 disabled:opacity-40">上一页</button>
              <button type="button" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} className="rounded border border-border px-2 py-1 disabled:opacity-40">下一页</button>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
