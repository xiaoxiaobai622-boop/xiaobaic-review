'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Smartphone } from 'lucide-react'
import { isDesktopUserAgent } from '@/lib/share-handoff'
import styles from './handoff.module.css'

type Env = 'desktop' | 'wechat' | 'mobile'
type LaunchStatus = 'idle' | 'launching' | 'error'

function detectEnv(userAgent: string): Env {
  if (isDesktopUserAgent(userAgent)) return 'desktop'
  if (/MicroMessenger/i.test(userAgent)) return 'wechat'
  return 'mobile'
}

interface HandoffClientProps {
  code: string
  projectTitle: string | null
  protectedShare: boolean
}

export default function HandoffClient({ code, projectTitle, protectedShare }: HandoffClientProps) {
  const t = useTranslations('handoff')
  const [env, setEnv] = useState<Env | null>(null)
  const [status, setStatus] = useState<LaunchStatus>('idle')
  const [qrFailed, setQrFailed] = useState(false)
  const autoStarted = useRef(false)

  const launch = useCallback(async () => {
    setStatus('launching')
    try {
      const response = await fetch('/api/wechat/mini/launch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const data = await response.json().catch(() => null) as { urlLink?: unknown } | null
      if (!response.ok || typeof data?.urlLink !== 'string') throw new Error('launch failed')
      window.location.assign(data.urlLink)
    } catch {
      setStatus('error')
    }
  }, [code])

  useEffect(() => {
    setEnv(detectEnv(navigator.userAgent))
  }, [])

  useEffect(() => {
    if (!env || autoStarted.current) return
    autoStarted.current = true
    if (env !== 'desktop') void launch()
  }, [env, launch])

  const title = protectedShare ? t('protectedTitle') : (projectTitle || t('title'))
  const showFallback = env === 'desktop' || status === 'error'
  const hint = protectedShare
    ? t('protectedNotice')
    : env === 'desktop'
      ? t('desktopHint')
      : status === 'error'
        ? t('failed')
        : status === 'launching'
          ? t('launching')
          : t('autoHint')

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <span className={styles.icon}>
          <Smartphone aria-hidden="true" />
        </span>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.hint}>{env ? hint : t('launching')}</p>

        {showFallback && (
          <>
            <button
              type="button"
              className={styles.button}
              onClick={() => { void launch() }}
              disabled={status === 'launching'}
            >
              {status === 'launching' ? t('opening') : t('openMini')}
            </button>
            {!qrFailed && (
              <>
                <div className={styles.qr}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/wechat/mini/review-code?code=${encodeURIComponent(code)}`}
                    alt={t('qrAlt')}
                    width={200}
                    height={200}
                    onError={() => setQrFailed(true)}
                  />
                </div>
                <p className={styles.scanHint}>{t('scanHint')}</p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
