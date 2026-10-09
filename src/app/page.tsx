import type { Metadata } from 'next'
import HomeClient from './home-client'
import { BrandLd } from '@/components/marketing/BrandLd'
import { getSiteUrlFromRequest } from '@/lib/marketing/site-url'
import { BRAND } from '@/lib/marketing/brand'

/**
 * 首页此前既没有 canonical 也没有 Open Graph（2026-10-06 线上实测：`curl https://vidx.cn/` 里
 * `og:` 与 `rel="canonical"` 各 0 命中）。canonical 是防重复的那一道：`www.vidx.cn` 与
 * `vidx.cn` 现在都回 200、内容一模一样，只有绝对 canonical 能告诉引擎主 URL 是哪个。
 * `openGraph` 在子级是整块替换，根 layout 那份没有 openGraph，所以这里写就是净增。
 */
export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteUrlFromRequest()
  return {
    // 根 layout 没有 metadataBase（那里取基址一抛就是全站 500），所以相对路径的分享图
    // 必须在这一段自己带上基座——10-08 线上实测首页 og:image 曾渲染成 http://localhost:4321/…
    metadataBase: new URL(site),
    description: '面向影视团队的在线审片、版本管理、素材收录与安全交付平台。',
    alternates: { canonical: `${site}/` },
    openGraph: {
      type: 'website',
      siteName: BRAND.zh,
      locale: 'zh_CN',
      url: `${site}/`,
      // 与 `(marketing)/layout.tsx` 同一张图；换成 1200×630 的分享卡片图要另做一张素材。
      images: [{ url: '/og/brand-1200x630.png', width: 1200, height: 630, alt: BRAND.zh }],
    },
  }
}

export default function HomePage() {
  // 首页在 `(marketing)` 之外，拿不到那份 layout 里的品牌节点，而回答引擎做实体消歧
  // 最先看的就是首页。
  return (
    <>
      <BrandLd />
      <HomeClient />
    </>
  )
}
