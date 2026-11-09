import type { Metadata } from 'next'
import HomeClient from './home-client'
import { BrandLd } from '@/components/marketing/BrandLd'
import { JsonLd } from '@/components/marketing/JsonLd'
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
    title: { absolute: '逐帧审阅：在线审片与视频批注协作平台' },
    description: BRAND.homeDescription,
    keywords: [...BRAND.keywords],
    alternates: { canonical: site },
    openGraph: {
      type: 'website',
      siteName: BRAND.zh,
      locale: 'zh_CN',
      title: '逐帧审阅：在线审片与视频批注协作平台',
      description: BRAND.homeDescription,
      url: site,
      // 与 `(marketing)/layout.tsx` 同一张图；换成 1200×630 的分享卡片图要另做一张素材。
      images: [{ url: '/og/brand-1200x630.png', width: 1200, height: 630, alt: BRAND.zh }],
    },
  }
}

export default async function HomePage() {
  // 首页在 `(marketing)` 之外，拿不到那份 layout 里的品牌节点，而回答引擎做实体消歧
  // 最先看的就是首页。
  const site = await getSiteUrlFromRequest()
  return (
    <>
      <link rel="preload" as="image" href="/home/hero-poster.jpg" fetchPriority="high" />
      <BrandLd />
      <HomeClient />
      {/* 首页首屏有一段真实的产品演示视频（46.79 秒，H.264），与页面上可见的 <video> 同源同封面。
          时长由 ffprobe 实测，uploadDate 取对象存储的 Last-Modified，缩略图用视频 poster。 */}
      <JsonLd
        value={{
          '@context': 'https://schema.org',
          '@type': 'VideoObject',
          '@id': `${site}/#product-demo`,
          name: '逐帧审阅产品演示：逐帧批注与版本对比',
          description: '演示在时间轴上按帧号定位批注、圈画画面、切换版本并生成审片链接的操作过程。',
          thumbnailUrl: `${site}/home/hero-poster.jpg`,
          contentUrl: 'https://media.vidx.cn/home/hero-b6cc37fa.mp4',
          duration: 'PT46.79S',
          uploadDate: '2026-10-23',
          inLanguage: 'zh-CN',
          width: 1600,
          height: 884,
          publisher: { '@id': `${site}/#organization` },
          mainEntityOfPage: { '@type': 'WebPage', '@id': site },
        }}
      />
    </>
  )
}
