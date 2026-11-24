'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Check, ImageOff, Link2, Loader2, Mail, MessageCircle, Send } from 'lucide-react'
import BrandLogo from '@/components/BrandLogo'
import { formatWhatsNewDay } from '@/components/announcements/WhatsNewCard'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api-client'
import { markAnnouncementsRead } from '@/lib/announcement-feed-store'
import {
  announcementCategoriesForDisplay,
  type AnnouncementCategorySlug,
} from '@/lib/announcements/categories'
import { sanitizeAnnouncementHtml } from '@/lib/announcements/rich-text'
import { isExternalUrl } from '@/lib/announcements/url'
import {
  WHATS_NEW_READ_EVENT,
  type WhatsNewReadEventDetail,
} from '@/lib/announcements/whats-new-events'
import { BRAND } from '@/lib/marketing/brand'
import { cn } from '@/lib/utils'
import styles from '@/components/announcements/rich-text.module.css'

interface ArticleAuthor {
  name: string
  avatarUrl: string | null
}

interface ArticleItem {
  id: string
  title: string
  content: string
  contentHtml: string | null
  imageUrl: string | null
  ctaLabel: string | null
  ctaUrl: string | null
  publishedAt: string | null
  createdAt: string
  updatedAt?: string
  readAt: string | null
  author?: ArticleAuthor
  readingMinutes?: number
  categories?: Array<{ slug: AnnouncementCategorySlug; label: string }>
}

const SHARE_ICON_CLASS = 'inline-flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full border border-border bg-transparent text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

type ViewState = 'loading' | 'ready' | 'notfound' | 'error'

function fallbackCopy(text: string): boolean {
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(textarea)
    return copied
  } catch {
    return false
  }
}

export default function WhatsNewArticlePage() {
  const params = useParams()
  const id = Array.isArray(params?.id) ? params.id[0] : String(params?.id || '')
  const [item, setItem] = useState<ArticleItem | null>(null)
  const [view, setView] = useState<ViewState>('loading')
  const [coverFailed, setCoverFailed] = useState(false)
  const [pageUrl, setPageUrl] = useState('')
  const [shareNotice, setShareNotice] = useState<string | null>(null)
  const markedRef = useRef(false)
  const previousTitleRef = useRef<string | null>(null)
  const shareTimerRef = useRef<number | null>(null)

  const load = useCallback(async () => {
    if (!id) {
      setView('notfound')
      return
    }
    setView('loading')
    try {
      const response = await apiFetch(`/api/announcements/${encodeURIComponent(id)}`, { cache: 'no-store' })
      if (response.status === 404) {
        setView('notfound')
        return
      }
      if (!response.ok) throw new Error(String(response.status))
      const data = await response.json() as { item?: ArticleItem }
      if (!data.item) {
        setView('notfound')
        return
      }
      setItem(data.item)
      setView('ready')
      if (!data.item.readAt && !markedRef.current) {
        markedRef.current = true
        const marked = await markAnnouncementsRead([data.item.id])
        if (marked) {
          window.dispatchEvent(new CustomEvent<WhatsNewReadEventDetail>(WHATS_NEW_READ_EVENT, {
            detail: { ids: [data.item.id] },
          }))
        }
      }
    } catch {
      setView('error')
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setCoverFailed(false)
  }, [item?.imageUrl])

  useEffect(() => {
    if (view !== 'ready' || !item) return
    setPageUrl(window.location.href)
    previousTitleRef.current = document.title
    document.title = `${BRAND.zh} · 新增功能 · ${item.title}`
    return () => {
      if (previousTitleRef.current !== null) document.title = previousTitleRef.current
    }
  }, [item, view])

  useEffect(() => () => {
    if (shareTimerRef.current !== null) window.clearTimeout(shareTimerRef.current)
  }, [])

  const safeHtml = useMemo(() => sanitizeAnnouncementHtml(item?.contentHtml), [item?.contentHtml])
  const author = item?.author ?? { name: '逐帧审阅团队', avatarUrl: null }
  const categories = item?.categories?.length ? item.categories : announcementCategoriesForDisplay([])
  const publishedDay = item ? formatWhatsNewDay(item.publishedAt ?? item.createdAt) : ''
  const updatedDay = item?.updatedAt ? formatWhatsNewDay(item.updatedAt) : publishedDay
  const readingMinutes = Math.max(1, item?.readingMinutes ?? 1)
  const ctaHref = item?.ctaUrl?.trim() || '/studio/projects'
  const ctaText = item?.ctaUrl?.trim()
    ? item.ctaLabel?.trim() || '了解详情'
    : '进入工作台'
  const ctaExternal = Boolean(item?.ctaUrl) && isExternalUrl(ctaHref)
  const weiboHref = pageUrl
    ? `https://service.weibo.com/share/share.php?url=${encodeURIComponent(pageUrl)}&title=${encodeURIComponent(item?.title || '')}`
    : null
  const mailHref = pageUrl && item
    ? `mailto:?subject=${encodeURIComponent(item.title)}&body=${encodeURIComponent(pageUrl)}`
    : null

  const showShareNotice = (message: string) => {
    setShareNotice(message)
    if (shareTimerRef.current !== null) window.clearTimeout(shareTimerRef.current)
    shareTimerRef.current = window.setTimeout(() => setShareNotice(null), 2600)
  }

  const copyLink = async (kind: 'link' | 'wechat') => {
    const url = window.location.href
    let ok = false
    try {
      await navigator.clipboard.writeText(url)
      ok = true
    } catch {
      ok = fallbackCopy(url)
    }
    if (!ok) {
      showShareNotice('复制失败，请手动复制地址栏链接')
      return
    }
    showShareNotice(kind === 'wechat' ? '链接已复制，可在微信粘贴分享' : '链接已复制')
  }

  return (
    <div className="wrap bg-white pb-10 dark:bg-background lg:pb-12">
      <div className="wrap-inner mx-auto w-full max-w-[1200px] px-0 pt-0 sm:px-[25px] sm:pt-[25px]">
        {view === 'loading' ? (
          <div className="flex flex-col gap-8">
            <div className="aspect-video w-full animate-pulse rounded-[20px] bg-muted/60" />
            <div className="mx-auto w-full max-w-[800px] px-5 sm:px-0">
              <div className="h-4 w-40 animate-pulse rounded bg-muted/60" />
              <div className="mt-6 h-12 w-4/5 animate-pulse rounded bg-muted" />
              <div className="mt-4 h-5 w-56 animate-pulse rounded bg-muted/60" />
              <div className="mt-10 flex flex-col gap-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="h-5 animate-pulse rounded bg-muted/50" />
                ))}
              </div>
            </div>
          </div>
        ) : view === 'notfound' ? (
          <div className="mx-auto w-full max-w-[800px] px-5 py-10 sm:px-0">
            <div className="rounded-[20px] border border-border bg-card px-6 py-12 text-center">
              <p className="text-lg font-medium text-foreground">这篇新增功能不存在或你没有访问权限</p>
              <p className="mt-2 text-sm text-muted-foreground">请从工作台「新增功能」重新打开。</p>
              <Button asChild size="sm" className="mt-5 h-9 px-4 text-xs">
                <Link href="/studio/projects">进入工作台</Link>
              </Button>
            </div>
          </div>
        ) : view === 'error' ? (
          <div className="mx-auto w-full max-w-[800px] px-5 py-10 sm:px-0">
            <div className="rounded-[20px] border border-destructive/30 bg-destructive-visible px-6 py-10 text-center">
              <p className="text-sm text-destructive">新增功能读取失败，请稍后重试。</p>
              <Button type="button" size="sm" className="mt-4 h-9 px-4 text-xs" onClick={() => void load()}>
                重试
              </Button>
            </div>
          </div>
        ) : item ? (
          <div className="site-main">
            <div className="content-area the-post">
              <article
                data-whats-new-article
                className="post article has-avatar has-author has-date has-category-meta has-tfm-read-time has-post-thumbnail"
              >
                <div className="post-inner">
                  {item.imageUrl ? (
                    <div data-article-hero className="thumbnail-wrapper">
                      <figure className="post-thumbnail m-0 overflow-hidden rounded-none bg-muted sm:rounded-[20px]">
                        {coverFailed ? (
                          <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 text-muted-foreground">
                            <ImageOff className="h-8 w-8" aria-hidden />
                            <span className="text-sm">封面图无法加载</span>
                          </div>
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.imageUrl}
                            alt=""
                            loading="eager"
                            decoding="async"
                            className="aspect-video w-full bg-muted object-cover"
                            onError={() => setCoverFailed(true)}
                          />
                        )}
                      </figure>
                    </div>
                  ) : null}

                  <div className="entry-wrapper mx-auto mt-8 w-full max-w-[800px] px-[25px] sm:px-0">
                    <header className="entry-header">
                      <div className="entry-meta before-title">
                        <ul
                          data-article-categories
                          aria-label="文章分类"
                          className="post-categories-meta flex flex-wrap items-center gap-x-1.5 text-[14px] leading-[21px] text-foreground"
                        >
                          {categories.map((category, index) => (
                            <li key={category.slug} className={`cat-slug-${category.slug} inline-flex items-center gap-x-1.5`}>
                              <Link
                                href={`/whats-new/category/${category.slug}`}
                                className="cat-link rounded-sm transition-colors hover:text-primary hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                {category.label}
                              </Link>
                              {index < categories.length - 1 ? <span aria-hidden="true">,</span> : null}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <h1 className="entry-title mt-5 break-words text-[44px] font-bold leading-[1.14] tracking-[-0.02em] text-foreground sm:text-[48px] lg:text-[56px]">
                        {item.title}
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
                            <p className="entry-meta-author text-[14px] font-normal leading-[21px] text-foreground">{author.name}</p>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[14px] leading-[21px] text-muted-foreground">
                              <span className="entry-meta-date whitespace-nowrap">{publishedDay} 发布</span>
                              <span aria-hidden="true">·</span>
                              <span className="entry-meta-date-updated whitespace-nowrap">更新于 {updatedDay}</span>
                              <span aria-hidden="true">·</span>
                              <span className="entry-meta-read-time whitespace-nowrap">{readingMinutes} 分钟阅读</span>
                            </div>
                          </li>
                        </ul>

                        <div data-article-share className="tfm-share-wrapper top-bottom mt-5">
                          <div className="tfm-share">
                            <ul className="tfm-social-icons flex flex-nowrap items-center gap-2">
                              <li className="share-text whitespace-nowrap text-[14px] leading-[21px] text-muted-foreground">
                                分享<span className="share-this-text ml-1">本文</span>
                              </li>
                              <li className="tfm-social-icon">
                                <button
                                  type="button"
                                  onClick={() => void copyLink('link')}
                                  aria-label="复制链接"
                                  title="复制链接"
                                  className={SHARE_ICON_CLASS}
                                >
                                  {shareNotice === '链接已复制' ? <Check className="h-[18px] w-[18px]" aria-hidden /> : <Link2 className="h-[18px] w-[18px]" aria-hidden />}
                                </button>
                              </li>
                              <li className="tfm-social-icon">
                                <button
                                  type="button"
                                  onClick={() => void copyLink('wechat')}
                                  aria-label="分享到微信"
                                  title="分享到微信"
                                  className={SHARE_ICON_CLASS}
                                >
                                  <MessageCircle className="h-[18px] w-[18px]" aria-hidden />
                                </button>
                              </li>
                              {weiboHref ? (
                                <li className="tfm-social-icon">
                                  <a
                                    href={weiboHref}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label="分享到微博"
                                    title="分享到微博"
                                    className={SHARE_ICON_CLASS}
                                  >
                                    <Send className="h-[18px] w-[18px]" aria-hidden />
                                  </a>
                                </li>
                              ) : null}
                              {mailHref ? (
                                <li className="tfm-social-icon">
                                  <a
                                    href={mailHref}
                                    aria-label="邮件分享"
                                    title="邮件分享"
                                    className={SHARE_ICON_CLASS}
                                  >
                                    <Mail className="h-[18px] w-[18px]" aria-hidden />
                                  </a>
                                </li>
                              ) : null}
                            </ul>
                          </div>
                        </div>
                        {shareNotice ? (
                          <p aria-live="polite" className="mt-3 text-xs text-muted-foreground">{shareNotice}</p>
                        ) : null}
                      </div>
                    </header>

                    <div data-article-body className="single-content-wrapper mt-10">
                      <div className="entry-content">
                        {safeHtml ? (
                          <div className={cn(styles.body, styles.articleBody)} dangerouslySetInnerHTML={{ __html: safeHtml }} />
                        ) : (
                          <div className={cn(styles.body, styles.articleBody, 'whitespace-pre-wrap')}>{item.content}</div>
                        )}
                      </div>
                    </div>

                    <footer className="hentry-footer mt-12">
                      <a
                        data-whats-new-article-cta
                        href={ctaHref}
                        target={ctaExternal ? '_blank' : undefined}
                        rel={ctaExternal ? 'noopener noreferrer' : undefined}
                        className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        {ctaText}
                      </a>
                    </footer>
                  </div>
                </div>
              </article>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}