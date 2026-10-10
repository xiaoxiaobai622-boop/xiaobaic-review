import { spawn, type ChildProcess } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/encryption'
import { getRedis } from '../src/lib/redis'

/**
 * 审片播放器「转圈」的浏览器实测。
 *
 * `scripts/check-playback-drift.mts` 测的是纯函数规则本身；这条测的是规则接进播放器
 * 之后界面上真的发生了什么。之前所有浏览器判据用的素材夹具把 `originalStoragePath`
 * 写成盘上根本不存在的对象，`/api/content/{token}` 取不到字节，`<video>` 一秒也没播过
 * —— 于是既量不到卡住，也量不到他报的那句「正常播放但圈还在转」。这一枚先把
 * `scripts/fixtures/film-set.mp4`（39.4 秒、faststart、960×506）真复制进本地存储根，
 * 再从访客短链一路点到播放器，页内 50 毫秒采样 `aria-busy` 与播放头。
 *
 * 两个阶段：A 快网看真播（推进中不许有圈 + 流畅度基线），B 全程限速 40KB/s 制造真卡住
 * （卡住时圈必须在，恢复供数之后 1.5 秒内必须彻底关掉）。
 *
 * 说清证不到什么：本机是 `STORAGE_PROVIDER=local`，`supportsHls` 只在 s3 为真，本地没有
 * HLS 分片可切；换素材/换版本都会先 `pausePlayback()` 清空 pendingSeek，
 * `getPendingSeekTarget` 又把目标钳在时长之内 —— 「带着 pendingSeek 的漂移」那条分支在本地到不了，
 * 那一条只有纯函数判据覆盖。
 *
 * A/B 实测（同一枚夹具、同一台机器，只把 VideoPlayer.tsx 换回修复前那版再跑一遍）：
 *   P15 恢复供数后画面重走 —— 修复前 49 个推进采样全带圈（就是「画面在动、圈还在转」），修复后 0/49；
 *   P11 点完时间轴之后 —— 修复前播放头一动没动（画面停在落点），修复后 49 个推进采样且不带圈；
 *   P7  快网 6 秒窗口 —— 修复前只走 2.93s，修复后走 6.62s。
 * 卡住段的反馈覆盖率两版一样（948ms 那段 13/23、350ms 那段 0/8），所以那条只报数不闸门。
 */
const BASE = process.env.PLAYER_CHECK_BASE || 'http://localhost:3000'
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const CLIP = 'scripts/fixtures/film-set.mp4'
// 与 src/lib/storage.ts 同一个开关：本地模式下这就是盘上的素材根。
const STORAGE_ROOT = resolve(process.env.STORAGE_ROOT || './uploads')
const CLIP_SECONDS = 39.417
// 40KB/s < 这条素材约 60KB/s 的码率 ⇒ 播得起来但撑不住，正好落在「一会儿走一会儿停」。
const SLOW_BYTES_PER_SEC = 40_000

const prisma = new PrismaClient()
const redis = getRedis()
const stamp = Date.now()
const failures: string[] = []
const teamSlug = `spin-${stamp}`
const ownerEmail = `spin-${stamp}@example.invalid`
const pw = `spin-${stamp}`
const clipRel = `spin/${stamp}/film.mp4`
const clipAbs = join(STORAGE_ROOT, clipRel)
const cdpPort = 9300 + (stamp % 600)
const userDataDir = join(tmpdir(), `spin-${stamp}`)
const tokens: string[] = []
let chrome: ChildProcess | undefined

function check(ok: boolean, label: string, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` → ${detail}` : ''}`)
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function call(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

// ── CDP 客户端（Node 内置 WebSocket，零依赖）────────────────────────────
let ws: WebSocket | undefined
let msgId = 0
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
const listeners = new Set<(method: string, params: any, sessionId?: string) => void>()

function send(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
  const id = ++msgId
  return new Promise<any>((resolveSend, reject) => {
    pending.set(id, { resolve: resolveSend, reject })
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
    '--autoplay-policy=no-user-gesture-required', '--mute-audio',
    '--disable-gpu', '--disable-translate', '--lang=zh-CN', '--window-size=1440,900',
  ], { stdio: 'ignore' })
  for (let i = 0; i < 60; i++) {
    if (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then(r => r.ok).catch(() => false)) return proc
    await sleep(500)
  }
  proc.kill()
  throw new Error('无头 Chrome 没起来')
}

function attachSocket(url: string) {
  return new Promise<void>((resolveSocket, reject) => {
    ws = new WebSocket(url)
    ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data))
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id)!
        pending.delete(msg.id)
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error)))
        else p.resolve(msg.result)
      } else if (msg.method) {
        for (const l of listeners) l(msg.method, msg.params, msg.sessionId)
      }
    }
    ws.onerror = () => reject(new Error('CDP WebSocket 连接失败'))
    ws.onopen = () => resolveSocket()
  })
}

async function openPage() {
  const { browserContextId } = await send('Target.createBrowserContext', { disposeOnDetach: true })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const page = {
    browserContextId, targetId, sessionId,
    requests: [] as string[],
    statuses: new Map<string, number>(),
    s: (method: string, params: Record<string, unknown> = {}) => send(method, params, sessionId),
  }
  pages.set(sessionId, page)
  await page.s('Page.enable')
  await page.s('Runtime.enable')
  await page.s('Network.enable')
  await page.s('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  return page
}

type Page = Awaited<ReturnType<typeof openPage>>
const pages = new Map<string, Page>()

const listener = (method: string, params: any, sessionId?: string) => {
  const page = pages.get(sessionId ?? '')
  if (!page) return
  if (method === 'Network.requestWillBeSent') page.requests.push(params.request.url)
  if (method === 'Network.responseReceived') page.statuses.set(params.response.url, params.response.status)
}

async function evalJs(page: Page, expression: string) {
  const r = await page.s('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(`页面 JS 异常：${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
  return r.result.value
}

async function waitFor(page: Page, expression: string, timeoutMs = 30_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await evalJs(page, `(() => { try { return (${expression}) ? true : false } catch { return false } })()`)) return true
    await sleep(300)
  }
  return false
}

const VIDEO_SEL = '[data-tutorial="video-player"] video'
const VIDEO = `document.querySelector('${VIDEO_SEL}')`

/**
 * 页内采样器，装在新文档开头：它必须赶上 `<video>` 挂上那一刻，晚一步就漏掉首帧之前
 * 那段真正的等待。圈的状态只读 React 提交到 DOM 的两样东西 —— 播控容器的 `aria-busy`
 * 和那层 `role="status"` 里的旋转图标，不读组件内部状态。
 *
 * 整段包在 try 里并把异常记进 `__probe.err`：这段跑在文档最开头，`documentElement`
 * 还没 guaranteed 存在（第一版就是被 MutationObserver 的 null target 打断，采样列表
 * 全程空，而界面本身一切正常 —— 空列表看着像「没卡住」，其实是探针没跑）。
 */
const PROBE = `
window.__probe = { samples: [], events: [], video: null, t0: performance.now(), err: [] }
try {
  const probeBusy = () => {
    const surface = document.querySelector('[data-tutorial="video-player"]')
    if (!surface) return { busy: false, overlay: false }
    const box = surface.querySelector('[aria-busy]')
    return {
      busy: !!box && box.getAttribute('aria-busy') === 'true',
      overlay: !!surface.querySelector('[role="status"] .animate-spin'),
    }
  }
  const probePush = (list, cap, row) => {
    list.push(row)
    if (list.length > cap) list.splice(0, list.length - cap)
  }
  const probeAttach = (v) => {
    if (window.__probe.video === v) return
    window.__probe.video = v
    for (const name of ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'playing', 'pause',
      'waiting', 'stalled', 'seeking', 'seeked', 'ended', 'error']) {
      v.addEventListener(name, () => {
        const b = probeBusy()
        probePush(window.__probe.events, 4000, {
          ev: name, ms: Math.round(performance.now() - window.__probe.t0), t: Number(v.currentTime.toFixed(3)),
          paused: v.paused, rs: v.readyState, busy: b.busy, overlay: b.overlay,
        })
      }, true)
    }
  }
  const probeScan = () => {
    const v = document.querySelector('[data-tutorial="video-player"] video')
    if (!v) return
    probeAttach(v)
    const b = probeBusy()
    const bufferedEnd = v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0
    probePush(window.__probe.samples, 8000, {
      ms: Math.round(performance.now() - window.__probe.t0), t: Number(v.currentTime.toFixed(3)),
      paused: v.paused, rs: v.readyState, bufferedEnd: Number(bufferedEnd.toFixed(2)),
      busy: b.busy, overlay: b.overlay,
    })
  }
  if (document.documentElement) {
    new MutationObserver(probeScan).observe(document.documentElement, { childList: true, subtree: true })
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      new MutationObserver(probeScan).observe(document.documentElement, { childList: true, subtree: true })
    })
  }
  setInterval(probeScan, 50)
} catch (e) {
  window.__probe.err.push(String(e && e.message || e).slice(0, 200))
}
window.addEventListener('error', (e) => window.__probe.err.push('onerror ' + String(e.message).slice(0, 160)))
`

type Sample = { ms: number; t: number; paused: boolean; rs: number; bufferedEnd: number; busy: boolean; overlay: boolean }

async function clock(page: Page) {
  return Number(await evalJs(page, 'Math.round(performance.now() - window.__probe.t0)'))
}

async function samples(page: Page, fromMs: number, toMs = Number.MAX_SAFE_INTEGER) {
  const all = JSON.parse(String(await evalJs(page, 'JSON.stringify(window.__probe.samples)'))) as Sample[]
  return all.filter(s => s.ms >= fromMs && s.ms <= toMs)
}

async function events(page: Page) {
  return JSON.parse(String(await evalJs(page, 'JSON.stringify(window.__probe.events)'))) as Array<Record<string, any>>
}

/** 相邻采样的播放头差：>0.02 秒才算「画面真的在走」，等于 0 就是卡住。 */
function advancing(window: Sample[]) {
  const out: Sample[] = []
  for (let i = 1; i < window.length; i += 1) {
    if (!window[i].paused && window[i].t - window[i - 1].t > 0.02) out.push(window[i])
  }
  return out
}

/**
 * 一段「真卡住」：连续若干采样里播放头一动没动，且跨度 ≥minMs。
 * 头 100 毫秒不算，React 把 `aria-busy` 提交到 DOM 本身要一两帧。
 */
function stallSpans(window: Sample[], minMs = 400) {
  const spans: Sample[][] = []
  let cur: Sample[] = []
  for (let i = 1; i < window.length; i += 1) {
    if (window[i].t - window[i - 1].t > 0.02) {
      if (cur.length) spans.push(cur)
      cur = []
    } else {
      cur.push(window[i])
    }
  }
  if (cur.length) spans.push(cur)
  return spans
    .filter(s => s.length >= 2 && s[s.length - 1].ms - s[0].ms >= minMs)
    .map(s => s.filter(x => x.ms - s[0].ms >= 100))
}

async function setThrottle(page: Page, throughput: number | null) {
  await page.s('Network.emulateNetworkConditions', throughput === null
    ? { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }
    : { offline: false, latency: 0, downloadThroughput: throughput, uploadThroughput: 12_000 })
}

/**
 * 真鼠标事件：点视频中央＝产品自己的 togglePlayback，点时间轴＝产品自己的 seek。
 * `find` 是一段求值到元素的 JS 表达式（素材卡不是 CSS 选择器能点名的：网格里第一枚
 * button 是「下载全部」，卡片得按名字找）。
 */
async function clickCenter(page: Page, find: string, xRatio = 0.5) {
  // 先把它滚到视口中线：网格上方有吸顶条，贴着顶边的卡片会被吸顶条接走这次点击。
  await evalJs(page, `(() => { const el = ${find}; if (el) el.scrollIntoView({ block: 'center' }); return !!el })()`)
  await sleep(400)
  const geo = JSON.parse(String(await evalJs(page, `(() => {
    const el = ${find}
    if (!el) return 'null'
    const b = el.getBoundingClientRect()
    const x = b.x + b.width * ${xRatio}
    const y = b.y + b.height / 2
    const hit = document.elementFromPoint(x, y)
    const reached = !!hit && (hit === el || el.contains(hit) || hit.contains(el))
    return JSON.stringify([x, y, reached, hit ? hit.tagName.toLowerCase() + '.' + String(hit.className || '').slice(0, 46) : 'none'])
  })()`))) as [number, number, boolean, string] | null
  if (!geo) return { ok: false, detail: '元素没画出来' }
  const [x, y, reached, hitLabel] = geo
  if (!reached) return { ok: false, detail: `点击点被 ${hitLabel} 接走` }
  // 播控条会随空闲淡出，先送一次移动把它叫醒，再落按下/抬起。
  await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await sleep(120)
  for (const type of ['mousePressed', 'mouseReleased']) {
    await page.s('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
  }
  return { ok: true, detail: `${x.toFixed(0)},${y.toFixed(0)}` }
}

/** 素材卡：按夹具那条素材的名字找，别按位置猜。 */
const cardFind = (name: string) =>
  `[...document.querySelectorAll('[data-tutorial="video-grid"] button')].find(b => (b.textContent || '').includes(${JSON.stringify(name)}))`

async function clickTimelineAt(page: Page, fraction: number) {
  const clicked = await clickCenter(page, `document.querySelector('[data-testid="video-timeline"]')`, fraction)
  if (!clicked.ok) {
    console.log(`  时间轴没点到 → ${clicked.detail}`)
    return null
  }
  return fraction * CLIP_SECONDS
}

async function shot(page: Page, name: string, clip: { x: number; y: number; width: number; height: number }) {
  const dir = process.env.SHOT_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  const { data } = await page.s('Page.captureScreenshot', { clip: { ...clip, scale: 2 } })
  writeFileSync(join(dir, `${name}.png`), Buffer.from(data, 'base64'))
  console.log(`截图 → ${dir}/${name}.png`)
}

try {
  // ── 夹具：盘上真存在的一枚 mp4，库里记的字节数就是盘上的字节数 ──────────
  const clipBytes = statSync(CLIP).size
  mkdirSync(dirname(clipAbs), { recursive: true })
  copyFileSync(CLIP, clipAbs)
  check(statSync(clipAbs).size === clipBytes, 'P1 夹具素材复制进本地存储根（旧夹具指的是盘上压根没有的对象）',
    `→ ${clipRel} ${clipBytes} 字节`)

  const owner = await prisma.user.create({
    data: { email: ownerEmail, name: 'spinner', password: await hashPassword(pw), phone: `139${String(stamp).slice(-8)}` },
  })
  const team = await prisma.team.create({
    data: {
      name: teamSlug, slug: teamSlug, shareKey: teamSlug, createdById: owner.id, subscriptionPlan: 'BETA',
      members: { create: { userId: owner.id, role: 'OWNER', status: 'ACTIVE' } },
    },
  })
  const project = await prisma.project.create({
    data: { teamId: team.id, createdById: owner.id, projectCode: `S${stamp}`, title: `spin-${stamp}`, slug: `sp-${stamp}`, shareSlug: `ss-${stamp}` },
  })
  const video = await prisma.video.create({
    data: {
      projectId: project.id, name: 'film', version: 1, versionLabel: 'v1',
      originalFileName: 'film.mp4', originalFileSize: BigInt(clipBytes), originalStoragePath: clipRel,
      duration: CLIP_SECONDS, width: 960, height: 506, fps: 24, status: 'READY', approved: true,
    },
  })

  const login = await call('POST', '/api/auth/login', '', { email: ownerEmail, password: pw })
  const adminToken = login.json?.tokens?.accessToken as string | undefined
  if (!adminToken) throw new Error(`登录失败 → ${login.status}`)
  tokens.push(adminToken)
  const created = await call('POST', `/api/projects/${project.id}/share-links`, adminToken, {
    name: '转圈实测', scopeType: 'PROJECT', authMode: 'NONE', permissions: ['view', 'comment'],
  })
  const code = created.json?.shareLink?.token as string | undefined
  if (!code) throw new Error(`建链接失败 → ${created.status} ${JSON.stringify(created.json)}`)

  // dev 冷路由实测 20–35 秒：不预热就进浏览器，量到的第一个圈是 webpack 不是播放。
  const warmStarted = Date.now()
  const warm = await fetch(`${BASE}/${code}`, { cache: 'no-store' }).catch(() => null)
  console.log(`预热 /${code} → ${warm?.status ?? 'ERR'}（${Date.now() - warmStarted}ms）`)

  chrome = await connectChrome()
  const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then(r => r.json())
  await attachSocket(webSocketDebuggerUrl)
  listeners.add(listener)

  // ── A 阶段：快网，证素材真能播 + 推进中不许有圈 ─────────────────────────
  const page = await openPage()
  await page.s('Page.addScriptToEvaluateOnNewDocument', { source: PROBE })
  await page.s('Page.navigate', { url: `${BASE}/${code}` })
  const gridReady = await waitFor(page, cardFind('film'), 120_000)
  const cardTexts = String(await evalJs(page, `JSON.stringify([...document.querySelectorAll('[data-tutorial="video-grid"] button')].map(b => (b.textContent || '').trim().slice(0, 44)))`))
  check(gridReady, 'P2 访客打开短链，网格里画出夹具那条素材（建行没成功就只有一枚空壳）', gridReady ? '' : `→ 格子里是 ${cardTexts}`)

  const openedAt = Date.now()
  const gridClick = await clickCenter(page, cardFind('film'))
  check(await waitFor(page, VIDEO, 90_000), 'P3 单击素材卡挂出播放器',
    `→ ${Date.now() - openedAt}ms，点击 ${gridClick.ok ? gridClick.detail : `没落地：${gridClick.detail}`}`)
  const durationOk = await waitFor(page, `(() => { const v = ${VIDEO}; return !!v && Number.isFinite(v.duration) && v.duration > 30 })()`, 60_000)
  const realDuration = Number(await evalJs(page, `(() => { const v = ${VIDEO}; return v ? v.duration : -1 })()`))
  check(durationOk, 'P4 素材真的解出时长（旧夹具永远拿到 NaN，这条就是它播不起来的证明）', `→ ${realDuration.toFixed(3)}s`)

  const mediaRequests = page.requests.filter(u => u.includes('/api/content/'))
  const mediaStatuses = mediaRequests.map(u => page.statuses.get(u)).filter(Boolean)
  check(mediaRequests.length > 0 && mediaStatuses.some(s => s === 200 || s === 206),
    'P5 字节走 /api/content/{token} 且服务端认 Range', `→ ${JSON.stringify(mediaStatuses)}`)

  // 探针自己也要作证：采样列表空着的时候，下面每一条「没看到圈」都是假绿。
  const probeAlive = await waitFor(page, `window.__probe.samples.length > 20 && window.__probe.video`, 20_000)
  const probeErr = String(await evalJs(page, 'JSON.stringify(window.__probe.err)'))
  check(probeAlive && probeErr === '[]', 'P5b 采样探针真在跑（>20 点且零异常；探针哑了这页读数一律不算）',
    `→ err ${probeErr}`)

  const playMark = await clock(page)
  await clickCenter(page, VIDEO)
  const running = await waitFor(page, `(() => { const v = ${VIDEO}; return !!v && v.currentTime > 0.4 && !v.paused })()`, 30_000)
  const firstMove = await samples(page, playMark)
  const moved = firstMove.find(s => s.t > 0.4)
  check(running, 'P6 点视频中央（产品自己的 togglePlayback）之后真的播起来了',
    moved ? `→ 首帧推进 ${moved.ms - playMark}ms` : '')

  await sleep(6_000)
  const fastWindow = await samples(page, playMark)
  const fastAdvance = advancing(fastWindow)
  const fastSpan = fastWindow.length > 1 ? fastWindow[fastWindow.length - 1].t - fastWindow[0].t : 0
  check(fastAdvance.length >= 10, 'P7 快网窗口真抓到推进中的采样（少于 10 点下面那条就是空转假绿）',
    `→ ${fastAdvance.length} 个推进采样，6 秒走 ${fastSpan.toFixed(2)}s`)
  const wrongSpinner = fastAdvance.filter(s => s.busy || s.overlay)
  check(fastAdvance.length >= 10 && wrongSpinner.length === 0,
    'P8 播放头推进的采样点上没有转圈（他报的那句「正常播放但圈还在转」）',
    `→ 推进 ${fastAdvance.length} 采样，带圈 ${wrongSpinner.length}${wrongSpinner.length ? `，第一次 t=${wrongSpinner[0].t}s / ${wrongSpinner[0].ms}ms` : ''}`)

  const fastBox = JSON.parse(String(await evalJs(page, `(() => {
    const el = document.querySelector('[data-tutorial="video-player"]')
    if (!el) return 'null'
    const b = el.getBoundingClientRect()
    return JSON.stringify([b.x, b.y, b.width, b.height])
  })()`))) as number[] | null
  if (fastBox) await shot(page, 'player-playing', { x: fastBox[0], y: fastBox[1], width: fastBox[2], height: Math.min(fastBox[3], 780) })

  // 真点时间轴跳转：走 CustomVideoControls 自己的 pointerdown/click，不直接写 currentTime。
  const seekMark = await clock(page)
  const seekTarget = await clickTimelineAt(page, 0.82)
  check(seekTarget !== null, 'P9 真点时间轴跳过去了（点不到就是被别的层接走，得说出来）')
  const landed = await waitFor(page, `(() => { const v = ${VIDEO}; return !!v && Math.abs(v.currentTime - ${((seekTarget ?? 0) + 0.4).toFixed(2)}) <= 0.9 })()`, 20_000)
  const landedSample = (await samples(page, seekMark)).find(s => s.t >= (seekTarget ?? 1e9) - 0.6)
  check(landed, 'P10 跳转真的落在目标附近（落不了地就是这条素材或这台机器不行了）',
    landedSample ? `→ ${landedSample.ms - seekMark}ms 落在 t=${landedSample.t}s` : '')
  await sleep(2_500)
  const afterSeek = await samples(page, seekMark)
  const seekAdvance = advancing(afterSeek.filter(s => s.ms > (landedSample?.ms ?? seekMark)))
  const seekSpinner = seekAdvance.filter(s => s.busy || s.overlay)
  check(seekAdvance.length >= 6 && seekSpinner.length === 0,
    'P11 跳转落地之后画面重新走动，转圈必须关掉（带着 pendingSeek 的这条路也要走到）',
    `→ 推进 ${seekAdvance.length} 采样，带圈 ${seekSpinner.length}，其中暂停 ${afterSeek.filter(s => s.paused).length} 点`)

  // ── B 阶段：换一页，从素材请求之前就开始限速 ⇒ 真卡住 ────────────────────
  const slow = await openPage()
  await slow.s('Page.addScriptToEvaluateOnNewDocument', { source: PROBE })
  await slow.s('Page.navigate', { url: `${BASE}/${code}` })
  check(await waitFor(slow, cardFind('film'), 120_000),
    'P12 限速页的网格照样画出来（静态资源没被限速挡死，卡住的只该是媒体）')
  await setThrottle(slow, SLOW_BYTES_PER_SEC)
  await clickCenter(slow, cardFind('film'))
  check(await waitFor(slow, VIDEO, 90_000), 'P13 限速下播放器照样挂出')

  const slowPlayMark = await clock(slow)
  await clickCenter(slow, VIDEO)
  await sleep(9_000)
  const slowWindow = await samples(slow, slowPlayMark)
  const spanFacts = stallSpans(slowWindow).map(s => ({
    ms: s[s.length - 1].ms - s[0].ms,
    points: s.length,
    spinner: s.filter(x => x.busy || x.overlay).length,
  }))
  const blind = spanFacts.filter(s => s.spinner / s.points < 0.8)
  const spanReport = spanFacts.map(s => `${s.ms}ms 带圈 ${s.spinner}/${s.points}`).join('，')
  check(spanFacts.length >= 1, 'P14 限速窗口里确实有一段 ≥400ms 画面没动的卡住（一段都没有就是这轮没造出真等待，下面那条不算）', `→ ${spanReport || '没有卡住段'}`)
  // 卡住段的反馈覆盖率只报数、不当闸门：修复前后实测都是同一副样子（948ms 那段 13/23、
  // 350ms 那段 0/8），说明「真卡住时反馈时有时无」是既有行为，不是这次改动带出来的，
  // 也不该被这次改动顺手按成绿。它作为编号问题单独报出去。
  console.log(`  卡住反馈 ↓ ${spanFacts.length} 段里 ${spanFacts.length - blind.length} 段全程有反馈；覆盖率 = ${spanReport || '无'}`)

  await setThrottle(slow, null)
  const resumeMark = await clock(slow)
  const resumed = await waitFor(slow, `(() => { const v = ${VIDEO}; return !!v && !v.paused && v.readyState >= 4 })()`, 40_000)
  await sleep(2_500)
  const afterResume = await samples(slow, resumeMark)
  const resumeAdvance = advancing(afterResume)
  const stillSpinning = resumeAdvance.filter(s => s.busy || s.overlay)
  check(resumed && resumeAdvance.length >= 8 && stillSpinning.length === 0,
    'P15 恢复供数、画面重新走动之后圈必须彻底关掉（这条就是修复本身）',
    `→ 推进 ${resumeAdvance.length} 采样，仍带圈 ${stillSpinning.length}${stillSpinning.length ? `，第一次 t=${stillSpinning[0].t}s` : ''}`)

  const slowBox = JSON.parse(String(await evalJs(slow, `(() => {
    const el = document.querySelector('[data-tutorial="video-player"]')
    if (!el) return 'null'
    const b = el.getBoundingClientRect()
    return JSON.stringify([b.x, b.y, b.width, b.height])
  })()`))) as number[] | null
  if (slowBox) await shot(slow, 'player-after-stall', { x: slowBox[0], y: slowBox[1], width: slowBox[2], height: Math.min(slowBox[3], 780) })

  // ── 流畅度基线：只报数，不当判据 ────────────────────────────────────────
  const fastEvents = await events(page)
  const slowEvents = await events(slow)
  const slowSpan = slowWindow.length > 1 ? slowWindow[slowWindow.length - 1].t - slowWindow[0].t : 0
  const resumeSpan = afterResume.length > 1 ? afterResume[afterResume.length - 1].t - afterResume[0].t : 0
  console.log('  流畅度 ↓')
  console.log(`    A 快网 ${Math.round((fastWindow.at(-1)?.ms ?? 0) - playMark) / 1000}s：waiting ${fastEvents.filter(e => e.ev === 'waiting').length} 次 / stalled ${fastEvents.filter(e => e.ev === 'stalled').length} 次，`
    + `播放头走 ${fastSpan.toFixed(2)}s，缓冲尾已到 ${fastWindow.at(-1)?.bufferedEnd ?? 0}s`)
  console.log(`    B 限速 9 秒：waiting ${slowEvents.filter(e => e.ev === 'waiting').length} 次，播放头只走 ${slowSpan.toFixed(2)}s（推进采样 ${advancing(slowWindow).length}）`)
  console.log(`    B 恢复供数 2.5 秒：播放头走 ${resumeSpan.toFixed(2)}s，推进采样 ${advancing(afterResume).length} 个`)
  const dump = { stamp, clip: clipRel, bytes: clipBytes, videoId: video.id, code, fast: { samples: fastWindow, events: fastEvents }, slow: { samples: slowWindow, resume: afterResume, events: slowEvents } }
  const dumpDir = process.env.SHOT_DIR || '.superpowers/sdd'
  mkdirSync(dumpDir, { recursive: true })
  writeFileSync(join(dumpDir, 'player-samples.json'), JSON.stringify(dump))
  console.log(`    原始采样 → ${dumpDir}/player-samples.json（${fastWindow.length + slowWindow.length + afterResume.length} 点）`)

  await send('Browser.close').catch(() => null)
} finally {
  chrome?.kill()
  rmSync(userDataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 })
  listeners.delete(listener)
  try { ws?.close() } catch { /* already closed */ }
  for (const t of tokens) {
    await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${t}` } }).catch(() => null)
  }
  const teamRow = await prisma.team.findFirst({ where: { slug: teamSlug }, select: { id: true } })
  if (teamRow) {
    const projectIds = (await prisma.project.findMany({ where: { teamId: teamRow.id }, select: { id: true } })).map(p => p.id)
    for (const pid of projectIds) {
      for (const key of await redis.keys('video_access:*')) {
        const raw = await redis.get(key)
        if (raw && String(JSON.parse(raw).projectId ?? '') === pid) await redis.del(key)
      }
      await prisma.shareLink.deleteMany({ where: { projectId: pid } })
      await prisma.sharePageAccess.deleteMany({ where: { projectId: pid } })
      await prisma.video.deleteMany({ where: { projectId: pid } })
    }
    await prisma.project.deleteMany({ where: { teamId: teamRow.id } })
    await prisma.team.deleteMany({ where: { id: teamRow.id } })
  }
  await prisma.user.deleteMany({ where: { email: ownerEmail } })
  rmSync(join(STORAGE_ROOT, 'spin'), { recursive: true, force: true })
  const left = {
    videos: await prisma.video.count({ where: { project: { team: { slug: teamSlug } } } }),
    teams: await prisma.team.count({ where: { slug: teamSlug } }),
    users: await prisma.user.count({ where: { email: ownerEmail } }),
    clip: existsSync(clipAbs),
  }
  console.log(`清场 → 剩 ${JSON.stringify(left)}`)
  check(Object.values(left).every(v => v === 0 || v === false), 'P16 夹具全部清干净（库、令牌、盘上那枚 mp4）')
  await prisma.$disconnect()
  await redis.quit().catch(() => null)
}

if (failures.length) {
  console.log(`\n${failures.length} 条未过：`)
  for (const f of failures) console.log(` - ${f}`)
  process.exit(1)
}
console.log('\n全部通过')
