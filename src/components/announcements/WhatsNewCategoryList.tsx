'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Inbox, RefreshCw } from 'lucide-react'
import WhatsNewCard from './WhatsNewCard'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api-client'
import type { AnnouncementCategorySlug } from '@/lib/announcements/categories'

interface CategoryItem {
  id: string
  title: string
  content: string
  imageUrl: string | null
  publishedAt: string | null
  createdAt: string
  type: string
  active: boolean
  isTest: boolean
}

export default function WhatsNewCategoryList({ slug }: { slug: AnnouncementCategorySlug }) {
  const [items, setItems] = useState<CategoryItem[] | null>(null)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    setError(false)
    setItems(null)
    try {
      const response = await apiFetch(
        `/api/announcements?surface=whats-new&category=${encodeURIComponent(slug)}`,
        { cache: 'no-store' },
      )
      if (!response.ok) throw new Error(String(response.status))
      const data = await response.json() as { items?: CategoryItem[] }
      setItems((Array.isArray(data.items) ? data.items : []).filter((item) => (
        item.type === 'RELEASE' && item.active && !item.isTest
      )))
    } catch {
      setError(true)
    }
  }, [slug])

  useEffect(() => {
    void load()
  }, [load])

  if (error) {
    return (
      <div className="mt-10 rounded-[20px] border border-border bg-card px-6 py-12 text-center">
        <p className="text-sm text-muted-foreground">分类文章读取失败，请稍后重试。</p>
        <Button type="button" variant="outline" size="sm" className="mt-4 h-9 px-4 text-xs" onClick={() => void load()}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          重试
        </Button>
      </div>
    )
  }

  if (items === null) {
    return (
      <div className="mt-10 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="flex flex-col gap-3">
            <div className="aspect-video w-full animate-pulse rounded-[20px] bg-muted/60" />
            <div className="h-5 w-4/5 animate-pulse rounded bg-muted" />
            <div className="h-4 w-full animate-pulse rounded bg-muted/60" />
            <div className="h-3 w-28 animate-pulse rounded bg-muted/50" />
          </div>
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="mt-10 rounded-[20px] border border-border bg-card px-6 py-14 text-center">
        <Inbox className="mx-auto h-7 w-7 text-muted-foreground/40" aria-hidden />
        <p className="mt-3 text-base font-medium text-foreground">这个分类暂无新增功能</p>
        <p className="mt-1 text-sm text-muted-foreground">有新的版本说明时会出现在这里。</p>
        <Button asChild size="sm" className="mt-5 h-9 px-4 text-xs">
          <Link href="/studio/projects">进入工作台</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="mt-10 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item, index) => (
        <WhatsNewCard
          key={item.id}
          title={item.title}
          content={item.content}
          imageUrl={item.imageUrl}
          date={item.publishedAt ?? item.createdAt}
          articleHref={`/whats-new/${item.id}`}
          priority={index === 0}
        />
      ))}
    </div>
  )
}