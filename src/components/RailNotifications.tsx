'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell } from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api-client'
import { formatDateTime } from '@/lib/utils'

interface ReplyItem {
  id: string
  content: string
  timecode: string
  createdAt: string
  authorName: string
  parentContent: string
  videoName: string
  projectTitle: string
  projectId: string
}

const SEEN_STORAGE_KEY = 'admin_notifications_seen_at'
const REFRESH_INTERVAL_MS = 30_000

function readSeenAt(): string | null {
  try { return localStorage.getItem(SEEN_STORAGE_KEY) } catch { return null }
}

function writeSeenAt(value: string) {
  try { localStorage.setItem(SEEN_STORAGE_KEY, value) } catch { /* 隐私模式下存不下，不影响本次会话 */ }
}

function relativeTime(value: string): string {
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  return formatDateTime(value)
}

/** 审阅链接的形态和飞书卡片用的深链一致：认素材名、带时间码，另外把要定位的那条回复带过去。 */
function replyHref(item: ReplyItem): string {
  const params = new URLSearchParams({ video: item.videoName, comment: item.id })
  if (item.timecode) params.set('t', item.timecode)
  return `/studio/projects/${item.projectId}/share?${params.toString()}`
}

interface PlatformItem {
  id: string
  title: string
  content: string
  createdAt: string
  readAt: string | null
}

export default function RailNotifications({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'replies' | 'platform'>('replies')
  const [items, setItems] = useState<ReplyItem[]>([])
  const [unread, setUnread] = useState(0)
  const [failed, setFailed] = useState(false)
  const [platformItems, setPlatformItems] = useState<PlatformItem[]>([])
  const [platformUnread, setPlatformUnread] = useState(0)
  // 面板里「哪几条是这次新看到的」按取这批数据之前的水位算，写回水位不能把它一起抹掉。
  const [watermark, setWatermark] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const router = useRouter()

  const load = useCallback(async (): Promise<ReplyItem[]> => {
    const since = readSeenAt()
    setWatermark(since)
    try {
      const query = since ? `?since=${encodeURIComponent(since)}` : ''
      const response = await apiFetch(`/api/comments/for-me${query}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(String(response.status))
      const data = await response.json()
      const loaded = (data.items || []) as ReplyItem[]
      setItems(loaded)
      setUnread(Number(data.unread) || 0)
      setFailed(false)
      return loaded
    } catch {
      // 拉不到就留着上一次的列表，红点不该替网络状态说谎。
      setFailed(true)
      return []
    }
  }, [])

  const loadPlatform = useCallback(async (): Promise<PlatformItem[]> => {
    try {
      const response = await apiFetch('/api/announcements', { cache: 'no-store' })
      if (!response.ok) throw new Error(String(response.status))
      const data = await response.json()
      const loaded = (data.items || []) as PlatformItem[]
      setPlatformItems(loaded)
      setPlatformUnread(Number(data.unread) || 0)
      return loaded
    } catch {
      return []
    }
  }, [])

  useEffect(() => { load(); loadPlatform() }, [load, loadPlatform])

  // 30 秒一次，且只在标签页可见时打（和审阅页那套刷新节奏一致）。
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') { load(); loadPlatform() } }
    const timer = window.setInterval(tick, REFRESH_INTERVAL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') { load(); loadPlatform() } }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load, loadPlatform])

  useEffect(() => {
    if (!open) return
    const handleMouseDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close()
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [open])

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const markAllSeen = (loaded: ReplyItem[]) => {
    const newest = loaded[0]?.createdAt
    if (newest) writeSeenAt(newest)
    setUnread(0)
  }

  const toggle = async () => {
    if (open) { close(); return }
    setOpen(true)
    markAllSeen(await load())
  }

  const openThread = (item: ReplyItem) => {
    markAllSeen(items)
    close()
    router.push(replyHref(item))
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={unread + platformUnread > 0 ? `${unread + platformUnread} 条未读通知` : '通知'}
        title={unread + platformUnread > 0 ? `${unread + platformUnread} 条未读通知` : '通知'}
        className={cn(
          className,
          open ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        )}
      >
        <Bell className="h-[20px] w-[20px]" aria-hidden="true" />
        {unread + platformUnread > 0 && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-destructive" />}
      </button>

      {open && (
        <div className="absolute left-full top-0 z-50 ml-2 w-96 overflow-hidden rounded-lg border border-border bg-card shadow-elevation-lg">
          <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
            <button
              type="button"
              onClick={() => setTab('replies')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${tab === 'replies' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              批注回复{unread > 0 ? ` · ${unread}` : ''}
            </button>
            <button
              type="button"
              onClick={() => { setTab('platform'); if (platformUnread > 0) { setPlatformUnread(0); void fetch('/api/announcements/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: platformItems.map((i) => i.id) }) }) } }}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${tab === 'platform' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              平台消息{platformUnread > 0 ? ` · ${platformUnread}` : ''}
            </button>
          </div>

          {tab === 'replies' && (<>
          <div className="flex items-baseline justify-between gap-2 px-3 pt-2">
            <p className="text-sm font-medium text-foreground">批注回复</p>
            <p className="text-xs text-muted-foreground">{items.length > 0 ? `${items.length} 条` : ''}</p>
          </div>

          <div className="max-h-[420px] overflow-y-auto p-1">
            {items.length === 0 && !failed && (
              <p className="px-2 py-4 text-sm text-muted-foreground">还没有人回复你的批注。</p>
            )}
            {items.length === 0 && failed && (
              <p className="px-2 py-4 text-sm text-muted-foreground">通知载入失败，30 秒后自动重试。</p>
            )}
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => openThread(item)}
                className="w-full rounded-md px-2 py-2 text-left transition-colors hover:bg-accent focus-visible:bg-accent"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">
                    {item.authorName} 回复了你
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(item.createdAt)}</span>
                </span>
                <span className="mt-0.5 line-clamp-2 text-sm text-foreground">{item.content}</span>
                <span className="mt-0.5 truncate text-xs text-muted-foreground">
                  {item.projectTitle} · {item.videoName}{item.timecode ? ` · ${item.timecode}` : ''}
                </span>
                {watermark && new Date(item.createdAt) > new Date(watermark) && (
                  <span className="mt-1 inline-flex items-center gap-1 text-xs text-primary">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                    未读
                  </span>
                )}
              </button>
            ))}
          </div>
          </>)}

          {tab === 'platform' && (<>
          <div className="max-h-[420px] overflow-y-auto p-1">
            {platformItems.length === 0 && (
              <p className="px-2 py-4 text-sm text-muted-foreground">还没有平台消息。</p>
            )}
            {platformItems.map((item) => (
              <div
                key={item.id}
                className="w-full rounded-md px-2 py-2 text-left"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className={`min-w-0 truncate text-sm ${item.readAt ? 'text-foreground' : 'font-semibold text-primary'}`}>
                    {item.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(item.createdAt)}</span>
                </span>
                <span className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">{item.content}</span>
                {!item.readAt && (
                  <span className="mt-1 inline-flex items-center gap-1 text-xs text-primary">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                    未读
                  </span>
                )}
              </div>
            ))}
          </div>
          </>)}
        </div>
      )}
    </div>
  )
}
