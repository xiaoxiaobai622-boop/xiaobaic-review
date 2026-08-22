'use client'

import Link from 'next/link'
import Image from 'next/image'
import { Layers3, MessageSquareText, UploadCloud } from 'lucide-react'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import styles from './home.module.css'

const scenes = [
  { src: 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260307_083826_e938b29f-a43a-41ec-a153-3d4730578ab8.mp4', label: 'Neuralyn' },
]

const capabilities = [
  { icon: MessageSquareText, title: '逐帧审片', detail: '意见准确落在画面与时间点' },
  { icon: Layers3, title: '版本管理', detail: '每次修改都有清晰的版本记录' },
  { icon: UploadCloud, title: '素材收录', detail: '视频通过链接直接回传文件' },
]

export default function HomeClient() {
  const [activeScene, setActiveScene] = useState(0)
  const [heroVideoFailed, setHeroVideoFailed] = useState(false)
  const [user, setUser] = useState<{ id: string; name?: string | null; email?: string; phone?: string | null } | null>(null)
  const [authChecked, setAuthChecked] = useState(false)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveScene((current) => (current + 1) % scenes.length)
    }, 8000)
    let cancelled = false
    apiFetch('/api/auth/session', { cache: 'no-store' })
      .then(async (response) => {
        if (cancelled) return
        if (response.ok) {
          const data = await response.json()
          if (data.authenticated && data.user) setUser(data.user)
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setAuthChecked(true) })
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    setHeroVideoFailed(false)
  }, [activeScene])

  return (
    <div className={styles.page}>
      <section className={styles.hero} aria-label="逐帧审阅首页">
        <div className={`${styles.videoStage} ${heroVideoFailed ? styles.videoStageFallback : ''}`} aria-hidden="true">
          <video
            key={scenes[activeScene].src}
            className={`${styles.heroVideo} ${styles.heroVideoActive}`}
            src={scenes[activeScene].src}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            onError={() => setHeroVideoFailed(true)}
          />
        </div>
        <div className={styles.shade} />
        <div className={styles.texture} />

        <header className={styles.header}>
          <Link className={styles.brand} href="/" aria-label="逐帧审阅首页">
            <span className={styles.brandMark}><Image src="/brand/logo.png" alt="" width={28} height={28} /></span>
            <span className={styles.brandText}><span>逐帧审阅</span></span>
          </Link>
          {authChecked && user ? (
            <Link className={styles.loginButton} href="/studio/projects">进入工作台</Link>
          ) : (
            <Link className={styles.loginButton} href="/login">登录</Link>
          )}
        </header>

        <div className={styles.heroContent}>
          <p className={styles.eyebrow}>VIDEO WORKFLOW, SIMPLIFIED</p>
          <h1>逐帧审阅</h1>
          <p className={styles.headline}>视频素材批注审阅与交付</p>
          <p className={styles.description}>从素材收录、版本修改到确认，让每一次沟通都准确落在画面本身。</p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryCta} href={user ? '/studio/projects' : '/login'}>
              {user ? '进入工作台' : '开始审片'}
            </Link>
          </div>
        </div>
      </section>

      <section className={styles.capabilityBand} aria-label="平台能力">
        <div className={styles.capabilityInner}>
          {capabilities.map(({ icon: Icon, title, detail }) => (
            <div className={styles.capability} key={title}>
              <Icon size={21} strokeWidth={1.8} />
              <div><h2>{title}</h2><p>{detail}</p></div>
            </div>
          ))}
        </div>
        <footer className={styles.siteFooter}>
          <a href="https://beian.miit.gov.cn" target="_blank" rel="noopener noreferrer">
            桂ICP备2026017259号-2
          </a>
        </footer>
      </section>
    </div>
  )
}
