import type { Metadata } from 'next'
import { HubPage, hubMetadata } from '@/components/marketing/HubPage'

/**
 * 显式目录，不是 `[group]/page.tsx`：根级 `src/app/[shareCode]/page.tsx` 已经吃掉任意一段 URL，
 * 动态段会与之撞成"两个页面解析同一段"，Next 直接报错（2026-10-03 裁决 2）。
 * 文案与 JSON-LD 都在 `HubPage.tsx` 里，两个枢纽共用一张表。
 */
export async function generateMetadata(): Promise<Metadata> {
  return hubMetadata('features')
}

export default function FeaturesHubRoute() {
  return <HubPage group="features" />
}
