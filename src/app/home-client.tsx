'use client'

import Link from 'next/link'
import Image from 'next/image'
import { Layers3, MessageSquareText, UploadCloud } from 'lucide-react'
import { useEffect, useState } from 'react'
import styles from './home.module.css'

const scenes = [
  { src: 'https://static.xiaobaic.cn/film-set.mp4', label: '现场拍摄' },
  { src: 'https://static.xiaobaic.cn/editing.mp4', label: '后期剪辑' },
  { src: 'https://static.xiaobaic.cn/review.mp4', label: '团队审片' },
]

const capabilities = [
  { icon: MessageSquareText, title: '逐帧审片', detail: '意见准确落在画面与时间点' },
  { icon: Layers3, title: '版本管理', detail: '每次修改都有清晰的版本记录' },
  { icon: UploadCloud, title: '素材收录', detail: '客户通过链接直接回传文件' },
]

export default function HomeClient() {
  const [activeScene, setActiveScene] = useState(0)
  const [companyName, setCompanyName] = useState('工作室')

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveScene((current) => (current + 1) % scenes.length)
    }, 8000)
    fetch('/api/settings/theme')
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (data?.companyName) setCompanyName(data.companyName) })
      .catch(() => {})
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className={styles.page}>
      <section className={styles.hero} aria-label="逐帧审阅首页">
        <div className={styles.videoStage} aria-hidden="true">
          <video
            key={scenes[activeScene].src}
            className={`${styles.heroVideo} ${styles.heroVideoActive}`}
            src={scenes[activeScene].src}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
          />
        </div>
        <div className={styles.shade} />
        <div className={styles.texture} />

        <header className={styles.header}>
          <Link className={styles.brand} href="/" aria-label="逐帧审阅首页">
            <span className={styles.brandMark}><Image src="/brand/logo.png" alt="" width={28} height={28} /></span>
            <span className={styles.brandText}><span>逐帧审阅</span><small>{companyName}</small></span>
          </Link>
          <Link className={styles.loginButton} href="/login">登录</Link>
        </header>

        <div className={styles.heroContent}>
          <p className={styles.eyebrow}>VIDEO WORKFLOW, SIMPLIFIED</p>
          <h1>逐帧审阅</h1>
          <p className={styles.headline}>专业视频审阅与交付平台</p>
          <p className={styles.description}>从素材收录、版本修改到客户确认，让每一次沟通都准确落在画面本身。</p>
          <div className={styles.sceneStatus} aria-label={`当前画面：${scenes[activeScene].label}`}>
            {scenes.map((scene, index) => (
              <div className={styles.sceneItem} key={scene.label}>
                <span className={`${styles.sceneLine} ${index === activeScene ? styles.sceneLineActive : ''}`} />
                <span className={index === activeScene ? styles.sceneLabelActive : ''}>{scene.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.scrollCue} aria-hidden="true"><span /></div>
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
      </section>
    </div>
  )
}
