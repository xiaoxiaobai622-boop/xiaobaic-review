import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import WhatsNewCard from '@/components/announcements/WhatsNewCard'
import { JsonLd } from '@/components/marketing/JsonLd'
import {
  ANNOUNCEMENT_CATEGORIES,
  ANNOUNCEMENT_CATEGORY_LABELS,
  isAnnouncementCategorySlug,
} from '@/lib/announcements/categories'
import { listPublicReleaseArticles } from '@/lib/announcements/public-whats-new'
import { BRAND } from '@/lib/marketing/brand'
import { getSiteUrlFromRequest } from '@/lib/marketing/site-url'

type Props = { params: Promise<{ slug: string }> }

export const dynamic = 'force-dynamic'
export const dynamicParams = false

export function generateStaticParams() {
  return ANNOUNCEMENT_CATEGORIES.map((category) => ({ slug: category.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  if (!isAnnouncementCategorySlug(slug)) {
    return { title: '分类不存在', robots: { index: false, follow: true } }
  }
  const site = await getSiteUrlFromRequest()
  const url = `${site}/whats-new/category/${slug}`
  const label = ANNOUNCEMENT_CATEGORY_LABELS[slug]
  const title = `${label} · 产品更新与版本说明`
  const description = `${label}分类下的公开产品更新日志汇总，记录在线视频审片、逐帧批注、版本管理与审片交付权限的功能迭代与说明。`
  return {
    metadataBase: new URL(site),
    title,
    description,
    keywords: [...BRAND.keywords],
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      siteName: BRAND.zh,
      locale: 'zh_CN',
      title,
      description,
      url,
      images: [{ url: '/og/brand-1200x630.png', width: 1200, height: 630, alt: BRAND.zh }],
    },
    robots: { index: true, follow: true },
  }
}

export default async function WhatsNewCategoryPage({ params }: Props) {
  const { slug } = await params
  if (!isAnnouncementCategorySlug(slug)) notFound()

  const label = ANNOUNCEMENT_CATEGORY_LABELS[slug]
  const [site, items] = await Promise.all([
    getSiteUrlFromRequest(),
    listPublicReleaseArticles({ category: slug }),
  ])
  const url = `${site}/whats-new/category/${slug}`

  return (
    <div className="wrap bg-white pb-12 dark:bg-background lg:pb-16">
      <div className="wrap-inner mx-auto w-full max-w-[1200px] px-5 pt-8 sm:px-[25px] sm:pt-12">
        <nav aria-label="面包屑" className="flex flex-wrap items-center gap-x-2 text-[14px] leading-[21px] text-muted-foreground">
          <Link href="/" className="hover:text-foreground">首页</Link>
          <span aria-hidden="true" className="text-muted-foreground/40">/</span>
          <Link href="/whats-new" className="hover:text-foreground">产品更新</Link>
          <span aria-hidden="true" className="text-muted-foreground/40">/</span>
          <span className="text-foreground">{label}</span>
        </nav>

        <h1 className="mt-5 break-words text-[44px] font-bold leading-[1.14] tracking-[-0.02em] text-foreground sm:text-[48px] lg:text-[56px]">
          {label}
        </h1>
        <p className="mt-3 text-[15px] leading-7 text-muted-foreground">
          「{label}」分类下公开发布的产品更新与版本说明
        </p>

        <nav aria-label="更新分类" className="mt-6 flex flex-wrap items-center gap-2">
          <Link
            href="/whats-new"
            className="inline-flex h-9 items-center rounded-full border border-border bg-card px-4 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
          >
            全部更新
          </Link>
          {ANNOUNCEMENT_CATEGORIES.map((category) => (
            <Link
              key={category.slug}
              href={`/whats-new/category/${category.slug}`}
              className={
                category.slug === slug
                  ? 'inline-flex h-9 items-center rounded-full border border-foreground bg-foreground px-4 text-xs font-medium text-background'
                  : 'inline-flex h-9 items-center rounded-full border border-border bg-card px-4 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground'
              }
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
          <div className="mt-10 rounded-[20px] border border-border bg-card px-6 py-12 text-center">
            <p className="text-base font-medium text-foreground">该分类暂无公开更新记录</p>
            <p className="mt-1 text-sm text-muted-foreground">你可以返回查看全部更新，或浏览在线审片功能总览。</p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/whats-new"
                className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-xs font-medium text-foreground hover:bg-accent"
              >
                返回全部更新
              </Link>
              <Link
                href="/features"
                className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground hover:opacity-90"
              >
                查看功能总览
              </Link>
            </div>
          </div>
        )}

        <JsonLd
          value={{
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: BRAND.zh, item: site },
              { '@type': 'ListItem', position: 2, name: '产品更新', item: `${site}/whats-new` },
              { '@type': 'ListItem', position: 3, name: label, item: url },
            ],
          }}
        />
      </div>
    </div>
  )
}
