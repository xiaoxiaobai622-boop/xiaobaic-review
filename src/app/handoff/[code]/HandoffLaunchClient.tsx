'use client'

import { useEffect, useRef, useState } from 'react'
import Script from 'next/script'
import { useTranslations } from 'next-intl'
import { Smartphone } from 'lucide-react'
import { InitialsAvatar } from '@/components/InitialsAvatar'
import styles from '../../open/[code]/handoff.module.css'

// Public mini-program identity; the AppID/secret used for signing stay server-side.
const MINI_ORIGINAL_ID = 'gh_d8e227bc50e3'

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
  miniPath: string
  nonce?: string
}

export default function HandoffLaunchClient({
  code,
  projectTitle,
  protectedShare,
  ownerName,
  ownerAvatarUrl,
  miniPath,
  nonce,
}: HandoffLaunchClientProps) {
  const t = useTranslations('handoff')
  const slotRef = useRef<HTMLDivElement>(null)
  const configured = useRef(false)
  const [wxLoaded, setWxLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openLabel = t('openInMini')
  const title = protectedShare ? t('protectedTitle') : (projectTitle || t('title'))
  const fallbackUrl = `/${encodeURIComponent(code)}?web=1`

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
    slot.innerHTML = `<wx-open-launch-weapp username="${MINI_ORIGINAL_ID}" path="${escapeHtml(miniPath)}"><script type="text/wxtag-template"><style>.tag-button{box-sizing:border-box;display:flex;align-items:center;justify-content:center;width:100%;height:52px;border:0;border-radius:4px;background:#07C160;color:#FFFFFF;font-family:inherit;font-size:16px;font-weight:600}</style><button class="tag-button">${escapeHtml(openLabel)}</button></script></wx-open-launch-weapp>`
  }, [miniPath, openLabel])

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
        })
        wx.error((result) => {
          if (!cancelled) setError(result?.errMsg || '微信 JS-SDK 配置失败')
        })
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message)
      })

    return () => {
      cancelled = true
    }
  }, [wxLoaded])

  return (
    <div className={styles.page}>
      <Script
        src="https://res.wx.qq.com/open/js/jweixin-1.6.0.js"
        strategy="afterInteractive"
        nonce={nonce}
        onLoad={() => setWxLoaded(true)}
        onError={() => setError('微信 JS-SDK 加载失败')}
      />
      <div className={styles.card}>
        <span className={styles.icon}>
          <Smartphone aria-hidden="true" />
        </span>
        <h1 className={styles.title}>{title}</h1>
        {(ownerName || ownerAvatarUrl) && (
          <div className={styles.owner}>
            <InitialsAvatar
              name={ownerName || '?'}
              src={ownerAvatarUrl || null}
              size="sm"
              isInternal
              className={styles.ownerAvatar}
            />
            <span className={styles.ownerLabel}>{t('sharedBy')}</span>
            {ownerName && <span className={styles.ownerName}>{ownerName}</span>}
          </div>
        )}
        <div ref={slotRef} className={styles.slot} />
        {!error && <p className={styles.slotHint}>{t('weappHint')}</p>}
        {error && (
          <div className={styles.error}>
            <p className={styles.errorTitle}>{t('openFailed')}</p>
            <p className={styles.errorDetail}>{error}</p>
            <a className={styles.fallback} href={fallbackUrl}>{t('webFallback')}</a>
          </div>
        )}
      </div>
    </div>
  )
}
