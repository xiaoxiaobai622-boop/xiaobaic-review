import type { Metadata } from 'next'
import Link from 'next/link'
import { getSiteUrlFromRequest } from '@/lib/marketing/site-url'
import { BRAND } from '@/lib/marketing/brand'
import { BrandLd } from '@/components/marketing/BrandLd'

/**
 * 营销路由的 metadata 基座：绝对 URL 只在 `(marketing)` 内取（根 layout 每请求都跑，
 * `getSiteUrl()` 在那儿抛错等于全站 500）。`robots` 与根一样要 `index` + `follow` 两个都写
 * ——子级 metadata 是整体替换，不是深合并。
 */
export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteUrlFromRequest()
  return {
    metadataBase: new URL(site),
    openGraph: {
      type: 'website',
      siteName: BRAND.zh,
      locale: 'zh_CN',
      url: site,
      images: [{ url: '/brand/logo.png', width: 256, height: 256, alt: BRAND.zh }],
    },
    twitter: { card: 'summary', title: BRAND.zh, images: ['/brand/logo.png'] },
    robots: { index: true, follow: true },
  }
}

/**
 * 页内版式：`(marketing)` 下的页面仍然套在根 layout 里（根 layout 有一堆 provider 和
 * `force-dynamic`，本期不动它），所以这里的 header/footer 是页内的，不碰 `<html>`/`<body>`，
 * 也不额外开 `<main>`（根 layout 已经有）。视觉语言照 `src/components/LegalDoc.tsx`。
 */
export default function MarketingLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-dvh flex-col bg-[#f4f5f7] text-[#171a20]">
      <BrandLd />
      <header className="border-b border-[#dfe2e7] bg-white">
        <div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-5">
          <Link href="/" className="font-semibold text-[15px]">{BRAND.zh}</Link>
          <nav className="flex items-center gap-4 text-sm text-[#6f7580]">
            <Link href="/features" className="hover:text-[#171a20]">功能</Link>
            <Link href="/compare" className="hover:text-[#171a20]">对比</Link>
            <Link href="/" className="hover:text-[#171a20]">返回首页</Link>
          </nav>
        </div>
      </header>

      <div className="flex-1">{children}</div>

      <footer className="border-t border-[#dfe2e7] bg-white">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-5 text-xs text-[#8b919b]">
          <span>{BRAND.zh}</span>
          <nav className="flex flex-wrap items-center gap-3">
            <Link href="/privacy" className="hover:text-[#171a20]">隐私政策</Link>
            <Link href="/terms" className="hover:text-[#171a20]">服务条款</Link>
            <a href="https://beian.miit.gov.cn" target="_blank" rel="noopener noreferrer" className="hover:text-[#171a20]">
              桂ICP备2026022852号
            </a>
          </nav>
        </div>
      </footer>
    </div>
  )
}
