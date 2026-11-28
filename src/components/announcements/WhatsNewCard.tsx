'use client'

import { useEffect, useRef, useState } from 'react'
import { ImageOff, Loader2 } from 'lucide-react'
import { whatsNewCardSummary } from '@/lib/announcements/card-summary'
import { formatWhatsNewDay } from '@/lib/announcements/time'
import { isExternalUrl } from '@/lib/announcements/url'
import { cn } from '@/lib/utils'

function CardCover({
  src,
  title,
  href,
  priority,
}: {
  src: string
  title: string
  href?: string | null
  priority?: boolean
}) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  const imageRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    setStatus('loading')
    const image = imageRef.current
    if (image?.complete) setStatus(image.naturalWidth > 0 ? 'loaded' : 'error')
  }, [src])

  const cover = (
    <div className="relative aspect-video w-full overflow-hidden rounded-[12px] bg-muted">
      {status !== 'loaded' ? (
        <div
          data-whats-new-image-fallback={status === 'error' ? 'true' : undefined}
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted-foreground"
        >
          {status === 'error' ? (
            <>
              <ImageOff className="h-6 w-6" aria-hidden />
              <span className="text-[11px]">封面加载失败</span>
            </>
          ) : (
            <Loader2 className="h-5 w-5 animate-spin opacity-50" aria-hidden />
          )}
        </div>
      ) : null}
      {status !== 'error' ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imageRef}
            src={src}
            alt=""
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            className={cn(
              'absolute inset-0 h-full w-full object-cover transition-opacity duration-200',
              status === 'loaded' ? 'opacity-100' : 'opacity-0',
            )}
            onLoad={() => setStatus('loaded')}
            onError={() => setStatus('error')}
          />
        </>
      ) : null}
    </div>
  )

  if (!href) return cover
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-whats-new-cover-link
      aria-label={`打开文章：${title}`}
      className="block rounded-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {cover}
    </a>
  )
}

interface WhatsNewCardProps {
  title: string
  content: string
  imageUrl?: string | null
  ctaLabel?: string | null
  ctaUrl?: string | null
  date?: string | Date | null
  className?: string
  /** 前台卡片的图片/标题/正文进入文章；后台预览不传。 */
  articleHref?: string | null
  /** 后台预览里 CTA 只做视觉还原，不跳转。 */
  interactive?: boolean
  /** 发布确认里的缩略卡：标题/正文截断，图片与 CTA 仍按线上样式。 */
  compact?: boolean
  /** 首张卡立即加载封面，其余懒加载。 */
  priority?: boolean
}

export default function WhatsNewCard({
  title,
  content,
  imageUrl,
  ctaLabel,
  ctaUrl,
  date,
  className,
  articleHref,
  interactive = true,
  compact = false,
  priority = false,
}: WhatsNewCardProps) {
  const hasImage = Boolean(imageUrl)
  const summary = whatsNewCardSummary(content)
  const day = formatWhatsNewDay(date)
  const externalCta = ctaUrl?.trim() || null
  const ctaHref = externalCta || articleHref || null
  const ctaText = ctaLabel?.trim() || '了解详情'
  const ctaOpensNewTab = Boolean(ctaHref) && (ctaHref === articleHref || isExternalUrl(ctaHref))
  const showCta = Boolean(ctaHref) || !interactive
  const linked = Boolean(articleHref) && interactive

  return (
    <article
      data-whats-new-card
      className={cn(
        'group min-w-0 rounded-xl px-2 pb-1.5 transition-colors hover:bg-accent/60',
        className,
      )}
    >
      {hasImage ? (
        <CardCover
          src={imageUrl as string}
          title={title}
          href={articleHref}
          priority={priority}
        />
      ) : null}

      <h3
        className={cn(
          'break-words font-semibold leading-[1.35] text-foreground',
          hasImage && 'mt-1.5',
          compact ? 'line-clamp-2 text-[15px]' : 'line-clamp-2 text-[16px]',
        )}
      >
        {linked ? (
          <a
            href={articleHref as string}
            target="_blank"
            rel="noopener noreferrer"
            data-whats-new-article-link
            className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {title}
          </a>
        ) : title}
      </h3>

      <p
        className={cn(
          'mt-1 break-words text-muted-foreground',
          compact ? 'text-[13px] leading-5' : 'text-[14px] leading-[1.6]',
        )}
      >
        {linked ? (
          <a
            href={articleHref as string}
            target="_blank"
            rel="noopener noreferrer"
            data-whats-new-summary-link
            className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {summary}
          </a>
        ) : (
          summary
        )}
        {showCta ? (
          <>
            {' '}
            {interactive && ctaHref ? (
              <a
                data-whats-new-cta
                href={ctaHref}
                target={ctaOpensNewTab ? '_blank' : undefined}
                rel={ctaOpensNewTab ? 'noopener noreferrer' : undefined}
                className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {ctaText}
              </a>
            ) : (
              <span data-whats-new-cta className="font-medium text-primary underline-offset-2">
                {ctaText}
              </span>
            )}
          </>
        ) : null}
      </p>

      {day ? (
        <p className={cn('mt-1.5 text-[12px] text-muted-foreground', compact && 'mt-1 text-[11px]')}>{day}</p>
      ) : null}
    </article>
  )
}