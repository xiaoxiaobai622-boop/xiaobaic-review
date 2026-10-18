'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { apiFetch } from '@/lib/api-client'
import { initialsFromName } from '@/components/InitialsAvatar'
import { formatDuration, formatDate } from '@/lib/utils'
import { useTranslations } from 'next-intl'

/**
 * 窄栏放大镜落地的整页搜索，形态照 next.frame.io 的 /search：顶部一条带居中的输入框，
 * 下面一行筛选，结果按行走，底部一句条数。关键字写进 URL，刷新和把链接发给别人都在。
 *
 * 封面走现成的逐枚签发（和工作区网格同一套，那端点限流 600/分钟，50 行撞不上）；
 * 没有封面帧或签不到的一律退回「名称首字＋时长角标」那块灰片，不留裂图。
 */
type ProjectHit = { id: string; title: string; projectCode: string; status: string; videoCount: number }
type AssetHit = {
  id: string; name: string; version: number; versionLabel: string; duration: number
  folderId: string | null; folderName: string | null
  projectId: string; projectTitle: string; uploadedByName: string | null; createdAt: string
  hasThumbnail: boolean
}

const STATUS_LABEL_KEY: Record<string, string> = {
  IN_REVIEW: 'statusInReview',
  APPROVED: 'statusApproved',
  SHARE_ONLY: 'statusShareOnly',
  ARCHIVED: 'statusArchived',
}

const DEBOUNCE_MS = 300

// 不用 useSearchParams：那枚钩子要求整页活在 Suspense 边界里，否则 next build 判这页
// 「不能静态渲染」。首屏关键字直接读 location.search，回写用 history.replaceState，
// 都不惊动 Next 的渲染器。
export default function RailSearchPage() {
  const router = useRouter()
  const t = useTranslations('projects')
  const [query, setQuery] = useState('')
  const [type, setType] = useState<'all' | 'projects' | 'assets'>('all')
  const [sort, setSort] = useState<'relevance' | 'newest'>('relevance')
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [projects, setProjects] = useState<ProjectHit[]>([])
  const [assets, setAssets] = useState<AssetHit[]>([])
  const [truncated, setTruncated] = useState(false)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const inputRef = useRef<HTMLInputElement>(null)
  const [searched, setSearched] = useState(true)

  useEffect(() => {
    inputRef.current?.focus()
    // 首屏从 URL 带进来的关键字要真的去查一次，不能只把字填进框里。
    const fromUrl = new URLSearchParams(window.location.search).get('q') || ''
    if (fromUrl) setQuery(fromUrl)
  }, [])

  useEffect(() => {
    if (!query.trim()) { setStatus('idle'); setProjects([]); setAssets([]); setSearched(true); return }
    setStatus('loading')
    let cancelled = false
    const timer = window.setTimeout(async () => {
      const params = new URLSearchParams({ q: query, type, sort })
      const response = await apiFetch(`/api/studio/search?${params.toString()}`, { cache: 'no-store' }).catch(() => null)
      if (cancelled) return
      if (!response?.ok) { setStatus('error'); setSearched(true); return }
      const data = await response.json().catch(() => null)
      setProjects(data?.projects || [])
      setAssets(data?.assets || [])
      setTruncated(Boolean(data?.truncated))
      setStatus('ready')
      setSearched(true)
    }, DEBOUNCE_MS)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [query, type, sort])

  // 关键字写进 URL（刷新、把链接发给别人都还在）。用 replaceState 而不是 router：
  // 后者会把新 searchParams 推回渲染，和上面那条 effect 形成一轮一轮的空转。
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (query) params.set('q', query); else params.delete('q')
    const next = `/studio/search${params.toString() ? `?${params.toString()}` : ''}`
    if (window.location.pathname + window.location.search !== next) {
      window.history.replaceState(null, '', next)
    }
  }, [query])

  // 封面帧不是免费的：和工作区网格一样，逐枚向 /api/studio/video-token 换一枚
  // 只读 token 再指到 /api/content/。没有封面或换不到的一律退回名称首字那块灰片。
  useEffect(() => {
    const targets = assets.filter((row) => row.hasThumbnail)
    if (targets.length === 0) { setThumbs({}); return }
    let cancelled = false
    void Promise.all(targets.map(async (row) => {
      const params = new URLSearchParams({ videoId: row.id, projectId: row.projectId, quality: 'thumbnail' })
      const response = await apiFetch(`/api/studio/video-token?${params.toString()}`, { cache: 'no-store' }).catch(() => null)
      if (!response?.ok) return null
      const data = await response.json().catch(() => null)
      return data?.token ? ([row.id, `/api/content/${data.token}`] as const) : null
    })).then((entries) => {
      if (!cancelled) setThumbs(Object.fromEntries(entries.filter(Boolean) as Array<readonly [string, string]>))
    })
    return () => { cancelled = true }
  }, [assets])

  const openAsset = useCallback((hit: AssetHit) => {
    const params = new URLSearchParams({ workspace: 'videos', asset: hit.name })
    if (hit.folderId) params.set('folder', hit.folderId)
    router.push(`/studio/projects/${hit.projectId}?${params.toString()}`)
  }, [router])

  const total = projects.length + assets.length
  const trimmed = query.trim()

  return (
    <div className="flex h-full min-h-0 flex-col bg-popover">
      <header className="flex shrink-0 items-center justify-center border-b border-border px-4 py-2">
        <div className="relative w-[420px] max-w-full">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜素材名、项目名…"
            aria-label="搜索"
            className="h-10 pl-9 pr-9 text-sm"
          />
          {query ? (
            <button
              type="button"
              onClick={() => { setQuery(''); inputRef.current?.focus() }}
              aria-label="清除关键字"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[820px] px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            <Segmented label="类型" value={type} onChange={(v) => setType(v as typeof type)} options={[
              { value: 'all', text: '全部' }, { value: 'projects', text: '项目' }, { value: 'assets', text: '素材' },
            ]} />
            <Segmented label="排序" value={sort} onChange={(v) => setSort(v as typeof sort)} options={[
              { value: 'relevance', text: '相关度' }, { value: 'newest', text: '最新' },
            ]} />
          </div>

          {status === 'error' && <p className="px-2 py-6 text-sm text-muted-foreground">搜索失败，稍后再试。</p>}
          {status !== 'error' && !trimmed && (
            <Empty
              title="搜素材名、项目名"
              hint="开始输入即搜"
            />
          )}
          {status !== 'error' && trimmed && status === 'loading' && !searched && (
            <p className="px-2 py-6 text-sm text-muted-foreground">正在搜索…</p>
          )}
          {status === 'ready' && total === 0 && (
            <Empty title="没有匹配的结果" hint="换个关键字，或把类型切回全部" />
          )}

          {(type !== 'assets' ? projects : []).map((row) => (
            <button
              key={`p-${row.id}`}
              type="button"
              data-search-row
              onClick={() => router.push(`/studio/projects/${row.id}`)}
              className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent focus-visible:bg-accent"
            >
              <Tile text={row.title} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{row.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  项目 {row.projectCode} · {row.videoCount} 个视频 · {t(STATUS_LABEL_KEY[row.status] || 'statusInReview')}
                </span>
              </span>
            </button>
          ))}

          {(type !== 'projects' ? assets : []).map((row) => (
            <button
              key={`a-${row.id}`}
              type="button"
              data-search-row
              onClick={() => openAsset(row)}
              className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent focus-visible:bg-accent"
            >
              <Tile text={row.name} duration={formatDuration(row.duration)} src={thumbs[row.id]} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{row.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {row.projectTitle} › {row.folderName || '根目录'} · {row.versionLabel} · {formatDate(row.createdAt)}
                </span>
              </span>
            </button>
          ))}

          {status === 'ready' && total > 0 && (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              {total} 项{truncated ? '（每类最多 50 条，接着打字缩小范围）' : ''}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function Segmented({ label, value, onChange, options }: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; text: string }[]
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1 rounded-md bg-muted p-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={value === option.value}
            className={`rounded px-2 py-0.5 transition-colors ${value === option.value ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {option.text}
          </button>
        ))}
      </span>
    </span>
  )
}

/** 结果行左边那块片：16:9、名称首字、右下角时长。 */
function Tile({ text, duration, src }: { text: string; duration?: string; src?: string }) {
  const [broken, setBroken] = useState(false)
  return (
    <span className="relative flex h-[54px] w-[96px] shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-sm font-semibold text-muted-foreground">
      {src && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" onError={() => setBroken(true)} className="h-full w-full object-cover" />
      ) : initialsFromName(text)}
      {duration && (
        <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[11px] font-normal tabular-nums text-white">{duration}</span>
      )}
    </span>
  )
}

function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
      <Search className="h-10 w-10 text-muted-foreground/40" aria-hidden data-empty-mark />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}
