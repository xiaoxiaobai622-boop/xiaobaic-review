'use client'

import { useEffect, useMemo, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { formatWhatsNewDay } from './WhatsNewCard'
import { sanitizeAnnouncementHtml } from '@/lib/announcements/rich-text'
import { isExternalUrl } from '@/lib/announcements/url'
import { cn } from '@/lib/utils'
import styles from './rich-text.module.css'

interface WhatsNewArticleProps {
  title: string
  content: string
  contentHtml?: string | null
  imageUrl?: string | null
  ctaLabel?: string | null
  ctaUrl?: string | null
  date?: string | Date | null
  /** 后台预览里 CTA 只做视觉还原，不跳转。 */
  interactive?: boolean
  className?: string
}

export default function WhatsNewArticle({
  title,
  content,
  contentHtml,
  imageUrl,
  ctaLabel,
  ctaUrl,
  date,
  interactive = true,
  className,
}: WhatsNewArticleProps) {
  const [coverFailed, setCoverFailed] = useState(false)
  const safeHtml = useMemo(() => sanitizeAnnouncementHtml(contentHtml), [contentHtml])
  const day = formatWhatsNewDay(date)
  const ctaText = ctaLabel?.trim() || '了解详情'

  useEffect(() => {
    setCoverFailed(false)
  }, [imageUrl])

  return (
    <article data-whats-new-article className={cn('min-w-0', className)}>
      {imageUrl ? (
        coverFailed ? (
          <div className="flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-xl border border-border bg-muted/40 text-muted-foreground">
            <ImageOff className="h-7 w-7" aria-hidden />
            <span className="text-xs">封面图无法加载</span>
          </div>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="aspect-video w-full rounded-xl bg-muted object-cover"
              onError={() => setCoverFailed(true)}
            />
          </>
        )
      ) : null}

      <header className={cn(imageUrl && 'mt-7')}>
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-primary">新增功能</p>
        <h1 className="mt-2 break-words text-2xl font-semibold leading-tight text-foreground sm:text-3xl">{title}</h1>
        {day ? <p className="mt-2 text-xs text-muted-foreground">{day}</p> : null}
      </header>

      <div className="mt-7">
        {safeHtml ? (
          <div className={styles.body} dangerouslySetInnerHTML={{ __html: safeHtml }} />
        ) : (
          <div className={cn(styles.body, 'whitespace-pre-wrap')}>{content}</div>
        )}
      </div>

      {ctaUrl ? (
        interactive ? (
          <a
            data-whats-new-article-cta
            href={ctaUrl}
            target={isExternalUrl(ctaUrl) ? '_blank' : undefined}
            rel={isExternalUrl(ctaUrl) ? 'noopener noreferrer' : undefined}
            className="mt-9 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {ctaText}
          </a>
        ) : (
          <span
            data-whats-new-article-cta
            className="mt-9 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            {ctaText}
          </span>
        )
      ) : null}
    </article>
  )
}