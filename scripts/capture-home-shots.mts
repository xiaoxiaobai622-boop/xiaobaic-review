import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/encryption'

/**
 * 给首页两张配图重截真图：public/home/review-ui.png（1440×900）与 comments-detail.png（1440×430）。
 * 数据来自 scripts/build-home-demo.mts 造的那条演示素材（屿见 · 城市夜景品牌片）。
 *
 * 登录只在浏览器里做（会话指纹绑设备头＋UA，Node 侧令牌在浏览器一刷就烧掉整枚会话）。
 * 口令：设了 HOME_DEMO_PASSWORD 就用它；没设就当场改一枚随机的、只在本次进程里用，不落文件。
 * CDP 用 Node 内置 WebSocket，零依赖。
 *
 *   npx tsx --env-file=.env scripts/capture-home-shots.mts            # 写进 public/home
 *   npx tsx --env-file=.env scripts/capture-home-shots.mts --recon    # 只出 /tmp 试拍＋几何事实
 */
const BASE = process.env.SHARE_CHECK_BASE || 'http://localhost:3000'
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const RECON = process.argv.includes('--recon')
const OUT_DIR = RECON ? join(tmpdir(), 'home-shots') : 'public/home'
const EMAIL = 'home-demo@xiaobaic.local'
/** 画面停在这一秒：片头字幕那条批注（00:03:12）刚过，画面里人和监视器都在。 */
const PARK_AT_SEC = 4.2
/** 第二张＝视口底部这条横带的高度，与旧图 comments-detail.png 的原生高度一致。 */
const BAND_H = 430
const prisma = new PrismaClient()
const stamp = Date.now()
const cdpPort = 9300 + (stamp % 600)
const userDataDir = join(tmpdir(), `home-shots-${stamp}`)
let chrome: ChildProcess | undefined
const failures: string[] = []

function check(ok: boolean, label: string, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` ${detail}` : ''}`)
  if (!ok) failures.push(label)
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ── CDP ──────────────────────────────────────────────────────────────────
let ws: WebSocket | undefined
let msgId = 0
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()

function send(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
  const id = ++msgId
  return new Promise<any>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws?.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error(`CDP 超时：${method}`)) }
    }, 60_000)
  })
}

async function connectChrome() {
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${userDataDir}`,
    '--remote-allow-origins=*', '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--disable-translate', '--lang=zh-CN', '--window-size=1440,900',
  ], { stdio: 'ignore' })
  for (let i = 0; i < 60; i++) {
    const ok = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then(r => r.ok).catch(() => false)
    if (ok) return proc
    await sleep(500)
  }
  proc.kill()
  throw new Error('无头 Chrome 没起来')
}

function attachSocket(url: string) {
  return new Promise<void>((resolve, reject) => {
    ws = new WebSocket(url)
    ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data))
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id)!
        pending.delete(msg.id)
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error)))
        else p.resolve(msg.result)
      }
    }
    ws.onerror = () => reject(new Error('CDP WebSocket 连接失败'))
    ws.onopen = () => resolve()
  })
}

async function openPage() {
  const { browserContextId } = await send('Target.createBrowserContext', { disposeOnDetach: true })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const page = { browserContextId, targetId, sessionId, s: (m: string, p: Record<string, unknown> = {}) => send(m, p, sessionId) }
  await page.s('Page.enable')
  await page.s('Runtime.enable')
  await page.s('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false })
  return page
}

type Page = Awaited<ReturnType<typeof openPage>>

async function evalJs(page: Page, expression: string) {
  const r = await page.s('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(`页面 JS 异常：${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
  return r.result.value
}

async function waitFor(page: Page, expression: string, timeoutMs = 90_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await evalJs(page, `(() => { try { return (${expression}) ? true : false } catch { return false } })()`)) return true
    await sleep(400)
  }
  return false
}

async function run(page: Page, path: string) {
  await page.s('Page.navigate', { url: `${BASE}${path}` })
}

/** 截当前视口（deviceScaleFactor=2 ⇒ 1440×900 的 CSS 视口落成 2880×1800）。clip 按 CSS 像素切一块。 */
async function shot(page: Page, file: string, clip?: { x: number; y: number; width: number; height: number }) {
  await page.s('Page.bringToFront')
  const { data } = await page.s('Page.captureScreenshot', {
    format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
  })
  writeFileSync(file, Buffer.from(data, 'base64'))
  return file
}

/** 2x 的取景缩回旧图的原生宽度（1440），文件契约与 <Image width height> 保持一致。 */
function downscale(file: string) {
  if (RECON) return
  execFileSync('sips', ['--resampleWidth', '1440', file, '--out', file], { stdio: 'ignore' })
}

async function loginInBrowser(page: Page, password: string) {
  const deviceId = `home-shots-${stamp}`
  await page.s('Page.addScriptToEvaluateOnNewDocument', {
    // 那枚黑色「N」是 next dev 的工具徽标（<nextjs-portal>），线上不存在，营销图里更不该出现。
    source: `localStorage.setItem('vitransfer_device_id', ${JSON.stringify(deviceId)});
      (() => {
        const add = () => {
          const host = document.head || document.documentElement
          if (!host || host.ownerDocument.getElementById('hide-dev-badge')) return
          const s = document.createElement('style')
          s.id = 'hide-dev-badge'
          s.textContent = 'nextjs-portal{display:none!important}'
          host.appendChild(s)
        }
        add()
        new MutationObserver(add).observe(document, { childList: true, subtree: true })
      })()`,
  })
  await run(page, '/login')
  if (!await waitFor(page, `document.body && document.body.children.length > 0`, 90_000)) throw new Error('/login 没画出来')
  const out = String(await evalJs(page, `(async () => {
    const r = await fetch('/api/auth/login', { method: 'POST', cache: 'no-store',
      headers: { 'content-type': 'application/json', 'X-ViTransfer-Device-ID': ${JSON.stringify(deviceId)} },
      body: JSON.stringify({ email: ${JSON.stringify(EMAIL)}, password: ${JSON.stringify(password)} }) })
    const j = await r.json().catch(() => null)
    if (j?.tokens?.refreshToken) localStorage.setItem('vitransfer_refresh_token', j.tokens.refreshToken)
    return r.status + ' ' + (j?.tokens?.refreshToken ? 'session' : JSON.stringify(j?.error ?? '').slice(0, 120))
  })()`))
  return out
}

/** 把片子停在指定秒并暂停，等 seeked 真落地（画面没画出来就截，会得到黑帧）。 */
async function parkAt(page: Page, sec: number) {
  await evalJs(page, `(() => {
    const v = document.querySelector('video')
    if (!v) throw new Error('没有 video 元素')
    v.muted = true
    if (Math.abs(v.currentTime - ${sec}) > 0.02) { v.currentTime = ${sec} }
    v.pause()
    return v.readyState
  })()`)
  if (!await waitFor(page, `document.querySelector('video') && document.querySelector('video').currentTime > ${(sec - 0.05).toFixed(3)} && document.querySelector('video').paused`)) return false
  await sleep(900)
  return true
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const user = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true, name: true } })
  const team = await prisma.team.findUnique({ where: { slug: 'home-demo' }, select: { id: true, name: true } })
  const project = await prisma.project.findFirst({
    where: { team: { slug: 'home-demo' } }, orderBy: { createdAt: 'desc' },
    select: { id: true, title: true, _count: { select: { videos: true, comments: true } } },
  })
  const video = await prisma.video.findFirst({
    where: { project: { team: { slug: 'home-demo' } } },
    select: { id: true, name: true, duration: true, width: true, height: true, status: true },
  })
  check(Boolean(user && team && project && video), '演示数据在本地库里齐了',
    `→ ${JSON.stringify({ user: user?.name, team: team?.name, project: project?.title, videos: project?._count.videos, comments: project?._count.comments, video: video?.name, status: video?.status })}`)
  if (!project || !video) throw new Error('先跑 scripts/build-home-demo.mts')

  const password = process.env.HOME_DEMO_PASSWORD || randomBytes(9).toString('base64url')
  if (!process.env.HOME_DEMO_PASSWORD) {
    await prisma.user.update({ where: { email: EMAIL }, data: { password: await hashPassword(password) } })
  }

  chrome = await connectChrome()
  const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then(r => r.json())
  await attachSocket(webSocketDebuggerUrl)

  const page = await openPage()
  console.log('登录：', await loginInBrowser(page, password))
  // 整页审片面＝双击素材卡时 router.push 的那个地址（AdminVideoManager 的 handleCardDoubleClick）。
  await run(page, `/studio/projects/${project.id}/share?video=${encodeURIComponent(video.name)}`)
  // Page.navigate 立刻返回，旧文档还挂在 DOM 上；不等它卸掉，waitFor 会拿上一屏的 video 假通过。
  await waitFor(page, `!document.querySelector('video')`, 60_000)
  const gotVideo = await waitFor(page, `document.querySelector('video') && document.querySelector('video').videoWidth > 0`, 90_000)
  check(gotVideo, '审片页画出视频了（首帧已解码）')
  if (!gotVideo) {
    // 没有视频＝多半停在空态/报错面。先把页面文字和一张试拍留下，别对着黑屏猜。
    console.log('页面文字：', String(await evalJs(page, `document.body.innerText.slice(0, 700)`)).replace(/\n+/g, ' ⏎ '))
    await shot(page, join(OUT_DIR, 'no-video.png')).catch(() => null)
  }
  check(gotVideo && await parkAt(page, PARK_AT_SEC), `片子停在 ${PARK_AT_SEC} 秒并暂停`)

  const geo = JSON.parse(String(await evalJs(page, `(() => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } }
    const v = document.querySelector('video')
    return JSON.stringify({
      innerWidth, innerHeight, scrollH: document.documentElement.scrollHeight,
      video: r(v), videoBottom: Math.round(v ? v.getBoundingClientRect().bottom : 0),
      pins: [...document.querySelectorAll('button')].filter(b => /^Comment by /.test((b.getAttribute('aria-label') || '').trim())).length,
      timecodes: [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && /\\d\\d:\\d\\d:\\d\\d/.test(e.textContent || '')).length,
      devBadge: document.querySelectorAll('nextjs-portal').length,
      devBadgeVisible: [...document.querySelectorAll('nextjs-portal')].some(e => e.getBoundingClientRect().width > 0 && getComputedStyle(e).display !== 'none'),
    })
  })()`)))
  console.log('几何：', JSON.stringify(geo))
  // 第二张是视口底部 BAND_H 高的横带：时间轴＋批注钉＋播控条＋批注输入框，画面上沿要留在带子里。
  const bandTop = geo.innerHeight - BAND_H
  check(geo.videoBottom > bandTop && geo.videoBottom < geo.innerHeight,
    '横带切到画面下沿与时间轴', `→ video 底边 ${geo.videoBottom}，带子从 ${bandTop} 起`)
  check(geo.devBadgeVisible === false, 'next dev 徽标不在画面里', `→ ${geo.devBadge} 枚`)

  const a = await shot(page, join(OUT_DIR, RECON ? 'recon-full.png' : 'review-ui.png'))

  // 第二张要对上「点击时间轴上的批注标记…弹出时间码气泡」这句 alt：把鼠标真的停在一枚钉上。
  const pinAt = async (i: number) => JSON.parse(String(await evalJs(page, `(() => {
    const bs = [...document.querySelectorAll('button[data-testid="comment-marker"]')].filter(b => b.offsetParent !== null)
    const b = bs[${i}] || bs[0]
    if (!b) return JSON.stringify({})
    const r = b.getBoundingClientRect()
    return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: b.getAttribute('aria-label') || '' })
  })()`)))
  const hover = async (p: { x: number; y: number }) => {
    await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left' })
    await sleep(500)
  }
  // 悬停时叠着两层 bg-black/95：帧预览气泡（里面有 <video>）和批注 tooltip（没有）。
  // 判据只认带 <video> 的那一层——上一版按「有 bg-black/95 且无 spinner」判，命中的是永远不转圈的 tooltip，假绿。
  const bubbleProbe = `(() => {
    const b = [...document.querySelectorAll('div')].find(e =>
      typeof e.className === 'string' && e.className.includes('bg-black/95') && e.querySelector('video'))
    if (!b) return JSON.stringify({ found: false })
    const v = b.querySelector('video')
    const r = b.getBoundingClientRect()
    const spin = b.querySelector('.animate-spin')
    return JSON.stringify({
      found: true, spin: !!spin, readyState: v.readyState, networkState: v.networkState,
      cur: Math.round(v.currentTime * 100) / 100, dur: Math.round(v.duration * 100) / 100,
      src: (v.currentSrc || v.src || '').split('?')[0].slice(-28),
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      label: (b.textContent || '').trim().slice(-22),
    })
  })()`
  const readBubble = async () => JSON.parse(String(await evalJs(page, bubbleProbe)))
  /** 等 spinner 撤掉；超时也返回最后一次读数，让失败原因打在日志里而不是被吞掉。 */
  const waitBubble = async (timeoutMs: number) => {
    const start = Date.now()
    for (;;) {
      const s = await readBubble()
      if (!s.found) return s
      if (!s.spin) return s
      if (Date.now() - start > timeoutMs) return s
      await sleep(400)
    }
  }

  // 只在 --recon：一直转圈到底是「没解码」还是「解码了但 React 的 ready 没翻」——
  // 记 <video> 元素被换了几次（key 变了就说明 URL 在轮换）、src 尾巴、seeked 回没回来。
  if (RECON) await evalJs(page, `(() => {
    if (window.__hs) return
    const s = { swaps: 0, srcs: [], seeked: 0, loadstart: 0, last: null }
    window.__hs = s
    const find = () => {
      const b = [...document.querySelectorAll('div')].find(e =>
        typeof e.className === 'string' && e.className.includes('bg-black/95') && e.querySelector('video'))
      return b ? b.querySelector('video') : null
    }
    setInterval(() => {
      const v = find()
      if (!v) return
      if (v !== s.last) {
        s.swaps += 1
        s.last = v
        if (s.srcs.length < 8) s.srcs.push((v.currentSrc || v.src || '').split('?')[0].slice(-12))
        v.addEventListener('seeked', () => { s.seeked += 1 })
        v.addEventListener('loadstart', () => { s.loadstart += 1 })
      }
    }, 200)
  })()`)
  const watch = async () => {
    if (!RECON) return ''
    const j = await evalJs(page, 'JSON.stringify({ ...window.__hs, last: undefined })').catch(() => '"n/a"')
    return `｜watch=${j}`
  }

  const pin = await pinAt(2)
  await hover(pin)
  // 气泡里那枚时间码和 aria-label 尾巴是同一个串，用它认「真的悬出了这一枚的气泡」。
  const at = pin.label.slice(pin.label.lastIndexOf(' ') + 1)
  const bubbled = await waitFor(page, `[...document.querySelectorAll('div')].some(e => typeof e.className === 'string' && e.className.includes('bg-black/95') && e.querySelector('video') && (e.textContent || '').includes(${JSON.stringify(at)}))`, 8_000)
  let bub = bubbled ? await waitBubble(12_000) : { found: false }
  if (!bubbled || bub.spin) {
    // 换一枚钉再回来会带着新的 hoveredTime 重新 seek，第二次通常已经缓冲好了。
    await hover(await pinAt(1))
    await hover(pin)
    bub = await waitBubble(12_000)
  }
  check(Boolean(pin.x) && bubbled && bub.found && !bub.spin, '批注钉上悬出了已解码的帧预览气泡',
    `→ ${pin.label}｜${JSON.stringify(bub)}${await watch()}`)
  // 只在 --recon 探一句：spinner 撤不掉到底是「没解码」还是「解码了但组件没收到 seeked」。
  // 对着已经缓冲好的位置再挪 0.05 秒，看赋值那一刻 readyState 是不是还留在 2 以上——
  // 组件里唯一的另一条 setReady 路径就是赋值后同步读 readyState（TimelineHoverPreview:64）。
  if (RECON && bub.found) console.log('探针：', String(await evalJs(page, `(() => {
    const b = [...document.querySelectorAll('div')].find(e =>
      typeof e.className === 'string' && e.className.includes('bg-black/95') && e.querySelector('video'))
    const v = b.querySelector('video')
    const before = v.readyState
    v.currentTime = v.currentTime + 0.05
    const after = v.readyState
    return JSON.stringify({ before, after })
  })()`)))

  const b = await shot(page, join(OUT_DIR, RECON ? 'recon-band.png' : 'comments-detail.png'), {
    x: 0, y: bandTop, width: geo.innerWidth, height: BAND_H,
  })
  console.log('截图：', a, b)
  downscale(a)
  downscale(b)

  await page.s('Target.closeTarget', { targetId: page.targetId }).catch(() => null)
  console.log(failures.length ? `\n${failures.length} 条 FAIL：${failures.join('；')}` : '\n全部 PASS')
}

main()
  .catch(e => { console.log('运行失败：', String(e?.message ?? e).slice(0, 400)); failures.push('run') })
  .finally(async () => {
    chrome?.kill()
    await sleep(600)
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
    await prisma.$disconnect()
    if (failures.length) process.exitCode = 1
  })
