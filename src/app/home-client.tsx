'use client'

import Link from 'next/link'
import Image from 'next/image'
import { MessageSquareText, Layers3, UploadCloud, ShieldCheck, ChevronDown, PenLine, CheckCircle2, History, Link2, MousePointerClick, ArrowRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import ColorBends from '@/components/ColorBends'
import styles from './home.module.css'

const platformProps = [
  { icon: UploadCloud, title: '素材收录', detail: '客户点开链接就能把原片传回来，同名素材自动排成 v1、v2、v3。' },
  { icon: MessageSquareText, title: '审阅与批注', detail: '意见锚定在帧号与时间码上，画笔、箭头指到哪一块，改哪里一清二楚。' },
  { icon: Layers3, title: '版本管理', detail: '意见跟着版本走，两版并排或叠加同步对比，通过与定稿全程留痕。' },
  { icon: ShieldCheck, title: '分享与交付', detail: '链接单独设密码、有效期与次数上限，到期自动失效，权限按条勾选。' },
]

const versionPoints = [
  { icon: History, title: '自动成版本', detail: '同名素材再传就是下一版，带着上传者和时间，不用手动管理。' },
  { icon: Layers3, title: '意见跟版本走', detail: 'v2 上提的意见不会漂到 v3 头上，翻旧版看到的是旧版那套意见。' },
  { icon: CheckCircle2, title: '通过即定稿', detail: '点通过的那一版就是定稿，再传新版本重新走流程，老版本不受影响。' },
]

const sharePoints = [
  { icon: ShieldCheck, title: '密码与有效期', detail: '每条链接单独设密码、到期时间、打开次数上限，到期自动失效。' },
  { icon: Link2, title: '权限按条勾选', detail: '看、留言、下载、点通过，四样各开各的，按链接单独控制。' },
  { icon: MousePointerClick, title: '谁打开过有记录', detail: '每次访问都有据可查，客户顺着同一条链接还能把原片回传。' },
]

const steps = [
  { num: '01', title: '传片建项目', detail: '把片子拖进项目，或发一条收录链接让客户自己回传。' },
  { num: '02', title: '发审片链接', detail: '客户不注册，密码一输就能看；意见直接落在帧和时间码上。' },
  { num: '03', title: '迭代到定稿', detail: '改完重传就是下一版，批注逐条解决，点通过即为定稿。' },
]

function PointColumns({ items }: { items: { icon: typeof History; title: string; detail: string }[] }) {
  return (
    <div className={styles.pointCols}>
      {items.map(({ icon: Icon, title, detail }) => (
        <div className={styles.pointCol} key={title}>
          <Icon size={22} strokeWidth={1.6} className={styles.pointIcon} />
          <h3>{title}</h3>
          <p>{detail}</p>
        </div>
      ))}
    </div>
  )
}

export default function HomeClient() {
  const [user, setUser] = useState<{ id: string; name?: string | null; email?: string; phone?: string | null } | null>(null)
  const [authChecked, setAuthChecked] = useState(false)

  useEffect(() => {
    document.documentElement.classList.add('no-scrollbar')
    return () => document.documentElement.classList.remove('no-scrollbar')
  }, [])

  // 滚动浮现：进入视口的区块淡入上移（尊重系统减少动效设置）
  useEffect(() => {
    const els = Array.from(document.querySelectorAll('[data-reveal]'))
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
      els.forEach((el) => el.setAttribute('data-reveal-on', ''))
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.setAttribute('data-reveal-on', '')
            io.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  useEffect(() => {
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
    return () => { cancelled = true }
  }, [])

  const dashboardHref = user ? '/studio/projects' : '/login'
  const primaryCtaLabel = user ? '进入工作台' : '开始审片'

  return (
    <div className={styles.page}>
      {/* ── Hero：紫色渐变，左文右图 ── */}
      <div className={styles.heroZone}>
        <div className={styles.bendsWrap} aria-hidden="true">
          <ColorBends
            colors={['#a855f7', '#5b21b6']}
            speed={0.2}
            frequency={1}
            noise={0.15}
            rotation={90}
            intensity={1.3}
            transparent
          />
        </div>
        <div className={styles.promoBar}>
          <span>在线审片平台正式上线 — 支持逐帧批注、版本对比与安全交付</span>
          <a href={dashboardHref}>立即体验 <ArrowRight size={12} strokeWidth={2} /></a>
        </div>
        <header className={styles.header}>
          <Link className={styles.brand} href="/" aria-label="逐帧审阅首页">
            <span className={styles.brandMark}><Image src="/brand/logo.png" alt="" width={26} height={26} /></span>
            <span>逐帧审阅</span>
          </Link>
          <nav className={styles.headerNav} aria-label="页面导航">
            <div className={styles.navItem}>
              <button className={styles.navBtn} type="button">功能 <ChevronDown size={13} strokeWidth={2} /></button>
              <div className={styles.navDrop}>
                <a href="#review">逐帧批注</a>
                <a href="#versions">版本管理</a>
                <a href="#share">分享与交付</a>
                <a href="#platform">平台能力</a>
              </div>
            </div>
            <div className={styles.navItem}>
              <button className={styles.navBtn} type="button">企业 <ChevronDown size={13} strokeWidth={2} /></button>
              <div className={styles.navDrop}>
                <a href="https://scnqe74t5owc.feishu.cn/wiki/UOxownMcRiBLeekZwcEc3BBAnc2" target="_blank" rel="noopener noreferrer">联系我们</a>
                <Link href="/terms">服务条款</Link>
                <Link href="/privacy">隐私政策</Link>
              </div>
            </div>
            <div className={styles.navItem}>
              <button className={styles.navBtn} type="button">资源 <ChevronDown size={13} strokeWidth={2} /></button>
              <div className={styles.navDrop}>
                <a href="https://scnqe74t5owc.feishu.cn/wiki/UOxownMcRiBLeekZwcEc3BBAnc2" target="_blank" rel="noopener noreferrer">帮助文档</a>
                <a href="#workflow">使用流程</a>
              </div>
            </div>
          </nav>
          <div className={styles.headerRight}>
            <a
              className={styles.headerLink}
              href="https://scnqe74t5owc.feishu.cn/wiki/UOxownMcRiBLeekZwcEc3BBAnc2"
              target="_blank"
              rel="noopener noreferrer"
            >
              联系我们
            </a>
            {authChecked && !user && (
              <Link className={styles.loginLink} href="/login">登录</Link>
            )}
            <Link className={styles.pillPrimary} href={dashboardHref}>{primaryCtaLabel}</Link>
          </div>
        </header>

        <section className={styles.hero} aria-label="逐帧审阅首页">
          <div className={styles.heroCopy}>
            <h1>让每一条意见，<br />都落在画面上。</h1>
            <p>
              逐帧审阅是面向影视团队的在线审片平台：上传素材、逐帧批注、管理版本、安全交付，
              全部在同一条时间轴上完成。
            </p>
            <div className={styles.heroActions}>
              <Link className={styles.pillPrimary} href={dashboardHref}>{primaryCtaLabel}</Link>
              <a className={styles.pillGhost} href="#platform">
                了解平台 <ArrowRight size={15} strokeWidth={2} />
              </a>
            </div>
          </div>
          <div className={styles.heroShot}>
            <Image
              src="/home/review-ui.png"
              alt="逐帧审阅的审片界面：左侧视频播放器带时间轴批注标记，右侧是按时间码排列的批注列表"
              width={1440}
              height={900}
              priority
              className={styles.shotImg}
            />
          </div>
          <a className={styles.heroCue} href="#platform" aria-label="向下查看平台能力">
            <ChevronDown size={18} strokeWidth={1.6} />
          </a>
        </section>

        {/* ── 平台 4 列 ── */}
        <section id="platform" data-reveal className={styles.platformIntro} aria-label="平台能力">
          <p className={styles.eyebrow}>The Platform</p>
          <h2 className={styles.duoHead}>
            <span className={styles.muted}>无论拍什么，</span><br />
            逐帧审阅帮你更快交付。
          </h2>
          <p className={styles.sectionLead}>
            从素材回传到定稿交付，团队和客户始终看的是同一条时间轴。
          </p>
          <PointColumns items={platformProps} />
        </section>
      </div>

      {/* ── 深色面板 1：审阅与批注 ── */}
      <section id="review" className={styles.panelWrap} aria-label="逐帧批注">
        <div className={styles.panel} data-reveal>
          <div className={styles.panelInner}>
            <p className={styles.eyebrow}>Review &amp; Comment</p>
            <h2 className={styles.duoHead}>
              <span className={styles.muted}>意见挂在第几帧，</span><br />
              不是「大概三分钟」。
            </h2>
            <a className={styles.pillGhost} href={dashboardHref}>
              开始逐帧批注 <ArrowRight size={15} strokeWidth={2} />
            </a>
            <div className={styles.panelShot}>
              <Image
                src="/home/comments-detail.png"
                alt="点击时间轴上的批注标记，画面回到对应帧并弹出时间码气泡"
                width={1440}
                height={430}
                className={styles.shotImg}
              />
            </div>
            <PointColumns items={[
              { icon: PenLine, title: '逐帧落点', detail: '时间码精确到帧，29.97 / 59.94 丢帧计时，上一帧下一帧逐步排查。' },
              { icon: MessageSquareText, title: '画笔圈画', detail: '画笔、箭头、矩形和文字是同一条批注，圈住的画面换设备也在原地。' },
              { icon: CheckCircle2, title: '回复与解决', detail: '批注下接着讨论，逐条标记解决；客户不注册也能留言。' },
            ]} />
          </div>
        </div>
      </section>

      {/* ── 深色面板 2：版本管理 ── */}
      <section id="versions" className={styles.panelWrap} aria-label="版本管理">
        <div className={styles.panel} data-reveal>
          <div className={styles.panelInner}>
            <p className={styles.eyebrow}>Versions</p>
            <h2 className={styles.duoHead}>
              <span className={styles.muted}>每一次修改，</span><br />
              都有版本记录。
            </h2>
            <PointColumns items={versionPoints} />
          </div>
        </div>
      </section>

      {/* ── 深色面板 3：分享与交付 ── */}
      <section id="share" className={styles.panelWrap} aria-label="分享与交付">
        <div className={styles.panel} data-reveal>
          <div className={styles.panelInner}>
            <p className={styles.eyebrow}>Share &amp; Deliver</p>
            <h2 className={styles.duoHead}>
              <span className={styles.muted}>带密码和有效期的</span><br />
              审片链接。
            </h2>
            <PointColumns items={sharePoints} />
          </div>
        </div>
      </section>

      {/* ── 三步流程 ── */}
      <section id="workflow" className={styles.panelWrap} aria-label="使用流程">
        <div className={styles.panel} data-reveal>
          <div className={styles.panelInner}>
            <p className={styles.eyebrow}>Workflow</p>
            <h2 className={styles.duoHead}>
              <span className={styles.muted}>三步，</span><br />
              从粗剪到定稿。
            </h2>
            <div className={styles.stepsRow}>
              {steps.map(({ num, title, detail }) => (
                <div className={styles.step} key={num}>
                  <span className={styles.stepNum}>{num}</span>
                  <h3>{title}</h3>
                  <p>{detail}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section id="cta" data-reveal className={styles.ctaBand} aria-label="开始使用">
        <h2>开始使用逐帧审阅</h2>
        <p>建一个团队，传一条片子，几分钟就能走完全流程。</p>
        <div className={styles.heroActions}>
          <Link className={styles.pillPrimary} href={dashboardHref}>{primaryCtaLabel}</Link>
        </div>
      </section>

      <footer className={styles.siteFooter}>
        <div className={styles.footerInner}>
          <div className={styles.footerGrid}>
            <div className={styles.footerBrandCol}>
              <span className={styles.footerBrand}>
                <Image src="/brand/logo.png" alt="" width={22} height={22} />
                逐帧审阅
              </span>
              <p className={styles.footerDesc}>
                面向影视团队的在线审片、版本管理、素材收录与安全交付平台。
              </p>
            </div>
            <div className={styles.footerCol}>
              <h4>产品</h4>
              <a href="#platform">平台能力</a>
              <a href="#review">逐帧批注</a>
              <a href="#versions">版本管理</a>
              <a href="#share">分享与交付</a>
            </div>
            <div className={styles.footerCol}>
              <h4>支持</h4>
              <a
                href="https://scnqe74t5owc.feishu.cn/wiki/UOxownMcRiBLeekZwcEc3BBAnc2"
                target="_blank"
                rel="noopener noreferrer"
              >
                帮助文档
              </a>
              <Link href="/login">登录</Link>
              <Link href="/studio/projects">进入工作台</Link>
            </div>
            <div className={styles.footerCol}>
              <h4>法律条款</h4>
              <Link href="/terms">服务条款</Link>
              <Link href="/privacy">隐私政策</Link>
            </div>
          </div>
          <div className={styles.footerBottom}>
            <span className={styles.footerCopy}>© 2026 南宁轻创社科技有限公司</span>
            <a
              className={styles.footerIcp}
              href="https://beian.miit.gov.cn"
              target="_blank"
              rel="noopener noreferrer"
            >
              桂ICP备2026022852号
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
