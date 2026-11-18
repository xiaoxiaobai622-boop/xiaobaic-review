'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { refreshAnnouncementFeed, useAnnouncementFeed } from '@/lib/announcement-feed-store'
import { isExternalUrl } from '@/lib/announcements/url'
import RailPanel from '@/components/RailPanel'
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

function formatDay(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}

/** 侧栏底部：原来「帮助」的位置，现在放平台的新增功能/公告。 */
export default function RailWhatsNew({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const feed = useAnnouncementFeed()
  const items = useMemo(() => {
    const rows = feed.data?.items ?? []
    return [...rows]
      .filter((item) => item.active && !item.isTest)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [feed.data])

  useEffect(() => {
    if (open) void refreshAnnouncementFeed(true)
  }, [open])

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
          className={cn(className, 'text-muted-foreground hover:text-foreground')}
        >
          <WhatsNewIcon className="h-[22px] w-[22px]" />
        </button>
      )}
    >
      <div className="h-[var(--studio-shell-gap)] shrink-0 bg-background" />
      <div className="min-h-0 flex-1 overflow-y-auto bg-popover">
        {!feed.data && feed.loading && (
          <p className="px-3 py-4 text-sm text-muted-foreground">正在载入新增功能…</p>
        )}
        {!feed.data && feed.error && (
          <p className="px-3 py-4 text-sm text-muted-foreground">新增功能读取失败，稍后会自动重试。</p>
        )}
        {feed.data && items.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <WhatsNewIcon className="h-10 w-10 text-muted-foreground/25" />
            <p className="text-sm font-medium text-foreground">还没有新增功能</p>
            <p className="text-xs text-muted-foreground">有更新时会出现在这里。</p>
          </div>
        )}
        {items.map((item) => (
          <article key={item.id} data-whats-new-row className="mx-2 rounded-lg px-3 py-4 transition-colors hover:bg-card">
            {item.imageUrl && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.imageUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="aspect-video w-full rounded-lg object-cover"
                />
              </>
            )}
            <h3 className={cn('text-base font-semibold leading-snug text-foreground', item.imageUrl && 'mt-3')}>
              {item.title}
            </h3>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
              {item.content}
            </p>
            {item.ctaUrl && (
              <a
                href={item.ctaUrl}
                target={isExternalUrl(item.ctaUrl) ? '_blank' : undefined}
                rel={isExternalUrl(item.ctaUrl) ? 'noopener noreferrer' : undefined}
                className="mt-1 inline-flex text-sm font-medium text-primary underline-offset-2 hover:underline"
              >
                {item.ctaLabel || '了解详情'}
              </a>
            )}
            <p className="mt-2 text-xs text-muted-foreground">{formatDay(item.createdAt)}</p>
          </article>
        ))}
      </div>
    </RailPanel>
  )
}
