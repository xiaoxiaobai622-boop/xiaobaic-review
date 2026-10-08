import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/encryption'

/**
 * 录首页首屏那段产品视频：把本地演示数据里的审片页真跑一遍（播片 → 悬批注钉出帧预览气泡 →
 * 点一枚钉跳帧），用 CDP `Page.startScreencast` 逐帧收下来，ffmpeg 拼成 public/home/hero.mp4，
 * 首帧另存 public/home/hero-poster.jpg 当海报。
 *
 * 为什么是录屏而不是拿素材片凑：frame.io 首屏那枚的 aria-label 就叫「Frame.io 界面视频」，
 * 他要看的界面是我们自己的审片页，混进来的风光片证明不了任何事。
 *
 * 帧是浏览器按重绘节奏推过来的，不是定频，所以拼片时按 metadata.timestamp 实测出真实帧率，
 * 再让 ffmpeg 用 fps 滤镜重采样到 30（不够的帧复制、多的丢掉），别假装它是 24fps 拍出来的。
 *
 * 登录只在浏览器里做（会话指纹绑设备头＋UA，Node 侧令牌在浏览器一刷就烧掉整枚会话）。
 * 口令：设了 HOME_DEMO_PASSWORD 就用它；没设就当场改一枚随机的，只在本次进程里用，不落文件。
 *
 *   npx tsx --env-file=.env scripts/capture-home-movie.mts
 *   npx tsx --env-file=.env scripts/capture-home-movie.mts --dry      # 只收帧与实测，不写 public/home
 */
const BASE = process.env.SHARE_CHECK_BASE || 'http://localhost:3000'
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const DRY = process.argv.includes('--dry')
const EMAIL = 'home-demo@xiaobaic.local'
/** 起播那一秒：和首屏静帧同一处，片头字幕那条批注（00:03:12）刚过，画面里人和监视器都在。 */
const PARK_AT_SEC = 4.2
const OUT_W = 1920
const OUT_H = 1080
/** 目标帧率：演示源片就是 24fps 编的，收帧实测 17fps 上下，往 24 重采样比往 30 少造一倍空帧。 */
const ENC_FPS = 24
/** 录到第几秒喊停（判据那头发 10–16s 的窗口，这里取中间偏上，留出交互动作的时间）。 */
const RECORD_MS = Number(process.env.MOVIE_MS || 13_000)
const MP4 = 'public/home/hero.mp4'
const POSTER = 'public/home/hero-poster.jpg'

const prisma = new PrismaClient()
const stamp = Date.now()
const cdpPort = 9200 + (stamp % 600)
const userDataDir = join(tmpdir(), `home-movie-${stamp}`)
const frameDir = join(tmpdir(), `home-movie-frames-${stamp}`)
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
/** 事件按 method 分派；screencastFrame 走这里，其余事件先只记数。 */
const eventHandlers = new Map<string, (params: any) => void>()
const eventCount = new Map<string, number>()

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
    '--disable-gpu', '--disable-translate', '--lang=zh-CN', `--window-size=${OUT_W},${OUT_H}`,
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
        return
      }
      if (msg.method) {
        eventCount.set(msg.method, (eventCount.get(msg.method) || 0) + 1)
        eventHandlers.get(msg.method)?.(msg.params)
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
  await page.s('Emulation.setDeviceMetricsOverride', { width: OUT_W, height: OUT_H, deviceScaleFactor: 1, mobile: false })
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
/** 真实鼠标事件（不是合成 event），我们那套 hover 只认得这个。 */
async function hover(page: Page, x: number, y: number, ms = 500) {
  await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await sleep(ms)
}
async function click(page: Page, x: number, y: number) {
  await page.s('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await page.s('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}

async function loginInBrowser(page: Page, password: string) {
  const deviceId = `home-movie-${stamp}`
  await page.s('Page.addScriptToEvaluateOnNewDocument', {
    // next dev 的徽标（<nextjs-portal>）线上不存在，营销视频里更不该出现；theme 必须在第一个
    // 文档脚本期就钉成 dark，主题 bootstrap 也在这个时机跑，晚一步首屏就是浅色那套。
    source: `localStorage.setItem('vitransfer_device_id', ${JSON.stringify(deviceId)});
      localStorage.setItem('theme', 'dark');
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
  return String(await evalJs(page, `(async () => {
    const r = await fetch('/api/auth/login', { method: 'POST', cache: 'no-store',
      headers: { 'content-type': 'application/json', 'X-ViTransfer-Device-ID': ${JSON.stringify(deviceId)} },
      body: JSON.stringify({ email: ${JSON.stringify(EMAIL)}, password: ${JSON.stringify(password)} }) })
    const j = await r.json().catch(() => null)
    if (j?.tokens?.refreshToken) localStorage.setItem('vitransfer_refresh_token', j.tokens.refreshToken)
    return r.status + ' ' + (j?.tokens?.refreshToken ? 'session' : JSON.stringify(j?.error ?? '').slice(0, 120))
  })()`))
}

/** 片子停到指定秒并暂停；等 seek 真落地，不然第一帧是黑的。 */
async function parkAt(page: Page, sec: number) {
  await evalJs(page, `(() => {
    const v = document.querySelector('video')
    if (!v) throw new Error('没有 video 元素')
    v.muted = true
    if (Math.abs(v.currentTime - ${sec}) > 0.02) v.currentTime = ${sec}
    v.pause()
    return v.readyState
  })()`)
  if (!await waitFor(page, `document.querySelector('video') && document.querySelector('video').currentTime > ${(sec - 0.05).toFixed(3)} && document.querySelector('video').paused`)) return false
  await sleep(900)
  return true
}

/** 时间轴上第 i 枚批注标记的屏幕中心（这套 UI 里唯一带 data-testid 的批注锚点）。 */
async function markerAt(page: Page, i: number) {
  return JSON.parse(String(await evalJs(page, `(() => {
    const bs = [...document.querySelectorAll('button[data-testid="comment-marker"]')].filter(b => b.offsetParent !== null)
    const b = bs[${i}] || bs[0]
    if (!b) return JSON.stringify({})
    const r = b.getBoundingClientRect()
    return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: b.getAttribute('aria-label') || '', total: bs.length })
  })()`)))
}

/** 帧预览气泡：只认带 <video> 那一层，并等它的 spinner 撤掉（解码没完就悬上去，拍到的是转圈）。 */
async function waitBubbleIdle(page: Page, timeoutMs: number) {
  const probe = `(() => {
    const b = [...document.querySelectorAll('div')].find(e =>
      typeof e.className === 'string' && e.className.includes('bg-black/95') && e.querySelector('video'))
    if (!b) return JSON.stringify({ found: false })
    return JSON.stringify({ found: true, spin: !!b.querySelector('.animate-spin'),
      cur: Math.round(b.querySelector('video').currentTime * 100) / 100,
      label: (b.textContent || '').trim().slice(-18) })
  })()`
  const start = Date.now()
  let last = { found: false, spin: true }
  for (;;) {
    last = JSON.parse(String(await evalJs(page, probe)))
    if (!last.found || !last.spin || Date.now() - start > timeoutMs) return last
    await sleep(300)
  }
}

/** 悬一枚钉至少要留这么多时间才动它：400ms 移过去 + 最多 4s 等气泡解码 + 1.4s 定住让人看清。 */
const MARK_MS = 3_400

/**
 * 开录 → 演一遍 → 停录。帧落盘成 %05d.jpg，另存一份时间戳序列，拼接时按实测帧率重采样。
 *
 * 时间预算全按剩余时间算，不按「第几步」算：悬一枚钉带解码要 3.4s，上一版按第几步走，
 * 结果第一枚钉的解码等满了 5 秒，剩下的 11 秒画面是停着的。
 *
 * 点批注钉会把片子暂停（VideoPlayer 里那条 pauseVideoForComment 就是这么设计的），
 * 所以点完要按空格用界面自己的开关接着放——直接 v.play() 会被 React 那侧的 pausePlayback 按回去，
 * 实测那样收在 3.51s 一动不动。
 */
async function record(page: Page) {
  mkdirSync(frameDir, { recursive: true })
  let n = 0
  const times: number[] = []
  eventHandlers.set('Page.screencastFrame', (p: any) => {
    n += 1
    times.push(p.metadata?.timestamp ?? 0)
    try { writeFileSync(join(frameDir, `${String(n).padStart(5, '0')}.jpg`), Buffer.from(p.data, 'base64')) } catch { /* 磁盘问题下面按帧数判红 */ }
    // 不 ack 的话 Chrome 攒满一小 buffers 就不再推帧了。
    send('Page.screencastFrameAck', { sessionId: p.sessionId }, page.sessionId).catch(() => null)
  })
  const readVideo = async () => JSON.parse(String(await evalJs(page, `(() => { const v = document.querySelector('video'); return v ? JSON.stringify({
    paused: v.paused, cur: Math.round(v.currentTime * 100) / 100, ready: v.readyState }) : '{"cur":-1}' })()`)))
  const play = () => evalJs(page, `(() => { const v = document.querySelector('video'); v.muted = true; v.play(); return true })()`)
  // 空格走的是审片页自己那套快捷键（window 上的 capture keydown），界面状态和画面一起对得上。
  // 先把焦点从那枚钉上摘掉：焦点留在 <button> 上时，空格抬起会再点它一次，又给暂停回去。
  const pressSpace = async () => {
    await evalJs(page, `(() => { const a = document.activeElement; if (a && a.blur) a.blur(); return true })()`)
    await page.s('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Space', key: ' ', windowsVirtualKeyCode: 32 })
    await page.s('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Space', key: ' ', windowsVirtualKeyCode: 32 })
  }

  await page.s('Page.bringToFront')
  // 先按播放再开录：起幅那一帧就得是「正在放」的样子（图标 ❚❚）。反过来先录后播，
  // 首帧是停着的 ▶、中段是 ❚❚、循环回到开头又翻成 ▶——接缝那里每 13 秒眨一下。
  await play()
  await sleep(600)
  await page.s('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: OUT_W, maxHeight: OUT_H, everyNthFrame: 1 })

  const clock = Date.now()
  const left = () => RECORD_MS - (Date.now() - clock)
  const beats: string[] = []

  const hoverMarker = async (i: number) => {
    if (left() < MARK_MS) return
    const m = await markerAt(page, i)
    if (!m.x) return
    await hover(page, m.x, m.y, 400)
    const b = await waitBubbleIdle(page, 4_000)
    // 气泡解码完了再定一会儿：上一版一解码完就挪走，成片里那一格还是个转圈的框。
    await hover(page, m.x, m.y, 1_400)
    beats.push(`悬 #${i} ${m.label}`)
    console.log(`  悬钉 #${i} → ${m.label}｜气泡 ${JSON.stringify(b)}｜剩 ${Math.round(left())}ms`)
  }

  await hoverMarker(2)
  await hoverMarker(1)

  // 点一枚钉：画面跳到那条意见的落点、右侧批注跟着选中——这是「意见落在画面上」的实证。
  if (left() > 2200) {
    const m0 = await markerAt(page, 0)
    if (m0.x) {
      await click(page, m0.x, m0.y)
      // 跳帧那一刻主画面会亮一下缓冲圈，等它过去再接着放，成片里就不带转圈的格子。
      await sleep(600)
      const jumped = await readVideo()
      await pressSpace()
      await sleep(600)
      const resumed = await readVideo()
      beats.push(`点 #0 跳到 ${jumped.cur}s`)
      console.log(`  点钉 #0 → ${m0.label}｜跳到 ${jumped.cur}s（paused=${jumped.paused}）→ 空格接上 → ${resumed.cur}s（paused=${resumed.paused}）`)
    }
  }

  await hoverMarker(3)
  if (left() > 0) await sleep(left())
  const tail = await readVideo()
  await page.s('Page.stopScreencast')
  eventHandlers.delete('Page.screencastFrame')

  const files = readdirSync(frameDir).filter(f => f.endsWith('.jpg')).sort()
  const span = (times[times.length - 1] || 0) - (times[0] || 0)
  const fps = files.length > 1 ? (files.length - 1) / span : 0
  return { files: files.length, span, fps, beats, tail }
}

async function main() {
  const project = await prisma.project.findFirst({
    where: { team: { slug: 'home-demo' } }, orderBy: { createdAt: 'desc' }, select: { id: true, title: true },
  })
  const video = await prisma.video.findFirst({
    where: { project: { team: { slug: 'home-demo' } } }, orderBy: { version: 'desc' },
    select: { name: true, version: true, duration: true },
  })
  check(Boolean(project && video), '演示数据在本地库里齐了',
    `→ 项目「${project?.title}」素材「${video?.name}」v${video?.version}，时长 ${video?.duration}s`)
  if (!project || !video) throw new Error('先跑 npx tsx --env-file=.env scripts/build-home-demo.mts')
  // 演示片得比录制窗口长，不然录到一半片子自己走完、画面定格。
  check(video.duration >= PARK_AT_SEC + RECORD_MS / 1000 + 2, `演示片时长 ${video.duration}s 够录 ${RECORD_MS / 1000}s`, '→ 不够就换 uploads/marketing-src/ 里更长的那条')

  const REVIEW_URL = `/studio/projects/${project.id}/share?video=${encodeURIComponent(video.name)}`
  const password = process.env.HOME_DEMO_PASSWORD || randomBytes(9).toString('base64url')
  if (!process.env.HOME_DEMO_PASSWORD) {
    await prisma.user.update({ where: { email: EMAIL }, data: { password: await hashPassword(password) } })
  }

  chrome = await connectChrome()
  const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then(r => r.json())
  await attachSocket(webSocketDebuggerUrl)
  const page = await openPage()
  console.log('登录：', await loginInBrowser(page, password))
  await run(page, REVIEW_URL)
  await waitFor(page, `!document.querySelector('video')`, 60_000)
  check(await waitFor(page, `document.querySelector('video') && document.querySelector('video').videoWidth > 0`, 90_000), '审片页画出视频了')
  check(await parkAt(page, PARK_AT_SEC), `片子停在 ${PARK_AT_SEC} 秒`)

  const stage = JSON.parse(String(await evalJs(page, `(() => {
    const v = document.querySelector('video')
    const b = v.getBoundingClientRect()
    return JSON.stringify({
      innerWidth, innerHeight: innerHeight, video: [Math.round(b.width), Math.round(b.height)],
      pins: [...document.querySelectorAll('button[data-testid="comment-marker"]')].filter(e => e.offsetParent !== null).length,
      scrollH: document.documentElement.scrollHeight,
      devBadge: [...document.querySelectorAll('nextjs-portal')].some(e => e.getBoundingClientRect().width > 0 && getComputedStyle(e).display !== 'none'),
    })
  })()`)))
  console.log('取景：', JSON.stringify(stage))
  check(stage.pins >= 3, `时间轴上有 ${stage.pins} 枚批注标记可悬可点`)
  check(stage.scrollH <= stage.innerHeight + 2, '这一档视口里审片页不出滚动条', `→ scrollH ${stage.scrollH} / 视口 ${stage.innerHeight}`)
  check(stage.devBadge === false, 'next dev 徽标不在画面里')

  const rec = await record(page)
  const frame0 = join(frameDir, rec.files ? `${String(1).padStart(5, '0')}.jpg` : '')
  const dims = rec.files ? await (await import('sharp')).default(frame0).metadata() : null
  check(rec.files >= 120, `收到 ${rec.files} 帧（${rec.span.toFixed(2)}s → 实测 ${rec.fps.toFixed(1)} fps）`,
    dims ? `→ 单帧 ${dims.width}×${dims.height}` : '')
  check(rec.fps >= 14, `实测帧率 ${rec.fps.toFixed(1)}fps 够用（低于 14 就调低 screencast 的 quality 或尺寸）`)
  check(rec.tail.paused === false && rec.tail.cur > PARK_AT_SEC,
    `收尾时还在放（${rec.tail.cur}s，起幅 ${PARK_AT_SEC}s），画面没有中途定格`, JSON.stringify(rec.tail))
  console.log('演到的动作：', rec.beats.join(' ｜ ') || '（一枚都没悬上）')
  check(Boolean(dims) && dims!.width === OUT_W && dims!.height === OUT_H, `单帧尺寸 ${dims?.width}×${dims?.height} 与视口一致`)
  if (rec.files < 120 || !dims) throw new Error('帧数不够或尺寸不对，先别拼片')

  // 海报直接取成片的第一帧：另截一张必然和第一帧差一点，加载那一瞬会闪一下。
  if (!DRY) {
    const sharp = (await import('sharp')).default
    await sharp(frame0).jpeg({ quality: 88, mozjpeg: true }).toFile(POSTER)
    const pm = await sharp(POSTER).metadata()
    check(pm.width === OUT_W && pm.height === OUT_H, `海报 ${pm.width}×${pm.height} 与成片同尺寸`)
    check(statSync(POSTER).size < 400 * 1024, `海报 ${(statSync(POSTER).size / 1024).toFixed(0)}KB`, '→ 首屏加载前铺的那张，太大就拖 LCP')
  }

  const mp4 = DRY ? '/tmp/hero-dry.mp4' : MP4
  execFileSync('ffmpeg', [
    '-v', 'error', '-y',
    // 按实测帧率喂帧，再重采样到 ENC_FPS：不这么写会把 17fps 的收帧当成 24fps 播，快一倍半。
    '-framerate', rec.fps.toFixed(4), '-i', join(frameDir, '%05d.jpg'),
    '-vf', `fps=${ENC_FPS},scale=${OUT_W}:${OUT_H}:flags=lanczos,setsar=1`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '30', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', '-an', mp4,
  ], { stdio: 'inherit' })
  const bytes = statSync(mp4).size
  const dur = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4], { encoding: 'utf8' }).trim()
  const audio = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', mp4], { encoding: 'utf8' }).trim()
  check(bytes < 3 * 1024 * 1024, `hero.mp4 ${(bytes / 1024 / 1024).toFixed(2)}MB < 3MB`)
  check(Number(dur) >= 10 && Number(dur) <= 16, `成片时长 ${Number(dur).toFixed(1)}s 落在 10–16s`)
  check(audio === '', '没有音轨', audio)
  if (DRY) console.log('DRY：没写 public/home')
  else console.log(`出片：${mp4}（${(bytes / 1024).toFixed(0)}KB / ${Number(dur).toFixed(1)}s）＋ ${POSTER}`)

  await page.s('Target.closeTarget', { targetId: page.targetId }).catch(() => null)
}

main()
  .catch(e => { console.log('运行失败：', String(e?.message ?? e).slice(0, 400)); failures.push('run') })
  .finally(async () => {
    chrome?.kill()
    await sleep(600)
    for (const dir of [userDataDir, frameDir]) {
      try { rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }) } catch { /* 临时目录留着自己会被系统清 */ }
    }
    await prisma.$disconnect()
    console.log(failures.length ? `\n${failures.length} 条 FAIL：${failures.join('；')}` : '\n全部 PASS')
    if (failures.length) process.exitCode = 1
  })
