import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import BrandLogo from '@/components/BrandLogo'
import { JsonLd } from '@/components/marketing/JsonLd'
import {
  getPublicReleaseArticle,
  hasStudioOnlyReleaseArticle,
} from '@/lib/announcements/public-whats-new'
import { formatWhatsNewDay } from '@/lib/announcements/time'
import { isExternalUrl } from '@/lib/announcements/url'
import { BRAND } from '@/lib/marketing/brand'
import { getSiteUrlFromRequest } from '@/lib/marketing/site-url'
import { cn } from '@/lib/utils'
import styles from '@/components/announcements/rich-text.module.css'
import { WhatsNewCoverImage, WhatsNewShareActions } from './WhatsNewArticleInteractive'
import WhatsNewPrivateArticleClient from './WhatsNewPrivateArticleClient'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const [site, article] = await Promise.all([
    getSiteUrlFromRequest(),
    getPublicReleaseArticle(id),
  ])

  if (!article) {
    return {
      title: '产品更新',
      robots: { index: false, follow: false },
    }
  }

  const url = `${site}/whats-new/${article.id}`
  const description = article.summary || `${article.title}：${BRAND.zh}产品更新与版本说明。`
  const ogImage = article.imageUrl
    ? article.imageUrl.startsWith('http')
      ? article.imageUrl
      : `${site}${article.imageUrl}`
    : `${site}/og/brand-1200x630.png`

  return {
    metadataBase: new URL(site),
    title: article.title,
    description,
    keywords: [...BRAND.keywords],
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      siteName: BRAND.zh,
      locale: 'zh_CN',
      title: article.title,
      description,
      url,
      publishedTime: article.publishedAt.toISOString(),
      modifiedTime: article.updatedAt.toISOString(),
      images: [{ url: ogImage, alt: article.title }],
    },
    robots: { index: true, follow: true },
  }
}

export default async function WhatsNewArticlePage({ params }: Props) {
  const { id } = await params
  const [site, article] = await Promise.all([
    getSiteUrlFromRequest(),
    getPublicReleaseArticle(id),
  ])

  if (!article) {
    const isStudioOnly = await hasStudioOnlyReleaseArticle(id)
    if (isStudioOnly) {
      return <WhatsNewPrivateArticleClient id={id} />
    }
    notFound()
  }

  const url = `${site}/whats-new/${article.id}`
  const publishedDay = formatWhatsNewDay(article.publishedAt)
  const updatedDay = formatWhatsNewDay(article.updatedAt) || publishedDay
  const ctaHref = article.ctaUrl?.trim() || '/studio/projects'
  const ctaText = article.ctaUrl?.trim() ? article.ctaLabel?.trim() || '了解详情' : '进入工作台'
  const ctaExternal = Boolean(article.ctaUrl) && isExternalUrl(ctaHref)

  return (
    <div className="wrap bg-white pb-10 dark:bg-background lg:pb-12">
      <div className="wrap-inner mx-auto w-full max-w-[1200px] px-0 pt-0 sm:px-[25px] sm:pt-[25px]">
        <div className="site-main">
          <div className="content-area the-post">
            <article
              data-whats-new-article
              className="post article has-avatar has-author has-date has-category-meta has-tfm-read-time has-post-thumbnail"
            >
              <div className="post-inner">
                {article.imageUrl ? (
                  <WhatsNewCoverImage src={article.imageUrl} title={article.title} />
                ) : null}

                <div className="entry-wrapper mx-auto mt-8 w-full max-w-[800px] px-[25px] sm:px-0">
                  <header className="entry-header">
                    <div className="entry-meta before-title">
                      <ul
                        data-article-categories
                        aria-label="文章分类"
                        className="post-categories-meta flex flex-wrap items-center gap-x-1.5 text-[14px] leading-[21px] text-foreground"
                      >
                        <li className="inline-flex items-center gap-x-1.5 text-muted-foreground">
                          <Link href="/whats-new" className="hover:text-foreground">
                            产品更新
                          </Link>
                          <span aria-hidden="true">/</span>
                        </li>
                        {article.categories.map((category, index) => (
                          <li
                            key={category.slug}
                            className={`cat-slug-${category.slug} inline-flex items-center gap-x-1.5`}
                          >
                            <Link
                              href={`/whats-new/category/${category.slug}`}
                              className="cat-link rounded-sm transition-colors hover:text-primary hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {category.label}
                            </Link>
                            {index < article.categories.length - 1 ? <span aria-hidden="true">,</span> : null}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <h1 className="entry-title mt-5 break-words text-[44px] font-bold leading-[1.14] tracking-[-0.02em] text-foreground sm:text-[48px] lg:text-[56px]">
                      {article.title}
                    </h1>

                    <div className="entry-meta after-title mt-8">
                      <ul data-article-author className="after-title-meta flex items-center gap-3">
                        <li className="entry-meta-avatar shrink-0">
                          <span
                            data-article-author-avatar
                            className="flex h-[40px] w-[40px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ring-1 ring-border dark:bg-primary/15"
                          >
                            <BrandLogo height={24} ariaHidden alt="" />
                          </span>
                        </li>
                        <li className="min-w-0">
                          <p className="entry-meta-author text-[14px] font-normal leading-[21px] text-foreground">
                            {article.authorName}
                          </p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[14px] leading-[21px] text-muted-foreground">
                            <span className="entry-meta-date whitespace-nowrap">{publishedDay} 发布</span>
                            <span aria-hidden="true">·</span>
                            <span className="entry-meta-date-updated whitespace-nowrap">更新于 {updatedDay}</span>
                            <span aria-hidden="true">·</span>
                            <span className="entry-meta-read-time whitespace-nowrap">{article.readingMinutes} 分钟阅读</span>
                          </div>
                        </li>
                      </ul>

                      <WhatsNewShareActions
                        articleId={article.id}
                        title={article.title}
                        shareUrl={url}
                      />
                    </div>
                  </header>

                  <div data-article-body className="single-content-wrapper mt-10">
                    <div className="entry-content">
                      {article.safeHtml ? (
                        <div
                          className={cn(styles.body, styles.articleBody)}
                          dangerouslySetInnerHTML={{ __html: article.safeHtml }}
                        />
                      ) : (
                        <div className={cn(styles.body, styles.articleBody, 'whitespace-pre-wrap')}>
                          {article.content}
                        </div>
                      )}
                    </div>
                  </div>

                  <footer className="hentry-footer mt-12 flex flex-wrap items-center gap-4">
                    <a
                      data-whats-new-article-cta
                      href={ctaHref}
                      target={ctaExternal ? '_blank' : undefined}
                      rel={ctaExternal ? 'noopener noreferrer' : undefined}
                      className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {ctaText}
                    </a>
                    <Link
                      href="/whats-new"
                      className="inline-flex h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                    >
                      返回全部更新
                    </Link>
                  </footer>
                </div>
              </div>
            </article>
          </div>
        </div>
      </div>

      <JsonLd
        value={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          '@id': `${url}#article`,
          headline: article.title,
          name: article.title,
          description: article.summary || article.title,
          inLanguage: 'zh-CN',
          datePublished: article.publishedAt.toISOString(),
          dateModified: article.updatedAt.toISOString(),
          author: { '@id': `${site}/#organization` },
          publisher: { '@id': `${site}/#organization` },
          mainEntityOfPage: { '@type': 'WebPage', '@id': url },
          about: { '@id': `${site}/#software` },
          image: article.imageUrl
            ? article.imageUrl.startsWith('http')
              ? article.imageUrl
              : `${site}${article.imageUrl}`
            : `${site}/og/brand-1200x630.png`,
          url,
        }}
      />
      <JsonLd
        value={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: BRAND.zh, item: site },
            { '@type': 'ListItem', position: 2, name: '产品更新', item: `${site}/whats-new` },
            { '@type': 'ListItem', position: 3, name: article.title, item: url },
          ],
        }}
      />
    </div>
  )
}
