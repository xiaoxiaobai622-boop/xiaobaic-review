'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api-client'
import { applyProjectsQuery, emptyFilterState, type ProjectListItem } from '@/lib/projects-filter'

/** 搜索结果里能打开的最小单位：一条素材可以有几十个版本，列表按名字折叠成一行。 */
interface AssetHit {
  name: string
  versionLabel: string
  version: number
  folderId: string | null
  uploadedByName: string | null
}

const MAX_ROWS = 20

// 状态词直接取列表页已有的四个 i18n key，四语都已存在，不新增文案。
const STATUS_LABEL_KEY: Record<string, string> = {
  IN_REVIEW: 'statusInReview',
  APPROVED: 'statusApproved',
  SHARE_ONLY: 'statusShareOnly',
  ARCHIVED: 'statusArchived',
}

/** 就地搜：项目中心搜项目，项目工作区搜这个项目的素材。栏是全局壳，别的 /studio 页面一律按项目搜。 */
export default function RailSearch({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null)
  const [assets, setAssets] = useState<AssetHit[] | null>(null)
  const [scopeName, setScopeName] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const pathname = usePathname()
  const router = useRouter()

  const workspaceId = /^\/studio\/projects\/([^/]+)$/.exec(pathname || '')?.[1] || null
  const scope = workspaceId ? 'assets' : 'projects'

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setStatus('loading')
    const endpoint = workspaceId ? `/api/projects/${workspaceId}?includeComments=false` : '/api/projects'
    apiFetch(endpoint, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status))
        const data = await response.json()
        if (cancelled) return
        if (workspaceId) {
          const hits = new Map<string, AssetHit>()
          for (const video of (data.project?.videos || []) as any[]) {
            // 播放只吃 READY 版本，把还在转码的列进结果会点出空面板。
            if (video.status !== 'READY') continue
            const hit: AssetHit = {
              name: video.name,
              versionLabel: video.versionLabel || `v${video.version}`,
              version: video.version,
              folderId: video.folderId ?? null,
              uploadedByName: video.uploadedByName || null,
            }
            const existing = hits.get(hit.name)
            if (!existing || hit.version > existing.version) hits.set(hit.name, hit)
          }
          setScopeName(data.project?.title || '')
          setAssets(Array.from(hits.values()))
        } else {
          setProjects((data.projects || []) as ProjectListItem[])
        }
        setStatus('ready')
      })
      .catch(() => { if (!cancelled) setStatus('error') })
    return () => { cancelled = true }
  }, [open, workspaceId])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const handleMouseDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close()
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [open, scope])

  // 关键字沿仓库已有的 window 事件总线送给列表页，让它自己的 filters.q 生效，
  // 不复制一遍筛选逻辑（同 commentPosted 的用法）。
  useEffect(() => {
    if (!open || scope !== 'projects') return
    window.dispatchEvent(new CustomEvent('railSearchQuery', { detail: { q: query } }))
  }, [open, scope, query])

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  // 打开时以列表页的 URL（?q=，它自己同步的）为准，两处搜索框说的就是同一个关键字。
  // 在点击里取而不是在 effect 里：晚一帧就会先送一次空关键字，把列表页已有关键字闪掉。
  const openPanel = () => {
    if (scope === 'projects') setQuery(new URLSearchParams(window.location.search).get('q') || '')
    setOpen(true)
  }

  const trimmed = query.trim()
  const projectHits = scope === 'projects' && projects
    ? applyProjectsQuery(projects, { ...emptyFilterState(), q: trimmed })
    : []
  const assetHits = scope === 'assets' && assets && trimmed
    ? assets
        .filter((item) => item.name.toLowerCase().includes(trimmed.toLowerCase()))
        // 前缀命中的排前面：181 集里搜「第3集」不该被「第30集」挤掉。
        .sort((a, b) => Number(b.name.startsWith(trimmed)) - Number(a.name.startsWith(trimmed)))
    : []
  const rows = scope === 'assets' ? assetHits : projectHits
  const shown = rows.slice(0, MAX_ROWS) as any[]

  const openAsset = (hit: AssetHit) => {
    // 素材的选中态住在工作区页里，沿仓库已有的 window 事件总线送过去（同 commentPosted）。
    window.dispatchEvent(new CustomEvent('railOpenAsset', {
      detail: { name: hit.name, folderId: hit.folderId },
    }))
    close()
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : openPanel())}
        aria-expanded={open}
        aria-label="搜索"
        title={scope === 'assets' ? '搜索当前项目的素材' : '搜索项目'}
        className={cn(
          className,
          open ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        )}
      >
        <Search className="h-[20px] w-[20px]" aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute left-full top-0 z-50 ml-2 w-80 overflow-hidden rounded-lg border border-border bg-card shadow-elevation-lg">
          <div className="border-b border-border px-3 py-2">
            <p className="truncate text-xs text-muted-foreground">
              {scope === 'assets' ? `在「${scopeName || '当前项目'}」里搜素材` : '搜索项目'}
            </p>
            <div className="relative mt-1.5">
              <Input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Escape') close() }}
                placeholder={scope === 'assets' ? '输入素材名称…' : '输入项目名称…'}
                aria-label={scope === 'assets' ? '搜索当前项目的素材' : '搜索项目'}
                className="h-9 pr-9 text-sm"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="清除关键字"
                  className="absolute right-7 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto p-1">
            {status === 'loading' && <p className="px-2 py-3 text-sm text-muted-foreground">正在载入…</p>}
            {status === 'error' && (
              <p className="px-2 py-3 text-sm text-muted-foreground">搜索载入失败，关掉再点开重试。</p>
            )}
            {status === 'ready' && !trimmed && scope === 'projects' && (
              <p className="px-2 py-3 text-sm text-muted-foreground">输入关键字开始搜索。</p>
            )}
            {status === 'ready' && trimmed && shown.length === 0 && (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                没有匹配的{scope === 'assets' ? '素材' : '项目'}，换个关键字或换个页面搜。
              </p>
            )}
            {shown.map((row) => (
              <ResultRow
                key={scope === 'assets' ? row.name : row.id}
                scope={scope}
                row={row}
                onProject={(id) => { close(); router.push(`/studio/projects/${id}`) }}
                onAsset={openAsset}
              />
            ))}
          </div>

          {rows.length > shown.length && (
            <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
              还有 {rows.length - shown.length} 条，接着打字缩小范围。
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ResultRow({ scope, row, onProject, onAsset }: {
  scope: 'assets' | 'projects'
  row: any
  onProject: (id: string) => void
  onAsset: (hit: AssetHit) => void
}) {
  const t = useTranslations('projects')
  const title = scope === 'assets' ? row.name : row.title
  const statusKey = STATUS_LABEL_KEY[row.status] || 'statusInReview'
  const meta = scope === 'assets'
    ? [row.versionLabel, row.uploadedByName && `上传者 ${row.uploadedByName}`].filter(Boolean).join(' · ')
    : [`${row._count?.videos ?? 0} 个视频`, t(statusKey)].filter(Boolean).join(' · ')

  return (
    <button
      type="button"
      onClick={() => (scope === 'assets' ? onAsset(row) : onProject(row.id))}
      className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent focus-visible:bg-accent"
    >
      <span className="w-full truncate text-sm font-medium text-foreground">{title}</span>
      <span className="w-full truncate text-xs text-muted-foreground">{meta}</span>
    </button>
  )
}
