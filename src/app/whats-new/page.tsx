import type { Metadata } from 'next'
import Link from 'next/link'
import WhatsNewCard from '@/components/announcements/WhatsNewCard'
import { JsonLd } from '@/components/marketing/JsonLd'
import { ANNOUNCEMENT_CATEGORIES } from '@/lib/announcements/categories'
import { listPublicReleaseArticles } from '@/lib/announcements/public-whats-new'
import { BRAND } from '@/lib/marketing/brand'
import { getSiteUrlFromRequest } from '@/lib/marketing/site-url'

export const dynamic = 'force-dynamic'

const TITLE = '产品更新与版本说明：视频审片功能迭代日志'
const DESCRIPTION =
  '在线视频审片平台的产品更新与版本说明汇总：记录逐帧批注、多版本对比、审片链接权限与素材收录等能力的持续迭代，公开面向影视团队查阅，无需登录即可阅读全部公开更新日志。'

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteUrlFromRequest()
  const url = `${site}/whats-new`
  return {
    metadataBase: new URL(site),
    title: TITLE,
    description: DESCRIPTION,
    keywords: [...BRAND.keywords],
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      siteName: BRAND.zh,
      locale: 'zh_CN',
      title: TITLE,
      description: DESCRIPTION,
      url,
      images: [{ url: '/og/brand-1200x630.png', width: 1200, height: 630, alt: BRAND.zh }],
    },
    robots: { index: true, follow: true },
  }
}

export default async function WhatsNewIndexPage() {
  const [site, items] = await Promise.all([
    getSiteUrlFromRequest(),
    listPublicReleaseArticles(),
  ])
  const url = `${site}/whats-new`

  return (
    <div className="wrap bg-white pb-12 dark:bg-background lg:pb-16">
      <div className="wrap-inner mx-auto w-full max-w-[1200px] px-5 pt-8 sm:px-[25px] sm:pt-12">
        <nav aria-label="面包屑" className="flex flex-wrap items-center gap-x-2 text-[14px] leading-[21px] text-muted-foreground">
          <Link href="/" className="hover:text-foreground">首页</Link>
          <span aria-hidden="true" className="text-muted-foreground/40">/</span>
          <span className="text-foreground">产品更新</span>
        </nav>

        <h1 className="mt-5 break-words text-[40px] font-bold leading-[1.15] tracking-[-0.02em] text-foreground sm:text-[48px]">
          产品更新与版本说明
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-7 text-muted-foreground">
          公开记录在线视频审片、逐帧批注、版本管理与交付权限的每次迭代。按分类浏览，或直接查看近期版本说明。
        </p>

        <nav aria-label="更新分类" className="mt-6 flex flex-wrap items-center gap-2">
          <Link
            href="/whats-new"
            className="inline-flex h-9 items-center rounded-full border border-foreground bg-foreground px-4 text-xs font-medium text-background"
          >
            全部更新
          </Link>
          {ANNOUNCEMENT_CATEGORIES.map((category) => (
            <Link
              key={category.slug}
              href={`/whats-new/category/${category.slug}`}
              className="inline-flex h-9 items-center rounded-full border border-border bg-card px-4 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
            >
              {category.label}
            </Link>
          ))}
        </nav>

        {items.length > 0 ? (
          <div className="mt-10 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item, index) => (
              <WhatsNewCard
                key={item.id}
                title={item.title}
                content={item.content}
                imageUrl={item.imageUrl}
                ctaLabel={item.ctaLabel}
                ctaUrl={item.ctaUrl}
                date={item.publishedAt}
                articleHref={`/whats-new/${item.id}`}
                priority={index === 0}
              />
            ))}
          </div>
        ) : (
          <section className="mt-10 rounded-[20px] border border-border bg-card px-6 py-10 sm:px-8">
            <h2 className="text-lg font-semibold text-foreground">当前公开发布的迭代说明</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              新的公开版本说明发布后会在此汇总展示。你也可以先查看已上线的功能说明、内测公告与团队选型指南：
            </p>
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <Link
                href="/news/beta"
                className="rounded-xl border border-border bg-background p-4 transition-colors hover:border-foreground/30"
              >
                <p className="text-sm font-semibold text-foreground">成长计划内测公告</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">了解 10 GB 存储空间、5 人席位与扩容申请方式。</p>
              </Link>
              <Link
                href="/features"
                className="rounded-xl border border-border bg-background p-4 transition-colors hover:border-foreground/30"
              >
                <p className="text-sm font-semibold text-foreground">视频审片功能总览</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">查看逐帧批注、版本对比与审片链接权限说明。</p>
              </Link>
              <Link
                href="/guides"
                className="rounded-xl border border-border bg-background p-4 transition-colors hover:border-foreground/30"
              >
                <p className="text-sm font-semibold text-foreground">在线审片场景指南</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">覆盖短剧多集审片、样片防泄密与软件选型清单。</p>
              </Link>
            </div>
          </section>
        )}

        <JsonLd
          value={{
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            '@id': `${url}#collection`,
            url,
            name: TITLE,
            description: DESCRIPTION,
            inLanguage: 'zh-CN',
            isPartOf: { '@type': 'WebSite', '@id': `${site}/#website` },
            mainEntity: {
              '@type': 'ItemList',
              itemListElement: items.map((item, index) => ({
                '@type': 'ListItem',
                position: index + 1,
                name: item.title,
                url: `${site}/whats-new/${item.id}`,
              })),
            },
          }}
        />
        <JsonLd
          value={{
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: BRAND.zh, item: site },
              { '@type': 'ListItem', position: 2, name: '产品更新', item: url },
            ],
          }}
        />
      </div>
    </div>
  )
}
