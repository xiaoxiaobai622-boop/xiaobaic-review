'use client'

import { useEffect, useRef, useState } from 'react'
import Script from 'next/script'
import { useTranslations } from 'next-intl'
import { BRAND } from '@/lib/marketing/brand'
import styles from './handoff-open.module.css'

// Public mini-program identity; the AppID/secret used for signing stay server-side.
const MINI_ORIGINAL_ID = 'gh_d8e227bc50e3'
const MINI_APP_ID = 'wxcbdd1a599d18af2b'

function reportOpenTag(stage: string, detail: string): void {
  try {
    const body = JSON.stringify({ stage, detail, page: window.location.pathname })
    const blob = new Blob([body], { type: 'application/json' })
    if (!navigator.sendBeacon?.('/api/wechat/js-sdk/report', blob)) {
      void fetch('/api/wechat/js-sdk/report', { method: 'POST', body, keepalive: true })
    }
  } catch {
    // Diagnostics only.
  }
}

interface WxConfigOptions {
  debug: boolean
  appId: string
  timestamp: number
  nonceStr: string
  signature: string
  jsApiList: string[]
  openTagList: string[]
}

interface Wx {
  config: (options: WxConfigOptions) => void
  ready: (callback: () => void) => void
  error: (callback: (result: { errMsg?: string }) => void) => void
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

interface HandoffLaunchClientProps {
  code: string
  projectTitle: string | null
  protectedShare: boolean
  ownerName: string
  ownerAvatarUrl: string
  shareDate: string
  miniPath: string
  nonce?: string
}

export default function HandoffLaunchClient({
  code,
  projectTitle,
  protectedShare,
  ownerName,
  ownerAvatarUrl,
  shareDate,
  miniPath,
  nonce,
}: HandoffLaunchClientProps) {
  const t = useTranslations('handoff')
  const slotRef = useRef<HTMLDivElement>(null)
  const configured = useRef(false)
  const [wxLoaded, setWxLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openTagsError, setOpenTagsError] = useState<string | null>(null)
  const [debugMode, setDebugMode] = useState(false)
  const [avatarFailed, setAvatarFailed] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)

  const openLabel = t('openInMini')
  const title = protectedShare ? t('protectedTitle') : (projectTitle || BRAND.zh)
  const owner = ownerName || BRAND.zh
  const initial = Array.from(owner)[0] || '逐'
  const dateLabel = shareDate ? shareDate.replace(/-/g, '/') : ''
  const meta = `${dateLabel}${t('sharedOn')} ${t('linkValid')}`.trim()
  const fallbackUrl = `/${encodeURIComponent(code)}?web=1`

  useEffect(() => {
    setDebugMode(new URLSearchParams(window.location.search).get('debug') === '1')
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined' && (window as unknown as { wx?: Wx }).wx) {
      setWxLoaded(true)
    }
  }, [])

  useEffect(() => {
    const slot = slotRef.current
    if (!slot) return
    // React must not manage this custom element; WeChat reads the template from
    // the injected HTML, so it is built once per path/label change.
    slot.innerHTML = `<wx-open-launch-weapp appid="${MINI_APP_ID}" username="${MINI_ORIGINAL_ID}" path="${escapeHtml(miniPath)}"><script type="text/wxtag-template"><style>.tag-button{box-sizing:border-box;display:flex;align-items:center;justify-content:center;width:100%;height:54px;border:0;border-radius:0;background:#07C160;color:#FFFFFF;font-family:inherit;font-size:16px;font-weight:600;letter-spacing:.01em}</style><button class="tag-button">${escapeHtml(openLabel)}</button></script></wx-open-launch-weapp>`

    const tag = slot.querySelector('wx-open-launch-weapp') as HTMLElement | null
    if (!tag) return
    const onLaunch = () => reportOpenTag('tag-launch', 'ok')
    const onError = (event: Event) => {
      const detail = (event as CustomEvent<{ errMsg?: string }>).detail?.errMsg || 'tag error'
      reportOpenTag('tag-error', detail)
    }
    tag.addEventListener('launch', onLaunch)
    tag.addEventListener('error', onError)
    return () => {
      tag.removeEventListener('launch', onLaunch)
      tag.removeEventListener('error', onError)
    }
  }, [miniPath, openLabel])

  useEffect(() => {
    const onOpenTagsError = (event: Event) => {
      const detail = (event as CustomEvent<{ errMsg?: string }>).detail?.errMsg || 'WeixinOpenTagsError'
      setOpenTagsError(detail)
      reportOpenTag('open-tags-error', detail)
    }
    document.addEventListener('WeixinOpenTagsError', onOpenTagsError)
    return () => document.removeEventListener('WeixinOpenTagsError', onOpenTagsError)
  }, [])

  useEffect(() => {
    if (!wxLoaded || configured.current) return
    let cancelled = false
    const wx = (window as unknown as { wx?: Wx }).wx
    if (!wx?.config) {
      setError('微信 JS-SDK 未加载')
      return
    }

    const pageUrl = window.location.href.split('#')[0]
    const debug = new URLSearchParams(window.location.search).get('debug') === '1'

    fetch(`/api/wechat/js-sdk?url=${encodeURIComponent(pageUrl)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`签名请求失败（${response.status}）`)
        return response.json() as Promise<{
          appId: string
          timestamp: number
          nonceStr: string
          signature: string
        }>
      })
      .then((sign) => {
        if (cancelled) return
        configured.current = true
        wx.config({
          debug,
          appId: sign.appId,
          timestamp: sign.timestamp,
          nonceStr: sign.nonceStr,
          signature: sign.signature,
          jsApiList: [],
          openTagList: ['wx-open-launch-weapp'],
        })
        wx.ready(() => {
          if (!cancelled) setError(null)
          window.setTimeout(() => {
            const tag = slotRef.current?.querySelector('wx-open-launch-weapp') as HTMLElement | null
            const defined = Boolean(window.customElements?.get('wx-open-launch-weapp'))
            const height = tag ? Math.round(tag.getBoundingClientRect().height) : -1
            reportOpenTag(
              'tag-state',
              `defined=${defined} height=${height} shadow=${Boolean(tag?.shadowRoot)}`,
            )
          }, 2000)
        })
        wx.error((result) => {
          if (!cancelled) setError(result?.errMsg || '微信 JS-SDK 配置失败')
          reportOpenTag('config-error', result?.errMsg || 'config failed')
        })
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message)
        reportOpenTag('config-error', reason.message)
      })

    return () => {
      cancelled = true
    }
  }, [wxLoaded])

  async function launchViaUrlLink() {
    if (launching) return
    setLaunching(true)
    setLaunchError(null)
    try {
      const response = await fetch('/api/wechat/mini/launch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, owner: ownerName, avatar: ownerAvatarUrl, date: shareDate }),
      })
      const data = await response.json().catch(() => null) as { urlLink?: unknown } | null
      if (!response.ok || typeof data?.urlLink !== 'string') {
        throw new Error(`launch failed (${response.status})`)
      }
      window.location.assign(data.urlLink)
    } catch {
      setLaunching(false)
      setLaunchError(t('openFailed'))
    }
  }

  return (
    <div className={styles.shell}>
      <Script
        src="https://res.wx.qq.com/open/js/jweixin-1.6.0.js"
        strategy="afterInteractive"
        nonce={nonce}
        onLoad={() => setWxLoaded(true)}
        onError={() => {
          setError('微信 JS-SDK 加载失败')
          reportOpenTag('config-error', 'jweixin load failed')
        }}
      />
      <main className={styles.page}>
        <h1 className={styles.title}>{title}</h1>

        <div className={styles.owner}>
          <div className={styles.avatar}>
            {ownerAvatarUrl && !avatarFailed ? (
              <img
                className={styles.avatarImg}
                src={ownerAvatarUrl}
                alt=""
                onError={() => setAvatarFailed(true)}
              />
            ) : (
              <span>{initial}</span>
            )}
          </div>
          <div className={styles.ownerCopy}>
            <div className={styles.ownerName}>{owner}</div>
            <div className={styles.ownerMeta}>{meta}</div>
          </div>
        </div>

        <div className={styles.divider} aria-hidden="true" />

        <div className={styles.preview} aria-hidden="true">
          <img className={styles.previewLogo} src="/brand/logo-192.png" alt="" />
          <div className={styles.previewFoot}>{BRAND.zh}</div>
        </div>

        <div className={styles.launchWrap}>
          <button
            type="button"
            className={styles.launchButton}
            onClick={launchViaUrlLink}
            disabled={launching}
          >
            {launching ? t('opening') : openLabel}
          </button>
          <div ref={slotRef} className={styles.launchSlot} />
        </div>

        {launchError && (
          <p className={styles.error}>
            {launchError}{' '}
            <a className={styles.errorLink} href={fallbackUrl}>{t('webFallback')}</a>
          </p>
        )}
        {debugMode && (error || openTagsError) && (
          <p className={styles.error}>{[error, openTagsError].filter(Boolean).join(' · ')}</p>
        )}
        <p className={styles.hint}>{t('appHint')}</p>
      </main>
    </div>
  )
}
