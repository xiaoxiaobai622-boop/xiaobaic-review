'use client'

import Link from 'next/link'
import Image from 'next/image'
import {
  MessageSquareText, Layers3, UploadCloud, ShieldCheck, ChevronDown, PenLine, CheckCircle2,
  History, Link2, MousePointerClick, ArrowRight, Eye, Download, KeyRound, CalendarClock, Hash,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import ColorBends from '@/components/ColorBends'
import styles from './home.module.css'

const platformProps = [
  { icon: UploadCloud, title: '素材收录', detail: '客户点开链接就能把原片传回来，同名素材自动排成 v1、v2、v3。' },
  { icon: MessageSquareText, title: '审阅与批注', detail: '意见锚定在帧号与时间码上，画笔、箭头指到哪一块，改哪里一清二楚。' },
  { icon: Layers3, title: '版本管理', detail: '意见跟着版本走，两版并排或叠加同步对比，通过与定稿全程留痕。' },
  { icon: ShieldCheck, title: '分享与交付', detail: '链接单独设密码、有效期与次数上限，到期自动失效，权限按条勾选。' },
]

const reviewPoints = [
  { icon: PenLine, title: '逐帧落点', detail: '时间码精确到帧，29.97 / 59.94 丢帧计时，上一帧下一帧逐步排查。' },
  { icon: MessageSquareText, title: '画笔圈画', detail: '画笔、箭头、矩形和文字是同一条批注，圈住的画面换设备也在原地。' },
  { icon: CheckCircle2, title: '回复与解决', detail: '批注下接着讨论，逐条标记解决；客户不注册也能留言。' },
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

const sharePerms = [
  { icon: Eye, label: '看片', note: '不注册也能看' },
  { icon: MessageSquareText, label: '留言', note: '批注落在帧上' },
  { icon: Download, label: '下载', note: '单独放行原片' },
  { icon: CheckCircle2, label: '点通过', note: '通过即为定稿' },
  { icon: KeyRound, label: '访问密码', note: '按链接单独设置' },
  { icon: CalendarClock, label: '到期时间', note: '过期自动失效' },
  { icon: Hash, label: '打开次数上限', note: '用完即停' },
]

const collectPoints = [
  { icon: UploadCloud, title: '一条链接收片', detail: '把收录链接发给摄影师、后期或客户，对方点开就能传，不用开账号。' },
  { icon: Layers3, title: '同名自动接版', detail: '同名文件传回来就排成下一版；不同名直接重名冲突时跳过，不会覆盖。' },
  { icon: History, title: '谁传的都有据', detail: '每条版本带着上传者、时间和来源，回收站里的占用也一并算进额度。' },
]

const steps = [
  { num: '第一步', title: '传片建项目', detail: '把片子拖进项目，或发一条收录链接让客户自己回传。' },
  { num: '第二步', title: '发审片链接', detail: '客户不注册，密码一输就能看；意见直接落在帧和时间码上。' },
  { num: '第三步', title: '迭代到定稿', detail: '改完重传就是下一版，批注逐条解决，点通过即为定稿。' },
]

const footerGroups = [
  {
    title: '产品',
    links: [
      { href: '#platform', label: '平台能力' },
      { href: '#review', label: '逐帧批注' },
      { href: '#versions', label: '版本与定稿' },
      { href: '#share', label: '分享与交付' },
      { href: '#collect', label: '素材收录' },
    ],
  },
  {
    title: '功能详解',
    links: [
      { href: '/features', label: '功能总览' },
      { href: '/features/frame-comments', label: '逐帧批注' },
      { href: '/features/versions', label: '版本记录' },
      { href: '/features/share-link', label: '审片链接' },
    ],
  },
  {
    title: '怎么选',
    links: [
      { href: '/compare', label: '对比总览' },
      { href: '/compare/frame-io', label: '对比 Frame.io' },
      { href: '/compare/fenzhen', label: '对比分秒帧' },
      { href: '/compare/netdisk-wechat', label: '对比网盘加微信' },
    ],
  },
  {
    title: '开始使用',
    links: [
      { href: '/login', label: '登录' },
      { href: '/studio/projects', label: '进入工作台' },
      { href: '/terms', label: '服务条款' },
      { href: '/privacy', label: '隐私政策' },
    ],
  },
]

const HELP_URL = 'https://scnqe74t5owc.feishu.cn/wiki/UOxownMcRiBLeekZwcEc3BBAnc2'

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

function TickList({ items }: { items: { icon: typeof History; title: string; detail: string }[] }) {
  return (
    <ul className={styles.tickList}>
      {items.map(({ icon: Icon, title, detail }) => (
        <li className={styles.tickItem} key={title}>
          <Icon size={18} strokeWidth={1.7} className={styles.tickIcon} aria-hidden="true" />
          <div>
            <h4>{title}</h4>
            <p>{detail}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

export default function HomeClient() {
  const [user, setUser] = useState<{ id: string; name?: string | null; email?: string; phone?: string | null } | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [stuck, setStuck] = useState(false)
  const shotRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    document.documentElement.classList.add('no-scrollbar')
    return () => document.documentElement.classList.remove('no-scrollbar')
  }, [])

  // 导航粘顶后再压一层模糊背板：首屏要的是通栏黑底，滚动后要能压住下面的内容
  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // 滚动浮现：进入视口的区块淡入上移（尊重系统减少动效设置）
  useEffect(() => {
    const els = Array.from(document.querySelectorAll(`.${styles.reveal}`))
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add(styles.revealOn))
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add(styles.revealOn)
            io.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  // 首屏那段是产品录屏：只有真在视口里才放，滚走就停（浏览器不会替装饰性循环踩刹车）；
  // 系统要求减少动效时干脆不播，停在 poster 那一帧——autoplay 属性不吃系统设置，只能自己判。
  useEffect(() => {
    const v = shotRef.current
    if (!v) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    let onScreen = true
    const sync = () => {
      if (mq.matches || !onScreen) v.pause()
      else void v.play().catch(() => null)
    }
    const io = new IntersectionObserver(
      ([entry]) => { onScreen = entry.isIntersecting; sync() },
      { threshold: 0.2 }
    )
    io.observe(v)
    mq.addEventListener('change', sync)
    sync()
    return () => { io.disconnect(); mq.removeEventListener('change', sync) }
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
      <div className={styles.heroZone}>
        <div className={styles.bendsWrap} aria-hidden="true">
          {/* 着色器里 w = 1 - exp(-BW/exp(BW·m))，m 实测在 1~1.5：BW=4 时 w 只剩 0.015，
              整块画布叠到页面上是灰 9.7（对标 frame.io 同一块量到 37.2）——带子细到看不见，
              指针耦合再真也只是测得出、看不出。BW 收到 1.4 才把 w 抬到 0.25 那一档。 */}
          <ColorBends
            colors={['#8f7bff', '#4a2a9e']}
            speed={0.2}
            frequency={0.8}
            noise={0.15}
            rotation={90}
            intensity={1.6}
            bandWidth={1.4}
            mouseInfluence={2.2}
            parallax={1.6}
            trail
            transparent
          />
        </div>

        <div className={styles.promoBar}>
          <span>在线审片平台正式上线 — 支持逐帧批注、版本对比与安全交付</span>
          <a href={dashboardHref}>立即体验 <ArrowRight size={12} strokeWidth={2} /></a>
        </div>

        <header className={`${styles.header} ${stuck ? styles.headerStuck : ''}`}>
          <div className={styles.headerInner}>
            <Link className={styles.brand} href="/" aria-label="逐帧审阅首页">
              <span className={styles.brandMark}><Image src="/brand/logo.png" alt="" width={26} height={26} /></span>
              <span>逐帧审阅</span>
            </Link>
            <nav className={styles.headerNav} aria-label="页面导航">
              <div className={styles.navItem}>
                <button className={styles.navBtn} type="button">功能 <ChevronDown size={13} strokeWidth={2} /></button>
                <div className={styles.navDrop}>
                  <a href="#review">逐帧批注</a>
                  <a href="#versions">版本与定稿</a>
                  <a href="#share">分享与交付</a>
                  <a href="#collect">素材收录</a>
                  <Link href="/features">功能总览</Link>
                </div>
              </div>
              <div className={styles.navItem}>
                <button className={styles.navBtn} type="button">怎么选 <ChevronDown size={13} strokeWidth={2} /></button>
                <div className={styles.navDrop}>
                  <Link href="/compare">对比总览</Link>
                  <Link href="/compare/frame-io">对比 Frame.io</Link>
                  <Link href="/compare/fenzhen">对比分秒帧</Link>
                  <Link href="/compare/netdisk-wechat">对比网盘加微信</Link>
                </div>
              </div>
              <div className={styles.navItem}>
                <button className={styles.navBtn} type="button">资源 <ChevronDown size={13} strokeWidth={2} /></button>
                <div className={styles.navDrop}>
                  <a href={HELP_URL} target="_blank" rel="noopener noreferrer">帮助文档</a>
                  <a href="#workflow">使用流程</a>
                  <Link href="/terms">服务条款</Link>
                  <Link href="/privacy">隐私政策</Link>
                </div>
              </div>
            </nav>
            <div className={styles.headerRight}>
              <a className={styles.headerLink} href={HELP_URL} target="_blank" rel="noopener noreferrer">联系我们</a>
              {authChecked && !user && (
                <Link className={styles.loginLink} href="/login">登录</Link>
              )}
              <Link className={styles.pillPrimary} href={dashboardHref}>{primaryCtaLabel}</Link>
            </div>
          </div>
        </header>

        <section className={styles.hero}>
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
            <video
              ref={shotRef}
              className={styles.shotImg}
              src="/home/hero.mp4"
              poster="/home/hero-poster.jpg"
              width={1920}
              height={1080}
              muted
              loop
              playsInline
              preload="metadata"
              tabIndex={-1}
              aria-label="逐帧审阅的审片界面：片子在放，时间轴上的批注钉挨个悬出那一帧的预览，点一下跳回那一帧"
            />
          </div>
          <a className={styles.heroCue} href="#platform" aria-label="向下查看平台能力">
            <ChevronDown size={18} strokeWidth={1.6} />
          </a>
        </section>

        <section id="platform" className={`${styles.platformIntro} ${styles.wrapText} ${styles.reveal}`} aria-label="平台能力">
          <p className={styles.eyebrow}>平台能力</p>
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

      <section id="review" className={styles.chapter} aria-label="逐帧批注">
        <div className={styles.panel}>
          <div className={`${styles.panelInner} ${styles.reveal}`}>
            <div className={styles.intro}>
              <p className={styles.eyebrow}>逐帧批注</p>
              <h2 className={styles.duoHead}>
                <span className={styles.muted}>意见挂在第几帧，</span><br />
                不是「大概三分钟」。
              </h2>
              <p className={styles.sectionLead}>
                时间码精确到帧，画笔圈到哪一块就改哪一块；一条批注带着落点、轨迹和回复。
              </p>
              <a className={styles.pillGhost} href={dashboardHref}>
                开始逐帧批注 <ArrowRight size={15} strokeWidth={2} />
              </a>
            </div>
            <div className={styles.row}>
              <div className={styles.rowCopy}>
                <h3>圈住的那一块，换设备也在原地</h3>
                <p>画笔、箭头、矩形和文字算同一条批注，锚在帧号上；解决一条划掉一条，客户不注册也能留言。</p>
                <TickList items={reviewPoints} />
              </div>
              <figure className={styles.rowShot}>
                <Image
                  src="/home/review-comments.png"
                  alt="审片页：时间轴上排着批注钉，悬停弹出那一帧的画面预览气泡，气泡底部是该帧的时间码"
                  width={1400}
                  height={940}
                  quality={90} className={styles.shotImg}
                />
                <figcaption>审片页：批注钉落在时间轴上，悬停即出该帧的画面预览</figcaption>
              </figure>
            </div>
          </div>
        </div>
      </section>

      <section id="versions" className={styles.chapter} aria-label="版本与定稿">
        <div className={`${styles.panel} ${styles.panelAlt}`}>
          <div className={`${styles.panelInner} ${styles.reveal} ${styles.revealSide}`}>
            <div className={styles.intro}>
              <p className={styles.eyebrow}>版本与定稿</p>
              <h2 className={styles.duoHead}>
                <span className={styles.muted}>每一次修改，</span><br />
                都有版本记录。
              </h2>
              <p className={styles.sectionLead}>
                同名素材再传就是下一版，意见跟着版本走，点通过的那一版即定稿。
              </p>
            </div>
            <div className={`${styles.row} ${styles.rowFlip}`}>
              <div className={styles.rowCopy}>
                <h3>翻旧版看到的是旧版那套意见</h3>
                <p>v2 上提的批注不会漂到 v3 头上；两版可以并排或叠加同步对比，通过与定稿全程留痕。</p>
                <TickList items={versionPoints} />
              </div>
              <figure className={styles.rowShot}>
                <Image
                  src="/home/versions-grid.png"
                  alt="项目工作区：素材网格里 12 条素材、20 个版本，卡片上标着各自的 v1、v2、v3"
                  width={1400}
                  height={1040}
                  quality={90} className={styles.shotImg}
                />
                <figcaption>项目工作区：同名素材自动排成 v1、v2、v3，各自带上传者与时间</figcaption>
              </figure>
            </div>
            <div id="workflow" className={styles.stepsRow}>
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

      <section className={styles.chapter} aria-label="产品说明">
        <div className={styles.panel}>
          <div className={`${styles.panelInner} ${styles.reveal}`}>
            <blockquote className={styles.quote}>
              <p>
                <span className={styles.muted}>一条批注，跟着这一版，</span><br />
                从粗剪走到定稿。
              </p>
              <footer className={styles.quoteCite}>
                帧号、画笔轨迹、回复和解决状态是同一条记录，不是拼三个功能凑出来的流程。
              </footer>
            </blockquote>
          </div>
        </div>
      </section>

      <section id="share" className={styles.chapter} aria-label="分享与交付">
        <div className={`${styles.panel} ${styles.panelAlt}`}>
          <div className={`${styles.panelInner} ${styles.reveal}`}>
            <div className={styles.intro}>
              <p className={styles.eyebrow}>分享与交付</p>
              <h2 className={styles.duoHead}>
                <span className={styles.muted}>带密码和有效期的</span><br />
                审片链接。
              </h2>
              <p className={styles.sectionLead}>
                一条链接对应一套设置：谁能看、能不能留言、能不能下载、能不能点通过，
                都是按链接单独勾出来的，不是全局开关。
              </p>
              <a className={styles.pillGhost} href={dashboardHref}>
                生成审片链接 <ArrowRight size={15} strokeWidth={2} />
              </a>
            </div>
            <div className={styles.row}>
              <div className={styles.rowCopy}>
                <h3>权限按条勾，到期自动停</h3>
                <p>看、留言、下载、点通过四样各开各的；密码、到期时间、打开次数上限按链接单独设置。</p>
                <TickList items={sharePoints} />
              </div>
              <div className={styles.rowShot}>
                <ul className={styles.permCard} aria-label="一条链接可单独设置的能力">
                  {sharePerms.map(({ icon: Icon, label, note }) => (
                    <li className={styles.permRow} key={label}>
                      <Icon size={16} strokeWidth={1.7} className={styles.permOn} aria-hidden="true" />
                      <span>{label}</span>
                      <span className={styles.permNote}>{note}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="collect" className={styles.chapter} aria-label="素材收录">
        <div className={styles.panel}>
          <div className={`${styles.panelInner} ${styles.reveal} ${styles.revealSide}`}>
            <div className={styles.intro}>
              <p className={styles.eyebrow}>素材收录</p>
              <h2 className={styles.duoHead}>
                <span className={styles.muted}>把收片这一步，</span><br />
                交给对方自己点。
              </h2>
              <p className={styles.sectionLead}>
                发一条收录链接，摄影师、后期或客户点开就能上传；传回来的片子直接进项目。
              </p>
            </div>
            <div className={`${styles.row} ${styles.rowFlip}`}>
              <div className={styles.rowCopy}>
                <h3>不用开账号，传回来就进项目</h3>
                <p>对方点链接就能传；同名自动排成下一版，不同名才新建，冲突时跳过不覆盖。</p>
                <TickList items={collectPoints} />
              </div>
              <figure className={styles.rowShot}>
                <Image
                  src="/home/collect-upload.png"
                  alt="收录页：客户不注册也能上传原片，拖放区写着支持的文件类型"
                  width={1600}
                  height={850}
                  quality={90} className={styles.shotImg}
                />
                <figcaption>收录页：客户不注册也能传原片，传回来的直接进项目排版本</figcaption>
              </figure>
            </div>
          </div>
        </div>
      </section>

      <section id="cta" className={styles.ctaBand} aria-label="开始使用">
        <div className={`${styles.ctaInner} ${styles.reveal}`}>
          <h2>开始使用逐帧审阅</h2>
          <p>建一个团队，传一条片子，几分钟就能走完全流程。</p>
          <div className={styles.heroActions}>
            <Link className={styles.pillPrimary} href={dashboardHref}>{primaryCtaLabel}</Link>
            <Link className={styles.pillGhost} href="/features">查看功能详解 <ArrowRight size={15} strokeWidth={2} /></Link>
          </div>
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
            {footerGroups.map((group) => (
              <div className={styles.footerCol} key={group.title}>
                <h4>{group.title}</h4>
                {group.links.map((link) => (
                  link.href.startsWith('#')
                    ? <a key={link.href} href={link.href}>{link.label}</a>
                    : <Link key={link.href} href={link.href}>{link.label}</Link>
                ))}
              </div>
            ))}
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
