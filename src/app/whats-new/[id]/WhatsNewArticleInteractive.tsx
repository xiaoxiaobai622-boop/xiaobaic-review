'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ImageOff, Link2, Mail, MessageCircle, Send } from 'lucide-react'
import { markAnnouncementsRead } from '@/lib/announcement-feed-store'
import {
  WHATS_NEW_READ_EVENT,
  type WhatsNewReadEventDetail,
} from '@/lib/announcements/whats-new-events'
import { getAccessToken, getRefreshToken } from '@/lib/token-store'

const SHARE_ICON_CLASS =
  'inline-flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full border border-border bg-transparent text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

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

export function WhatsNewCoverImage({ src, title }: { src: string; title: string }) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [src])

  return (
    <div data-article-hero className="thumbnail-wrapper">
      <figure className="post-thumbnail m-0 overflow-hidden rounded-none bg-muted sm:rounded-[20px]">
        {failed ? (
          <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <ImageOff className="h-8 w-8" aria-hidden />
            <span className="text-sm">封面图无法加载</span>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={title}
            loading="eager"
            decoding="async"
            className="aspect-video w-full bg-muted object-cover"
            onError={() => setFailed(true)}
          />
        )}
      </figure>
    </div>
  )
}

export function WhatsNewShareActions({
  articleId,
  title,
  shareUrl,
}: {
  articleId: string
  title: string
  shareUrl: string
}) {
  const [shareNotice, setShareNotice] = useState<string | null>(null)
  const shareTimerRef = useRef<number | null>(null)
  const markedRef = useRef(false)

  // Only sync read state when the visitor actually holds an authenticated token.
  useEffect(() => {
    if (markedRef.current) return
    if (!getAccessToken() && !getRefreshToken()) return
    markedRef.current = true
    void markAnnouncementsRead([articleId]).then((marked) => {
      if (marked) {
        window.dispatchEvent(
          new CustomEvent<WhatsNewReadEventDetail>(WHATS_NEW_READ_EVENT, {
            detail: { ids: [articleId] },
          }),
        )
      }
    })
  }, [articleId])

  useEffect(
    () => () => {
      if (shareTimerRef.current !== null) window.clearTimeout(shareTimerRef.current)
    },
    [],
  )

  const showShareNotice = (message: string) => {
    setShareNotice(message)
    if (shareTimerRef.current !== null) window.clearTimeout(shareTimerRef.current)
    shareTimerRef.current = window.setTimeout(() => setShareNotice(null), 2600)
  }

  const copyLink = async (kind: 'link' | 'wechat') => {
    const url = typeof window !== 'undefined' ? window.location.href : shareUrl
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

  const weiboHref = `https://service.weibo.com/share/share.php?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(title)}`
  const mailHref = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(shareUrl)}`

  return (
    <>
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
                {shareNotice === '链接已复制' ? (
                  <Check className="h-[18px] w-[18px]" aria-hidden />
                ) : (
                  <Link2 className="h-[18px] w-[18px]" aria-hidden />
                )}
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
          </ul>
        </div>
      </div>
      {shareNotice ? (
        <p aria-live="polite" className="mt-3 text-xs text-muted-foreground">
          {shareNotice}
        </p>
      ) : null}
    </>
  )
}
