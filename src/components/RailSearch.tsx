'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 窄栏那枚放大镜：对标（next.frame.io 的 dock）是一条链接进 /search 整页，
 * 不是浮在栏边的小卡——所以这里只留链接本身，搜索住在 `src/app/studio/search/page.tsx`。
 * 选中态和「项目中心」那枚同一套语言：只换字色、不铺底色。
 */
export default function RailSearch({ className }: { className?: string }) {
  const pathname = usePathname()
  const active = pathname === '/studio/search'
  return (
    <Link
      href="/studio/search"
      aria-label="搜索"
      title="搜索素材与项目"
      aria-current={active ? 'page' : undefined}
      className={cn(
        className,
        active ? 'text-foreground' : 'text-muted-foreground hover:text-accent-foreground',
      )}
    >
      <Search className="h-[20px] w-[20px]" aria-hidden />
    </Link>
  )
}
