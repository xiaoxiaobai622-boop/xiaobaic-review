'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { usePathname } from 'next/navigation'
import { apiFetch } from '@/lib/api-client'
import { markAnnouncementsRead } from '@/lib/announcement-feed-store'
import WhatsNewCard from '@/components/announcements/WhatsNewCard'
import RailPanel from '@/components/RailPanel'
import {
  WHATS_NEW_READ_EVENT,
  type WhatsNewReadEventDetail,
} from '@/lib/announcements/whats-new-events'
import { cn } from '@/lib/utils'

// 喇叭图标直接从对标截图里抠出来（public/rail/whats-new.png），只取 alpha 当遮罩，
// 颜色跟当前文字走，浅色/暗色和 hover 都不用另做一套。
const ICON_MASK: CSSProperties = {
  WebkitMaskImage: 'url(/rail/whats-new.png)',
  WebkitMaskSize: 'contain',
  WebkitMaskRepeat: 'no-repeat',
  WebkitMaskPosition: 'center',
  maskImage: 'url(/rail/whats-new.png)',
  maskSize: 'contain',
  maskRepeat: 'no-repeat',
  maskPosition: 'center',
}

function WhatsNewIcon({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('block bg-current', className)} style={ICON_MASK} />
}

interface WhatsNewItem {
  id: string
  title: string
  content: string
  imageUrl: string | null
  ctaLabel: string | null
  ctaUrl: string | null
  publishedAt: string | null
  createdAt: string
  type: string
  active: boolean
  isTest: boolean
  readAt: string | null
}

function timeOf(item: WhatsNewItem) {
  return new Date(item.publishedAt ?? item.createdAt).getTime()
}

/** 侧栏底部：原来「帮助」的位置，现在放平台的新增功能。 */
export default function RailWhatsNew({ className }: { className?: string }) {
  const pathname = usePathname()
  const lastPathRef = useRef<string | null>(null)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<WhatsNewItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(async (showLoading: boolean) => {
    if (showLoading) setLoading(true)
    setError(false)
    try {
      // surface=whats-new 在服务端先按 RELEASE 过滤，再套用 100 条上限，
      // 活动公告再多也不会把新增功能挤掉。
      const response = await apiFetch('/api/announcements?surface=whats-new', { cache: 'no-store' })
      if (!response.ok) throw new Error(String(response.status))
      const data = await response.json() as { items?: WhatsNewItem[] }
      setItems(Array.isArray(data.items) ? data.items : [])
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(true)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(false)
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [load])

  useEffect(() => {
    if (!open) return
    void load(false)
  }, [open, load])

  useEffect(() => {
    if (lastPathRef.current === null) {
      lastPathRef.current = pathname
      return
    }
    if (lastPathRef.current !== pathname) {
      lastPathRef.current = pathname
      void load(false)
    }
  }, [load, pathname])

  useEffect(() => {
    const onRead = (event: Event) => {
      const ids = (event as CustomEvent<WhatsNewReadEventDetail>).detail?.ids
      if (!Array.isArray(ids) || ids.length === 0) return
      const now = new Date().toISOString()
      setItems((current) => current?.map((item) => (
        ids.includes(item.id) ? { ...item, readAt: item.readAt ?? now } : item
      )) ?? current)
    }
    window.addEventListener(WHATS_NEW_READ_EVENT, onRead)
    return () => window.removeEventListener(WHATS_NEW_READ_EVENT, onRead)
  }, [])

  const visible = useMemo(() => {
    return (items ?? [])
      .filter((item) => item.type === 'RELEASE' && item.active && !item.isTest)
      .sort((a, b) => timeOf(b) - timeOf(a))
  }, [items])

  const unreadCount = useMemo(
    () => visible.filter((item) => !item.readAt).length,
    [visible],
  )

  useEffect(() => {
    if (!open || items === null) return
    const unreadIds = items
      .filter((item) => item.type === 'RELEASE' && item.active && !item.isTest && !item.readAt)
      .map((item) => item.id)
    if (unreadIds.length === 0) return
    let cancelled = false
    void markAnnouncementsRead(unreadIds).then((marked) => {
      if (!marked || cancelled) return
      const now = new Date().toISOString()
      setItems((current) => current?.map((item) => (
        unreadIds.includes(item.id) ? { ...item, readAt: item.readAt ?? now } : item
      )) ?? current)
    })
    return () => { cancelled = true }
  }, [items, open])

  return (
    <RailPanel
      name="whats-new"
      label="新增功能"
      closeLabel="关闭新增功能"
      open={open}
      onOpenChange={setOpen}
      headerClassName="lg:!h-[var(--studio-header-height)]"
      trigger={(
        <button
          type="button"
          aria-label="新增功能"
          title="新增功能"
          className={cn(className, 'relative', 'text-muted-foreground hover:text-foreground')}
        >
          <WhatsNewIcon className="h-[22px] w-[22px]" />
          {unreadCount > 0 ? (
            <span
              data-whats-new-unread
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-destructive"
            />
          ) : null}
        </button>
      )}
    >
      <div className="min-h-0 flex-1 overflow-y-auto bg-popover">
        <div className="flex flex-col gap-4 px-3 py-4">
          {items === null && loading && (
            <p className="text-sm text-muted-foreground">正在载入新增功能…</p>
          )}
          {items === null && !loading && error && (
            <div className="text-sm text-muted-foreground">
              <p>新增功能读取失败，稍后会自动重试。</p>
              <button
                type="button"
                onClick={() => void load(true)}
                className="mt-2 text-xs text-primary underline-offset-2 hover:underline"
              >
                重试
              </button>
            </div>
          )}
          {items !== null && visible.length === 0 && (
            <div className="flex min-h-[360px] flex-col items-center justify-center gap-2 px-6 text-center">
              <WhatsNewIcon className="h-10 w-10 text-muted-foreground/25" />
              <p className="text-sm font-medium text-foreground">还没有新增功能</p>
              <p className="text-xs text-muted-foreground">有更新时会出现在这里。</p>
            </div>
          )}
          {visible.map((item, index) => (
            <WhatsNewCard
              key={item.id}
              title={item.title}
              content={item.content}
              imageUrl={item.imageUrl}
              ctaLabel={item.ctaLabel}
              ctaUrl={item.ctaUrl}
              date={item.publishedAt ?? item.createdAt}
              articleHref={`/whats-new/${item.id}`}
              priority={index === 0}
            />
          ))}
        </div>
      </div>
    </RailPanel>
  )
}
