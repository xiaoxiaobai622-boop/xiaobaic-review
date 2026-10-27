import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/encryption'
import { allocateTeamId } from '../src/lib/team-id'

/**
 * 10-26 他报的三条：筛选面板盖住卡片、卡片三点菜单盖住卡片、骨架屏提前出现。
 * 这条探针只取证不改代码：把弹层的几何、层叠上下文、祖先裁剪、逐行 computed style
 * 和骨架出现/消失的时间线原样打出来，红在哪一行由输出决定，不靠看图猜。
 *
 * 会往本地库建一次性 fixture，永远不进 CI。
 *   npx tsx scripts/check-overlay-occlusion.mts
 */
const BASE = process.env.SHARE_CHECK_BASE || 'http://localhost:3000'
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const prisma = new PrismaClient()
const stamp = Date.now()
const short = String(stamp).slice(-7)
const pw = `overlay-${stamp}`
const cdpPort = 9300 + (stamp % 600)
const userDataDir = join(tmpdir(), `overlay-${stamp}`)
const SHOT_DIR = '/tmp/overlay-shots'
let chrome: ChildProcess | undefined
const cleanupIds: { teamIds: string[]; userIds: string[] } = { teamIds: [], userIds: [] }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

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
    }, 90_000)
  })
}

async function connectChrome() {
  chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${userDataDir}`,
    '--remote-allow-origins=*', '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--disable-translate', '--lang=zh-CN', '--window-size=1440,900',
  ], { stdio: 'ignore' })
  for (let i = 0; i < 60; i++) {
    if (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then(r => r.ok).catch(() => false)) return
    await sleep(500)
  }
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
  await page.s('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
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
    await sleep(300)
  }
  return false
}

async function goto(page: Page, url: string, settle = 1200) {
  await page.s('Page.navigate', { url })
  await sleep(settle)
}

async function clickAt(page: Page, x: number, y: number) {
  const move = { type: 'mouseMoved', x, y }
  await page.s('Input.dispatchMouseEvent', move)
  await sleep(120)
  await page.s('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await sleep(80)
  await page.s('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  await sleep(400)
}

async function shot(page: Page, name: string) {
  mkdirSync(SHOT_DIR, { recursive: true })
  const { data } = await page.s('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(SHOT_DIR, `${name}.png`), Buffer.from(String(data), 'base64'))
  console.log(`  截图 ${SHOT_DIR}/${name}.png`)
}

const say = (label: string, v: unknown) => console.log(`${label}\n${JSON.stringify(v, null, 1)}`)

const failures: string[] = []
function check(ok: boolean, label: string, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

/** 弹层通用取证：自身几何 + 祖先裁剪链 + 九点命中测试 + 与卡片的重叠面积。 */
const PROBE_POPUP = `(() => {
  const sel = window.__probeSel
  const el = document.querySelector(sel)
  if (!el) return JSON.stringify({ missing: sel })
  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  const inCard = !!el.closest('[data-card-root]')
  const ownerCard = el.closest('[data-card-root]')
  // 祖先裁剪链：任何 overflow 非 visible 的祖先都会把弹层切掉
  const clippers = []
  for (let a = el.parentElement; a; a = a.parentElement) {
    const s = getComputedStyle(a)
    if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
      const ab = a.getBoundingClientRect()
      clippers.push({
        tag: a.tagName.toLowerCase(), cls: String(a.className).slice(0, 70),
        overflow: s.overflowX + '/' + s.overflowY, pos: s.position, zIndex: s.zIndex,
        rect: { t: Math.round(ab.top), b: Math.round(ab.bottom), l: Math.round(ab.left), r: Math.round(ab.right) },
        clipsTop: ab.top > r.top, clipsBottom: ab.bottom < r.bottom,
        clipsLeft: ab.left > r.left, clipsRight: ab.right < r.right,
      })
    }
    if (s.position === 'fixed' || s.transform !== 'none' || s.filter !== 'none' || s.willChange !== 'auto' || (+s.zIndex && s.position !== 'static')) break
  }
  // 九点命中：弹层自己的每个位置，最上层是不是弹层里的节点
  const pts = []
  for (const fy of [0.06, 0.5, 0.94]) for (const fx of [0.06, 0.5, 0.94]) {
    const x = Math.round(r.left + r.width * fx), y = Math.round(r.top + r.height * fy)
    const hit = document.elementFromPoint(x, y)
    pts.push({ at: [x, y], inside: !!(hit && el.contains(hit)), hit: hit ? hit.tagName.toLowerCase() + '.' + String(hit.className).slice(0, 34) : null })
  }
  // 与卡片的重叠：盖住了几张卡的多少面积
  const cards = [...document.querySelectorAll('[data-card-root]')]
  const covered = []
  for (const c of cards) {
    if (c === ownerCard) continue
    const b = c.getBoundingClientRect()
    const w = Math.min(r.right, b.right) - Math.max(r.left, b.left)
    const h = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top)
    if (w > 0 && h > 0) covered.push({ card: c.querySelector('div[title]')?.textContent?.trim().slice(0, 18) ?? '?', px: Math.round(w * h), pct: Math.round(100 * w * h / (b.width * b.height)) })
  }
  return JSON.stringify({
    sel, inCard, rect: { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) },
    bg: cs.backgroundColor, color: cs.color, zIndex: cs.zIndex, position: cs.position, boxShadow: cs.boxShadow.slice(0, 60),
    viewport: { w: innerWidth, h: innerHeight },
    docScrollY: Math.round(scrollY),
    offscreen: r.top < 0 || r.bottom > innerHeight,
    clippers, pts, covered,
    text: el.innerText.replace(/\\n+/g, ' | ').slice(0, 300),
  })
})()`

async function probePopup(page: Page, sel: string) {
  await evalJs(page, `window.__probeSel = ${JSON.stringify(sel)}; true`)
  return JSON.parse(String(await evalJs(page, PROBE_POPUP)))
}

/**
 * 弹层通用扫描：把一页里所有 `[aria-haspopup]` / `button[data-card-menu]` 逐个点开，
 * 量新出现的弹层被哪个祖先裁掉几像素、掉出视口多少、盖住几张卡、菜单项还剩几条。
 * 判据全从 DOM 现算，不靠看图。
 */
const SWEEP = `(async () => {
  const POPUP = '[role="menu"],[role="group"],[role="listbox"],[role="dialog"],[data-radix-popper-content-wrapper]'
  const box = (e) => { const r = e.getBoundingClientRect(); return { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) } }
  const label = (e) => (e.innerText || e.title || e.getAttribute('aria-label') || e.tagName.toLowerCase()).replace(/\\n+/g, ' ').trim().slice(0, 16)
  const facts = (el, trig) => {
    const b = box(el)
    const clipped = []
    for (let a = el.parentElement; a; a = a.parentElement) {
      const s = getComputedStyle(a)
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
        const ab = a.getBoundingClientRect()
        const cut = { l: Math.max(0, Math.round(ab.left - b.l)), r: Math.max(0, Math.round(b.r - ab.right)), t: Math.max(0, Math.round(ab.top - b.t)), bo: Math.max(0, Math.round(b.b - ab.bottom)) }
        if (cut.l + cut.r + cut.t + cut.bo > 0) clipped.push({ host: a.tagName.toLowerCase() + '.' + String(a.className).slice(0, 40), overflow: s.overflowX + '/' + s.overflowY, cut })
      }
      if (s.position === 'fixed' || s.transform !== 'none') break
    }
    const items = el.querySelectorAll('[role="menuitem"],[role="menuitemradio"],label,button,input')
    let visibleItems = 0
    for (const it of items) { const r = it.getBoundingClientRect(); if (r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight) visibleItems++ }
    const own = el.closest('[data-card-root],[data-video-card]')
    let ownPx = 0
    if (own) { const cb = own.getBoundingClientRect(); const w = Math.min(b.r, Math.round(cb.right)) - Math.max(b.l, Math.round(cb.left)); const h = Math.min(b.b, Math.round(cb.bottom)) - Math.max(b.t, Math.round(cb.top)); if (w > 0 && h > 0) ownPx = w * h }
    const cards = [...document.querySelectorAll('[data-card-root],[data-video-card]')].filter(c => !c.contains(el) && !el.contains(c))
    let coverPx = 0, coverCards = 0
    for (const c of cards) {
      const cb = c.getBoundingClientRect()
      const w = Math.min(b.r, Math.round(cb.right)) - Math.max(b.l, Math.round(cb.left))
      const h = Math.min(b.b, Math.round(cb.bottom)) - Math.max(b.t, Math.round(cb.top))
      if (w > 2 && h > 2) { coverPx += w * h; coverCards++ }
    }
    // 弹层自身四边中点：最上层是不是弹层里的节点（被裁掉的那一侧会落到别人身上）
    const edge = [[b.l + 3, (b.t + b.b) / 2], [b.r - 3, (b.t + b.b) / 2], [(b.l + b.r) / 2, b.t + 3], [(b.l + b.r) / 2, b.b - 3]]
    const lost = edge.map(([x, y]) => { const hit = document.elementFromPoint(Math.round(x), Math.round(y)); return { at: [Math.round(x), Math.round(y)], onTop: !!(hit && el.contains(hit)), hit: hit ? hit.tagName.toLowerCase() + '.' + String(hit.className).slice(0, 26) : null } }).filter(p => !p.onTop)
    return {
      trigger: label(trig), popup: el.getAttribute('role') || el.tagName.toLowerCase(), cls: String(el.className).slice(0, 60),
      box: b, zIndex: getComputedStyle(el).zIndex,
      clippedBy: clipped, outOfViewport: { top: b.t < 0, bottom: b.b > innerHeight, left: b.l < 0, right: b.r > innerWidth },
      edgeHitLoss: lost, itemCount: items.length, visibleItems,
      covers: { cards: coverCards, px: coverPx }, ownCardPx: ownPx, ownCardPct: own ? Math.round(100 * ownPx / (own.getBoundingClientRect().width * own.getBoundingClientRect().height)) : 0,
      text: el.innerText.replace(/\\n+/g, ' | ').slice(0, 120),
    }
  }
  const out = []
  const triggers = [...document.querySelectorAll('button[aria-haspopup], button[data-card-menu]')]
  for (const trig of triggers) {
    trig.scrollIntoView({ block: 'center', behavior: 'instant' })
    await new Promise(r => setTimeout(r, 60))
    const before = new Set(document.querySelectorAll(POPUP))
    trig.click()
    await new Promise(r => setTimeout(r, 260))
    const now = [...document.querySelectorAll(POPUP)].filter(e => !before.has(e) && e.getBoundingClientRect().width > 0)
    if (!now.length) { out.push({ trigger: label(trig), popup: '没出现任何弹层节点' }); continue }
    for (const el of now) out.push(facts(el, trig))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise(r => setTimeout(r, 120))
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 5, clientY: 5 }))
    await new Promise(r => setTimeout(r, 160))
  }
  return JSON.stringify(out)
})()`

async function sweepPage(page: Page, url: string, readyExpr: string) {
  await goto(page, url, 1500)
  if (!await waitFor(page, readyExpr)) { console.log(`  页面没就绪：${url}`); return [] }
  await sleep(600)
  return JSON.parse(String(await evalJs(page, SWEEP))) as any[]
}

function reportSweep(title: string, rows: any[]) {
  console.log(`\n──── ${title}：${rows.length} 个弹层 ────`)
  for (const [i, r] of rows.entries()) {
    const bad = (r.clippedBy?.length || 0) > 0 || (r.outOfViewport && Object.values(r.outOfViewport).some(Boolean))
      || (r.edgeHitLoss?.length || 0) > 0 || (r.visibleItems !== r.itemCount)
    console.log(`${bad ? '✗' : '✓'} #${i + 1} 触发「${r.trigger}」→ ${r.popup ?? r.itemCount}`)
    if (r.popup === '没出现任何弹层节点') continue
    console.log(`    盒 ${JSON.stringify(r.box)} z=${r.zIndex} 项 ${r.visibleItems}/${r.itemCount} 盖卡 ${r.covers?.cards} 张/${r.covers?.px}px² 压自己这张 ${r.ownCardPx}px²(${r.ownCardPct}%)`)
    if ((r.clippedBy?.length || 0) > 0) failures.push(`「${r.trigger}」弹层被祖先裁掉 ${JSON.stringify(r.clippedBy[0].cut)}`)
    if (r.outOfViewport && Object.values(r.outOfViewport).some(Boolean)) failures.push(`「${r.trigger}」弹层掉出视口 ${JSON.stringify(r.outOfViewport)}`)
    if (r.ownCardPct > 0) failures.push(`「${r.trigger}」弹层压住自己这张卡 ${r.ownCardPct}%`)
    if (r.clippedBy?.length) console.log(`    被裁：${JSON.stringify(r.clippedBy)}`)
    if (r.outOfViewport && Object.values(r.outOfViewport).some(Boolean)) console.log(`    出视口：${JSON.stringify(r.outOfViewport)}`)
    if (r.edgeHitLoss?.length) console.log(`    边上被别的东西压住：${JSON.stringify(r.edgeHitLoss)}`)
    console.log(`    文案 ${r.text}`)
  }
}

async function main() {
  // ── fixtures ──────────────────────────────────────────────────────────
  const owner = await prisma.user.create({ data: { email: `ov-${short}@example.invalid`, name: '弹层取证账号', password: await hashPassword(pw), phone: `139${short}` } })
  cleanupIds.userIds.push(owner.id)
  const team = await prisma.team.create({
    data: {
      id: await allocateTeamId(prisma), name: `ov-${short}`, slug: `ov-${short}`, shareKey: `ov-${short}`,
      createdById: owner.id, subscriptionPlan: 'BETA',
      members: { create: [{ userId: owner.id, role: 'OWNER', status: 'ACTIVE' }] },
    },
  })
  cleanupIds.teamIds.push(team.id)

  const folders = []
  for (const name of ['一月', 'ces', '二月']) {
    folders.push(await prisma.projectGroup.create({ data: { teamId: team.id, name } }))
  }
  const statuses = ['IN_REVIEW', 'APPROVED', 'IN_REVIEW', 'SHARE_ONLY', 'IN_REVIEW', 'APPROVED', 'IN_REVIEW', 'IN_REVIEW', 'ARCHIVED']
  const projectIds: string[] = []
  for (const [i, st] of statuses.entries()) {
    const p = await prisma.project.create({
      data: {
        teamId: team.id, createdById: owner.id, projectCode: `C${short}${i}`,
        title: `取证项目${i + 1}号`, slug: `ovp-${short}-${i}`, shareSlug: `ovs-${short}-${i}`,
        status: st as any,
        groupId: i < 6 ? folders[i % 3].id : null,
        companyName: i % 4 === 0 ? `客户甲${i}` : (i % 4 === 1 ? '客户乙' : null),
        dueDate: i % 3 === 0 ? new Date(Date.now() + 3 * 864e5) : (i % 3 === 1 ? new Date(Date.now() - 2 * 864e5) : null),
      },
    })
    projectIds.push(p.id)
  }

  // 工作区要有真视频卡才扫得到「视频操作」那一层弹层
  const videoBase = {
    version: 1, versionLabel: 'v1', originalFileName: 'probe.mp4', originalStoragePath: `local/${short}.mp4`,
    duration: 61.5, width: 320, height: 240, fileType: 'video/mp4',
    uploadedBy: owner.id, uploadedByName: '弹层取证账号', status: 'READY' as const, originalFileSize: BigInt(25_530_000),
  }
  for (const n of [1, 2, 3, 4]) {
    await prisma.video.create({ data: { projectId: projectIds[0], name: `取证素材${n}.mp4`, ...videoBase } })
  }

  const deviceId = `overlay-${stamp}`
  await connectChrome()
  const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then(r => r.json())
  await attachSocket(String(webSocketDebuggerUrl))
  const page = await openPage()
  await page.s('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.setItem('vitransfer_device_id', ${JSON.stringify(deviceId)});
             localStorage.setItem('vitransfer_active_team_id', ${JSON.stringify(team.id)});`,
  })

  await goto(page, `${BASE}/login`)
  if (!await waitFor(page, 'document.body && document.body.children.length > 0')) throw new Error('登录页没出来')
  const login = String(await evalJs(page, `(async () => {
    const r = await fetch('/api/auth/login', { method: 'POST', cache: 'no-store',
      headers: { 'content-type': 'application/json', 'X-ViTransfer-Device-ID': ${JSON.stringify(deviceId)} },
      body: JSON.stringify({ email: ${JSON.stringify(owner.email)}, password: ${JSON.stringify(pw)} }) })
    const j = await r.json().catch(() => null)
    if (j?.tokens?.refreshToken) localStorage.setItem('vitransfer_refresh_token', j.tokens.refreshToken)
    return r.status + ' ' + (j?.tokens?.refreshToken ? 'session' : JSON.stringify(j?.error ?? '').slice(0, 120))
  })()`))
  console.log(`登录 → ${login}`)
  if (!login.startsWith('200')) throw new Error('登录失败')

  // ── 项目中心：预热 + 打开 ──────────────────────────────────────────────
  console.log('\n── 项目中心 /studio/projects ──')
  await goto(page, `${BASE}/studio/projects`)
  if (!await waitFor(page, 'document.querySelector("[data-card-root]")')) throw new Error('项目卡没渲染出来')
  await sleep(800)
  const gridFacts = JSON.parse(String(await evalJs(page, `JSON.stringify({
    cards: document.querySelectorAll('[data-card-root]').length,
    skeletons: document.querySelectorAll('.skeleton,[aria-busy=\\"true\\"]').length,
    pulse: document.querySelectorAll('.animate-pulse').length,
  })`)))
  say('静止态', gridFacts)

  // ── bug1 + bug2：项目中心里所有弹层逐个实测 ────────────────────────────
  reportSweep('项目中心 /studio/projects', await sweepPage(
    page, `${BASE}/studio/projects`, 'document.querySelectorAll("[data-card-root]").length > 0'))

  // ── 项目工作区里所有弹层 ───────────────────────────────────────────────
  reportSweep('项目工作区 /studio/projects/[id]', await sweepPage(
    page, `${BASE}/studio/projects/${projectIds[0]}`,
    'document.querySelectorAll("[data-video-card]").length > 0 || document.querySelectorAll("h1,h2").length > 0'))
  // ── bug2 专项：不滚动，点第一行卡片的 ⋯（他截图里就是这个状态）────────
  await goto(page, `${BASE}/studio/projects`, 1500)
  await waitFor(page, 'document.querySelectorAll("[data-card-root]").length > 0')
  await sleep(600)
  const firstRow = JSON.parse(String(await evalJs(page, `(async () => {
    const scroller = [...document.querySelectorAll('div')].find(d => /overflow-y-auto/.test(d.className) && d.querySelector('[data-card-root]'))
    scroller.scrollTop = 0
    await new Promise(r => setTimeout(r, 200))
    const out = []
    for (const c of [...document.querySelectorAll('[data-card-root]')].slice(0, 4)) {
      const b = c.querySelector('button[data-card-menu]')
      const before = new Set(document.querySelectorAll('[role="menu"]'))
      b.click()
      await new Promise(r => setTimeout(r, 260))
      const m = [...document.querySelectorAll('[role="menu"]')].find(e => !before.has(e))
      if (!m) { out.push({ card: c.querySelector('div[title]')?.textContent, menu: '没出现' }); continue }
      const mr = m.getBoundingClientRect(), cr = c.getBoundingClientRect()
      const sb = scroller.getBoundingClientRect()
      const items = [...m.querySelectorAll('button')]
      const hidden = items.filter(it => { const r = it.getBoundingClientRect(); return r.bottom <= sb.top + 1 || r.height < 2 }).map(it => it.textContent?.trim())
      out.push({
        card: c.querySelector('div[title]')?.textContent,
        cardTop: Math.round(cr.top), menuTop: Math.round(mr.top), menuBottom: Math.round(mr.bottom), menuH: Math.round(mr.height),
        scrollerTop: Math.round(sb.top),
        clippedAbovePx: Math.max(0, Math.round(sb.top - mr.top)),
        hiddenItems: hidden,
        coversCardAbove: Math.round(Math.max(0, Math.min(mr.bottom, cr.top - 12) - Math.max(mr.top, cr.top - 12 - cr.height)) * mr.width),
      })
      b.click()
      await new Promise(r => setTimeout(r, 180))
    }
    return JSON.stringify({ scrollerFound: !!scroller, rows: out })
  })()`)))
  say('[bug2 专项] 第一行卡片的菜单', firstRow)

  // ── bug3：骨架屏时间线 ────────────────────────────────────────────────
  console.log('\n[bug3] 骨架屏时间线')
  // 记录器必须在 document-start 就装上：导航会销毁当前执行上下文，
  // 事后从页面里轮询拿不到「骨架什么时候第一次出现」。
  await page.s('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__tl = { seen: {}, end: {} };
      (function loop () {
        try {
          const t = Math.round(performance.now())
          const skel = document.querySelectorAll('.skeleton').length
          const pulse = document.querySelectorAll('.animate-pulse').length
          const busy = document.querySelectorAll('[aria-busy="true"]').length
          const head = document.querySelectorAll('h1, h2').length
          const rows = document.querySelectorAll('[data-card-root], tbody tr').length
          const g = window.__tl.seen
          if (skel && !window.__tl.skelMap) {
            const bx = (e) => { if (!e) return null; const q = e.getBoundingClientRect(); return { t: Math.round(q.top), l: Math.round(q.left), w: Math.round(q.width), h: Math.round(q.height) } }
            const cardEls = [...document.querySelectorAll('[data-skeleton-card]')]
            window.__tl.skelMap = {
              cards: cardEls.length,
              cardBox: bx(cardEls[0]),
              cols: [...new Set(cardEls.map(e => Math.round(e.getBoundingClientRect().left)))].sort((a, b) => a - b),
              aside: bx(document.querySelector('aside')),
              toolbarPills: [...document.querySelectorAll('.skeleton')].filter(e => { const q = e.getBoundingClientRect(); return q.height > 30 && q.height < 44 && q.top < 160 }).length,
            }
          }
          if (skel && g.skeleton == null) g.skeleton = t
          if (pulse && g.pulse == null) g.pulse = t
          if (busy && g.busy == null) g.busy = t
          if (head && g.heading == null) g.heading = t
          if (rows && g.rows == null) g.rows = t
          if (!skel && !pulse && head && g.ready == null) g.ready = t
          window.__tl.end = { skel, pulse, busy, head, rows, t }
        } catch (e) {}
        requestAnimationFrame(loop)
      })()`,
  })
  let wsSkelMap: unknown = null
  for (const [name, path] of [['项目中心', '/studio/projects'], ['项目工作区', `/studio/projects/${projectIds[0]}`], ['团队管理', '/studio/team'], ['成员管理', '/studio/team/members']]) {
    await goto(page, `${BASE}${path}`, 1500)
    await waitFor(page, 'document.querySelectorAll("h1,h2").length > 0')
    await sleep(2500)
    const tl = JSON.parse(String(await evalJs(page, `JSON.stringify({ path: location.pathname, seen: window.__tl && window.__tl.seen, skelMap: window.__tl && window.__tl.skelMap, end: window.__tl && window.__tl.end, body: document.body.innerText.slice(0, 70).replace(/\\n+/g, ' | ') })`)))
    if (name === '项目工作区') wsSkelMap = tl.skelMap
    say(`  ${name}`, tl)
  }

  // ── bug3·b 骨架态 vs 真内容态：同一条页面的几何对照 ───────────────────
  console.log('\n[bug3·b] 骨架占位与真内容的几何对照（项目工作区）')
  const BLOCKMAP = `(() => {
    const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { t: Math.round(r.top), l: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) } }
    const cards = [...document.querySelectorAll('[data-video-card]')]
    const skelCards = [...document.querySelectorAll('[data-skeleton-card]')]
    const list = cards.length ? cards : skelCards
    const first = list[0] ? box(list[0]) : null
    const cols = [...new Set(list.map(e => Math.round(e.getBoundingClientRect().left)))].sort((a, b) => a - b)
    const rows = [...new Set(list.map(e => Math.round(e.getBoundingClientRect().top)))].sort((a, b) => a - b)
    return JSON.stringify({
      state: document.querySelector('.skeleton') ? 'skeleton' : 'real',
      header: box(document.querySelector('h1,h2')),
      aside: box(document.querySelector('aside')),
      main: box(document.querySelector('main,#review-workspace,[class*=rounded-xl]')),
      cardCount: list.length, cardFirst: first,
      cardCols: cols, cardRows: rows,
      cardWH: first ? [first.w, first.h] : null,
      skeletons: document.querySelectorAll('.skeleton').length,
      pulses: document.querySelectorAll('.animate-pulse').length,
      text: document.body.innerText.replace(/\\n+/g, ' | ').slice(0, 90),
    })
  })()`
  await goto(page, `${BASE}/studio/projects/${projectIds[0]}`, 1500)
  await waitFor(page, 'document.querySelectorAll("[data-video-card]").length > 0')
  await sleep(1200)
  const realMap = JSON.parse(String(await evalJs(page, BLOCKMAP)))
  await shot(page, 'bug3b-real')
  say('[bug3·b] 骨架态（导航瞬间由记录器抓的）', wsSkelMap)
  const realCards = { cards: realMap.cardCount, cardBox: realMap.cardFirst, cols: realMap.cardCols, aside: realMap.aside }
  say('[bug3·b] 真内容态', { state: realMap.state, ...realCards, text: realMap.text })
  const a = wsSkelMap as typeof realCards | null
  if (a) {
    // 骨架期还不知道有几个素材，卡数不该当判据；同一套列模板算出来的列数与列位必须一致。
    check(a.cols.length === realCards.cols.length && a.cols.length > 0, `骨架列数 ${a.cols.length} 与真内容 ${realCards.cols.length} 一致`)
    check(a.cardBox?.l === realCards.cardBox?.l, `骨架网格左边界 ${a.cardBox?.l} 与真内容 ${realCards.cardBox?.l} 对齐`)
    check(Math.abs((a.cardBox?.t ?? 0) - (realCards.cardBox?.t ?? 0)) <= 8, `骨架网格上边界 ${a.cardBox?.t} 与真内容 ${realCards.cardBox?.t} 差 ≤8px`)
    check(a.cardBox?.w === realCards.cardBox?.w, `骨架单卡宽 ${a.cardBox?.w} 与真内容 ${realCards.cardBox?.w} 一致`)
    check(Math.abs((a.cardBox?.h ?? 0) - (realCards.cardBox?.h ?? 0)) <= 16, `骨架单卡高 ${a.cardBox?.h} 与真内容 ${realCards.cardBox?.h} 差 ≤16px`)
    check(JSON.stringify(a.cols) === JSON.stringify(realCards.cols), `列位 ${JSON.stringify(a.cols)} vs ${JSON.stringify(realCards.cols)}`)
    check(a.aside?.w === realCards.aside?.w, `侧栏宽 ${a.aside?.w} vs ${realCards.aside?.w}`)
  }

  // ── 改后实拍：筛选面板与第一行卡片的菜单 ───────────────────────────────
  await goto(page, `${BASE}/studio/projects`, 1500)
  await waitFor(page, 'document.querySelectorAll("[data-card-root]").length > 0')
  await sleep(600)
  await evalJs(page, `(() => {
    const b = [...document.querySelectorAll('button[aria-haspopup="dialog"]')].find(x => /筛选/.test(x.innerText + ' ' + x.title))
    b.click(); return 1
  })()`)
  await sleep(400)
  await shot(page, 'fixed-filter')
  await evalJs(page, `(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 1 })()`)
  await sleep(300)
  await evalJs(page, `(() => {
    const c = [...document.querySelectorAll('[data-card-root]')][1]
    c.querySelector('button[data-card-menu]').click(); return 1
  })()`)
  await sleep(400)
  await shot(page, 'fixed-cardmenu')

  // ── 骨架实拍：把项目详情接口按住 4 秒，好把骨架停在画面上量一次 ─────────
  const { identifier } = await page.s('Page.addScriptToEvaluateOnNewDocument', {
    source: `const orig = window.fetch
      window.fetch = async (...args) => {
        if (/\\/api\\/projects\\/[^/?#]+(\\?|$)/.test(String(args[0]))) await new Promise(r => setTimeout(r, 4000))
        return orig(...args)
      }`,
  })
  await goto(page, `${BASE}/studio/projects/${projectIds[0]}`, 2500)
  const skelUp = await waitFor(page, 'document.querySelectorAll("[data-skeleton-card]").length > 0', 15_000)
  if (skelUp) {
    const skelShot = JSON.parse(String(await evalJs(page, BLOCKMAP)))
    say('[骨架实拍] 屏上量到的', { cards: skelShot.cardCount, cols: skelShot.cardCols, cardWH: skelShot.cardWH, text: skelShot.text })
    await shot(page, 'fixed-skeleton')
    const tabs = JSON.parse(String(await evalJs(page, `(() => {
      const nav = document.querySelector('aside nav')
      const btns = nav ? [...nav.querySelectorAll('button')] : []
      return JSON.stringify({ count: btns.length, labels: btns.map(b => b.textContent?.trim()), disabled: btns.filter(b => b.disabled).length })
    })()`)))
    check(tabs.count === 4 && tabs.disabled === 0, `骨架期四枚工作区入口在且可点 → ${JSON.stringify(tabs)}`)
    const clicked = String(await evalJs(page, `(async () => {
      const b = [...document.querySelectorAll('aside nav button')].find(x => x.textContent?.includes('照片相册'))
      b?.click()
      await new Promise(r => setTimeout(r, 500))
      return location.pathname + location.search
    })()`))
    check(/workspace=photos/.test(clicked), `骨架期点「照片相册」真的切过去了 → ${clicked}`)
  } else console.log('  骨架没停住（接口延迟没生效）')
  await page.s('Page.removeScriptToEvaluateOnNewDocument', { identifier })

  // ── 批注框时间码挪位：源码级判据 ──────────────────────────────────────
  // 浏览器几何这条没走通：批注框要能出流的素材才挂载，而本探针的 fixture 视频
  // 没有真文件（originalStoragePath 指向不存在的 local/…），播放器面板只剩空框，
  // CommentInput 根本不在 DOM 里。要量真实几何得先造一条可播素材，代价不对等，
  // 所以这里退成结构判据：时间码必须和表情按钮同一条内嵌工具栏，框外那一处必须关掉。
  {
    const src = readFileSync('src/components/CommentInput.tsx', 'utf8')
    const rowB = src.slice(src.indexOf('left-[84px] right-2 flex h-7'), src.indexOf('id="review-annotation-properties"'))
    const emojiAt = rowB.indexOf('添加表情符号')
    const pillAt = rowB.indexOf('renderTimecodePill(true)')
    check(emojiAt >= 0 && pillAt > emojiAt, '批注框内嵌工具栏里：时间码排在表情之后',
      `→ 表情 @${emojiAt} / 时间码 @${pillAt}`)
    check(!/sendInsideComposer && showTimecodePill && renderTimecodePill\(true\)[\s\S]*?pointer-events-auto/.test(rowB.slice(pillAt)),
      '时间码不是又补了一层 pointer-events 兜底（工具栏整条是指针穿透，只有可点元素自己接）')
    check(/\{!sendInsideComposer && showTimecodePill && renderTimecodePill\(false\)\}/.test(src),
      '框外那一行的时间码只在非内嵌档出现（内嵌档不重复画两枚）')
    check((src.match(/renderTimecodePill/g) || []).length === 3,
      '时间码只有一份实现、两处出口（1 定义 + 2 调用），没抄第二份',
      `→ 出现 ${(src.match(/renderTimecodePill/g) || []).length} 次`)
  }

  console.log(failures.length ? `\n红 ${failures.length} 条：\n- ${failures.join('\n- ')}` : '\n骨架几何全绿')
  if (failures.length) process.exitCode = 1
  console.log('完成。截图在', SHOT_DIR)
}

main().catch((e) => { console.error('探针异常', e); process.exitCode = 1 }).finally(async () => {
  // Project.team 是 onDelete: Restrict，直接删团队必然失败。原先那句把错误吞了，
  // 于是每跑一次本地库就多留一枚团队——先按外键顺序清，清不掉必须报出来。
  for (const id of cleanupIds.teamIds) {
    try {
      await prisma.project.deleteMany({ where: { teamId: id } })
      await prisma.projectGroup.deleteMany({ where: { teamId: id } })
      await prisma.teamMember.deleteMany({ where: { teamId: id } })
      await prisma.team.delete({ where: { id } })
    } catch (e) { console.error(`fixture 团队没删干净 ${id}: ${(e as Error).message}`); process.exitCode = 1 }
  }
  for (const id of cleanupIds.userIds) {
    await prisma.user.delete({ where: { id } }).catch((e) => { console.error(`fixture 账号没删干净: ${(e as Error).message}`); process.exitCode = 1 })
  }
  await prisma.$disconnect().catch(() => null)
  ws?.close()
  chrome?.kill()
  process.exit(process.exitCode ?? 0)
})
