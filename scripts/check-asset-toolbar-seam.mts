import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/encryption'

/**
 * 他 10-22 的原话口径：「我没叫你放大那小缝隙啊，我是叫你在这里加一条啊」
 * 三张红框图（21:12 / 22:31 / 22:39 本地）对完后的结论：
 *  - 22:31 圈的是顶栏与主栏之间那条**已有的 2px 画布缝**，那是他给的样板，不是目标；
 *  - 21:12 与 22:39 圈的是「视频」吸顶工具栏下沿、素材网格上方 —— 目标位置。
 * 所以判据是两条：那条样板缝必须回到 2px（不许被放大），工具栏下沿要多出一条**和它同款**的画布缝。
 *
 * 量法：DOM 计算样式给「是什么」，截图逐行取像素给「画出来没有」，两者都要过。
 * 缝的「同款」用实测厚度与实测颜色比对，不写死色值（四套主题下 --background 各不相同）。
 * 登录只在浏览器里做；CDP 用 Node 内置 WebSocket，零依赖；页面里跑的代码零反斜杠。
 */
const BASE = process.env.SEAM_CHECK_BASE || 'http://localhost:3000'
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PROJECT_ID = process.env.SEAM_CHECK_PROJECT || 'cmtpudz51000o8okz8lxrcxe9'
const SHOT_DIR = process.env.SHOT_DIR || join(tmpdir(), `asset-toolbar-seam-${Date.now()}`)
const prisma = new PrismaClient()
const stamp = Date.now()
const email = `seam-${stamp}@example.invalid`
const pw = `seam-${stamp}`
const cdpPort = 9300 + (stamp % 600)
const userDataDir = join(tmpdir(), `asset-toolbar-seam-${stamp}`)
const failures: string[] = []
let userId = ''
let chrome: ChildProcess | undefined
let ws: WebSocket | undefined
let msgId = 0
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()

function check(ok: boolean, label: string, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
    const ok = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then((r) => r.ok).catch(() => false)
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

async function openPage(url = 'about:blank') {
  const { browserContextId } = await send('Target.createBrowserContext', { disposeOnDetach: true })
  const { targetId } = await send('Target.createTarget', { url, browserContextId })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const page = { browserContextId, targetId, sessionId, s: (m: string, p: Record<string, unknown> = {}) => send(m, p, sessionId) }
  await page.s('Page.enable')
  await page.s('Runtime.enable')
  return page
}

type Page = Awaited<ReturnType<typeof openPage>>

async function evalJs(page: Page, expression: string) {
  const r = await page.s('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(`页面 JS 异常：${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
  return r.result.value
}

async function waitFor(page: Page, expression: string, timeoutMs = 120_000) {
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

/** 工具栏 + 顶栏 + 首行卡片的实测事实（CSS px，视口坐标）。 */
const FACTS = `(() => {
  const main = document.querySelector('#review-workspace')
  if (!main) return JSON.stringify({ missing: 'main' })
  const bar = [...main.querySelectorAll('*')].find(el => getComputedStyle(el).position === 'sticky')
  if (!bar) return JSON.stringify({ missing: 'sticky-bar' })
  const topBar = main.parentElement && main.parentElement.previousElementSibling
  const card = main.querySelector('[data-video-card]')
  const cs = getComputedStyle(bar)
  const after = getComputedStyle(bar, '::after')
  const b = bar.getBoundingClientRect()
  const t = topBar ? topBar.getBoundingClientRect() : null
  const c = card ? card.getBoundingClientRect() : null
  return JSON.stringify({
    bar: { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height },
    mainTop: main.getBoundingClientRect().top,
    mainLeft: main.getBoundingClientRect().left,
    topBarBottom: t ? t.bottom : null,
    topBarMarginBottom: topBar ? getComputedStyle(topBar).marginBottom : null,
    cardTop: c ? c.top : null,
    cardCount: main.querySelectorAll('[data-video-card]').length,
    // 跨在工具栏下沿那一行之上的卡片：滚动时它们正从这条带子底下经过。
    cardsAcrossSeam: [...main.querySelectorAll('[data-video-card]')].filter((el) => {
      const r = el.getBoundingClientRect()
      return r.bottom > b.bottom + 0.5 && r.top < b.bottom - 4
    }).length,
    barBg: cs.backgroundColor,
    mainPadTop: getComputedStyle(main).paddingTop,
    beforeH: getComputedStyle(bar, '::before').height,
    beforeDisplay: getComputedStyle(bar, '::before').display,
    after: {
      content: after.content, position: after.position, height: after.height, bottom: after.bottom,
      left: after.left, right: after.right, bg: after.backgroundColor, zIndex: after.zIndex,
    },
  })
})()`

/** 把 PNG 交给一个 about:blank 页解码，取指定列逐行像素（避开应用页的 CSP）。 */
async function columnRows(blank: Page, file: string, xs: number[]) {
  const b64 = readFileSync(file).toString('base64')
  const out = await evalJs(blank, `(async () => {
    const img = new Image()
    img.src = 'data:image/png;base64,${b64}'
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const g = c.getContext('2d')
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, img.width, img.height).data
    const cols = {}
    for (const x of ${JSON.stringify(xs)}) {
      const rows = []
      for (let y = 0; y < img.height; y++) {
        const i = (y * img.width + Math.min(x, img.width - 1)) * 4
        rows.push([d[i], d[i + 1], d[i + 2]])
      }
      cols[x] = rows
    }
    return JSON.stringify({ w: img.width, h: img.height, cols })
  })()`)
  return JSON.parse(String(out)) as { w: number; h: number; cols: Record<string, number[][]> }
}

function readFileSyncSafe(path: string) {
  return readFileSync(path)
}

/** 把一列像素按容差 4 合并成色带，返回 [{y0,y1,rgb}]。 */
function band(rows: number[][]) {
  const out: { y0: number; y1: number; rgb: number[] }[] = []
  for (let i = 0; i < rows.length; i++) {
    const last = out[out.length - 1]
    const near = last && last.rgb.every((v, k) => Math.abs(v - rows[i][k]) <= 4)
    if (near) last!.y1 = i
    else out.push({ y0: i, y1: i, rgb: rows[i] })
  }
  return out
}

const isWhite = (rgb: number[]) => rgb.every((v) => v >= 250)

async function shot(page: Page, name: string, clip: { x: number; y: number; width: number; height: number }) {
  const { data } = await page.s('Page.captureScreenshot', { clip: { ...clip, scale: 1 }, captureBeyondViewport: false })
  const file = join(SHOT_DIR, `${name}.png`)
  writeFileSync(file, Buffer.from(data, 'base64'))
  console.log(`  截图 → ${file}`)
  return file
}

/**
 * 从顶栏下沿到工具栏下沿再往下 8px 截一条，逐列找细于 7px 的非白色带：
 * 第一条落在顶栏样板缝的 y 上，第二条就该落在新缝的 y 上。
 */
async function seamProof(label: string, facts: any, blank: Page, page: Page) {
  const y0 = Math.round(facts.topBarBottom) - 3
  const y1 = Math.round(facts.bar.bottom) + 8
  const file = await shot(page, label, { x: Math.round(facts.bar.left) + 2, y: y0, width: Math.round(facts.bar.width) - 4, height: y1 - y0 })
  const px = await columnRows(blank, file, [8, Math.round(facts.bar.width / 2) - 6, Math.round(facts.bar.width) - 12])
  const cols: Record<string, { seams: { cssY: number; thickness: number; rgb: number[] }[] }> = {}
  for (const key of Object.keys(px.cols)) {
    const seams = band(px.cols[key])
      .filter((x) => !isWhite(x.rgb) && x.y1 - x.y0 + 1 <= 6)
      .map((s) => ({ cssY: y0 + s.y0, thickness: s.y1 - s.y0 + 1, rgb: s.rgb }))
    cols[key] = { seams }
  }
  console.log(`  ${label}（clip y0=${y0}）逐列非白色带：${JSON.stringify(cols)}`)
  return { cols, file }
}

/** 行高与垂直居中的一次性诊断：吸顶条自己的框、每个直接子元素的上下沿、可见白带区间。 */
const ROW_FACTS = `(() => {
  const main = document.querySelector('#review-workspace')
  const bar = [...main.querySelectorAll('*')].find(el => getComputedStyle(el).position === 'sticky')
  const b = bar.getBoundingClientRect()
  const kids = [...bar.children].map((el) => {
    const r = el.getBoundingClientRect()
    return { tag: el.tagName, cls: String(el.className).slice(0, 26), top: +r.top.toFixed(2), bottom: +r.bottom.toFixed(2), h: +r.height.toFixed(2) }
  })
  const cs = getComputedStyle(bar)
  const root = +getComputedStyle(document.documentElement).fontSize.replace('px', '')
  return JSON.stringify({
    rootFontSize: root,
    mainTop: +main.getBoundingClientRect().top.toFixed(2),
    mainPadTop: cs.paddingTop && getComputedStyle(main).paddingTop,
    bar: { top: +b.top.toFixed(2), bottom: +b.bottom.toFixed(2), h: +b.height.toFixed(2) },
    barPad: { top: cs.paddingTop, bottom: cs.paddingBottom, alignItems: cs.alignItems, flexWrap: cs.flexWrap },
    beforeH: getComputedStyle(bar, '::before').height,
    beforeDisplay: getComputedStyle(bar, '::before').display,
    afterH: getComputedStyle(bar, '::after').height,
    kids,
  })
})()`

async function main() {
  mkdirSync(SHOT_DIR, { recursive: true })
  const project = await prisma.project.findUnique({ where: { id: PROJECT_ID }, select: { id: true, title: true, teamId: true } })
  if (!project) throw new Error(`本地没有夹具项目 ${PROJECT_ID}`)
  const user = await prisma.user.create({
    data: {
      email, name: 'Seam Checker', password: await hashPassword(pw),
      phone: `19${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`,
    },
  })
  await prisma.teamMember.create({ data: { teamId: project.teamId, userId: user.id, role: 'OWNER', status: 'ACTIVE' } })
  userId = user.id

  chrome = await connectChrome()
  const version = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then((r) => r.json())
  await attachSocket(version.webSocketDebuggerUrl)
  const page = await openPage()
  const blank = await openPage()

  const deviceId = `seam-${stamp}`
  await page.s('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('vitransfer_device_id', ${JSON.stringify(deviceId)})` })
  await run(page, '/login')
  await waitFor(page, `document.body && document.body.children.length > 0`)
  const login = String(await evalJs(page, `(async () => {
    const r = await fetch('/api/auth/login', { method: 'POST', cache: 'no-store',
      headers: { 'content-type': 'application/json', 'X-ViTransfer-Device-ID': ${JSON.stringify(deviceId)} },
      body: JSON.stringify({ email: ${JSON.stringify(email)}, password: ${JSON.stringify(pw)} }) })
    const j = await r.json().catch(() => null)
    if (j && j.tokens && j.tokens.refreshToken) localStorage.setItem('vitransfer_refresh_token', j.tokens.refreshToken)
    return r.status + ' ' + (j && j.tokens && j.tokens.refreshToken ? 'ok' : JSON.stringify(j && j.error).slice(0, 120))
  })()`))
  check(login.includes(' 2') || login.endsWith('ok'), 'L1 夹具账号登录成功', `→ ${login}`)

  await run(page, `/studio/projects/${project.id}`)
  const ok = await waitFor(page, `(() => { const m = document.querySelector('#review-workspace'); if (!m) return false; return [...m.querySelectorAll('*')].some(el => getComputedStyle(el).position === 'sticky') })()`)
  if (!ok) throw new Error('项目页没渲染出吸顶工具栏')
  await sleep(2500)

  // ── 静止态 ──────────────────────────────────────────────────────────
  let f = JSON.parse(String(await evalJs(page, FACTS)))
  const rf = JSON.parse(String(await evalJs(page, ROW_FACTS)))
  console.log(`  行几何诊断（静止）：${JSON.stringify(rf)}`)
  // 他 10-22 第二轮：「高度低一点，那一行内容没有居中，是高度居中啊」。
  // 可见白带 = main 边框顶 → 缝的上沿（缝本身是画布，不算白带的厚度）。
  const blockTop = rf.mainTop
  const blockBottom = rf.bar.bottom
  const blockH = blockBottom - blockTop
  const tallest = rf.kids.slice().sort((a: any, b: any) => b.h - a.h)[0]
  const contentCenter = (tallest.top + tallest.bottom) / 2
  const blockCenter = blockTop + blockH / 2
  // 63.88px 是这次改动前同一处实测（本脚本 10-22 23:0x 那一轮）：15px 覆盖带 + 7.5 + 31.88 + 7.5。
  check(Math.abs(blockH - rf.bar.h) <= 0.5, 'R1 白带就是吸顶条自己的框，上面不再留白（改前实测 63.88px）', `→ 现 ${blockH.toFixed(2)}px vs 条框 ${rf.bar.h}px`)
  check(blockH <= 50, 'R1b 这一行收到 50px 以内', `→ ${blockH.toFixed(2)}px`)
  check(Math.abs(contentCenter - blockCenter) <= 1, 'R2 内容在这条白带里真的上下居中', `→ 内容心 ${contentCenter.toFixed(2)} vs 带心 ${blockCenter.toFixed(2)}，差 ${(contentCenter - blockCenter).toFixed(2)}px`)
  check(rf.kids.every((k: any) => Math.abs((k.top + k.bottom) / 2 - contentCenter) <= 1), 'R3 行里每个直接子元素同一条中线（标题和控件不高低差）', `→ ${JSON.stringify(rf.kids.map((k: any) => +(((k.top + k.bottom) / 2)).toFixed(2)))}`)
  check(rf.beforeDisplay === 'none', 'R4 lg 起那条覆盖白带不再需要（吸顶条自己顶满了 main 的上内边距）', `→ ::before display=${rf.beforeDisplay}`)
  check(Math.abs(rf.bar.top - rf.mainTop) <= 1, 'R5 静止时吸顶条上沿就是这块栏面的上沿（上面没留白）', `→ bar.top ${rf.bar.top} vs main.top ${rf.mainTop}`)
  // 条子现在铺满栏面顶部，main 的 lg:rounded-[8px] 必须把它裁成圆角，不许顶成直角。
  const corner = await shot(page, 'corner', { x: Math.round(f.mainLeft), y: Math.round(f.mainTop), width: 24, height: 24 })
  const cpx = await columnRows(blank, corner, [1, 4])
  const c00 = cpx.cols['1'][1]
  const c44 = cpx.cols['4'][4]
  check(!isWhite(c00), 'R6 栏面左上角 1px 处仍是画布（圆角把这块条子裁住了）', `→ (1,1)=${JSON.stringify(c00)}，(4,4)=${JSON.stringify(c44)}`)
  check(isWhite(c44), 'R6b 4px 处已是栏面白（裁掉的就是那枚 8px 圆角，不是啃掉一条）', `→ (4,4)=${JSON.stringify(c44)}`)
  check(f.cardCount > 0, 'V1 素材网格有真实卡片', `→ ${f.cardCount} 张`)
  check(f.topBarMarginBottom === '2px', 'S1 顶栏那条样板缝回到 2px（没被放大）', `→ ${f.topBarMarginBottom}`)
  check(f.after.position === 'absolute' && f.after.height === '2px' && f.after.bottom === '-2px', 'S2 工具栏下沿的 after 是 2px 绝对定位带', `→ ${JSON.stringify(f.after)}`)
  check(f.after.content !== 'none' && f.after.content !== '', 'S3 after 有 content，才会真的画出来', `→ content=${f.after.content}`)
  check(f.after.left === '0px' && f.after.right === '0px', 'S4 after 左右铺满工具栏整幅', `→ left=${f.after.left} right=${f.after.right}`)
  check(f.after.bg !== f.barBg, 'S5 缝的颜色不是栏面白，才会看得见', `→ 缝 ${f.after.bg} vs 栏面 ${f.barBg}`)

  const rest = await seamProof('rest', f, blank, page)
  await shot(page, 'context', { x: Math.round(f.bar.left) - 8, y: Math.round(f.topBarBottom) - 12, width: Math.round(f.bar.width) + 16, height: Math.round(f.cardTop - f.topBarBottom + 90) })
  const midCol = rest.cols[String(Math.round(f.bar.width / 2) - 6)]
  const seam = midCol.seams.find((s: any) => Math.abs(s.cssY - f.bar.bottom) <= 1.5)
  const sample = midCol.seams.find((s: any) => Math.abs(s.cssY - f.topBarBottom) <= 1.5)
  check(!!seam, 'S6 像素上：工具栏下沿 1.5px 内确实有一条色带', `→ 工具栏底 y=${f.bar.bottom}，取到 ${JSON.stringify(midCol.seams)}`)
  check(!!sample, 'S7 像素上：顶栏那条样板缝也在（同一张图里当对照）', `→ ${JSON.stringify(midCol.seams)}`)
  if (seam && sample) {
    check(seam.thickness === sample.thickness, 'S8 新缝和样板缝同厚', `→ 新 ${seam.thickness}px vs 样板 ${sample.thickness}px`)
    check(seam.rgb.every((v: number, i: number) => Math.abs(v - sample.rgb[i]) <= 4), 'S9 新缝和样板缝同色', `→ ${seam.rgb} vs ${sample.rgb}`)
    check(seam.thickness === 2, 'S10 厚度就是 2px', `→ ${seam.thickness}px`)
  }
  const wide = Object.keys(rest.cols).filter((k) => rest.cols[k].seams.some((s: any) => Math.abs(s.cssY - f.bar.bottom) <= 1.5))
  check(wide.length === Object.keys(rest.cols).length, 'S11 左中右三列都取到这条缝（横向铺满）', `→ ${wide.length}/${Object.keys(rest.cols).length} 列`)
  check(f.cardTop > f.bar.bottom + 2, 'S12 首行卡片在这条缝之下，没被压住', `→ 卡顶 ${f.cardTop} vs 缝底 ${f.bar.bottom + 2}`)

  // ── 滚动态：吸顶条不许跳位，卡片被这条缝切齐 ──────────────────────
  let s: any
  const tops: number[] = []
  for (const offset of [0, 300, 520, 1400]) {
    await evalJs(page, `(() => { const m = document.querySelector('#review-workspace'); m.scrollTop = ${offset}; return m.scrollTop })()`)
    await sleep(700)
    const t = JSON.parse(String(await evalJs(page, FACTS)))
    tops.push(+(t.bar.top - t.mainTop).toFixed(2))
    if (offset === 520) s = t
  }
  check(tops.every((v) => Math.abs(v - tops[0]) <= 0.5), 'S13 滚动全程吸顶条不跳位（-mt-4 与 -top-4 同值才钉在同一处）', `→ bar.top-main.top 依次 ${JSON.stringify(tops)}`)
  const scrolled = await seamProof('scrolled', s, blank, page)
  const sSeam = scrolled.cols[String(Math.round(s.bar.width / 2) - 6)].seams.find((x: any) => Math.abs(x.cssY - s.bar.bottom) <= 1.5)
  check(!!sSeam, 'S14 滚动后这条缝仍贴在吸顶条下沿', `→ 吸顶条底 y=${s.bar.bottom}，取到 ${JSON.stringify(scrolled.cols[String(Math.round(s.bar.width / 2) - 6)].seams)}`)
  check(!!(sSeam && seam) && sSeam.rgb.every((v: number, i: number) => Math.abs(v - seam.rgb[i]) <= 4), 'S15 滚动后这条缝的颜色仍是画布色（它盖在经过的卡片上，不是被卡片盖住）', `→ ${JSON.stringify(sSeam && sSeam.rgb)} vs 静止 ${JSON.stringify(seam && seam.rgb)}`)
  check(s.cardsAcrossSeam > 0, 'S16 这一滚确实有卡片跨到吸顶条底下（S15 才不是在空转）', `→ ${s.cardsAcrossSeam} 张`)

  // ── 窄屏 390 ────────────────────────────────────────────────────────
  await page.s('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await sleep(1200)
  const n = JSON.parse(String(await evalJs(page, FACTS)))
  check(n.after.position === 'absolute' && n.after.height === '2px', 'S17 窄屏 390 这条缝同样是 2px', `→ ${JSON.stringify(n.after)}`)
  check(n.bar.right - n.bar.left > 300 && n.bar.left >= 0, 'S18 窄屏没把这条带子甩出视口', `→ bar x ${n.bar.left}..${n.bar.right}`)
  // 窄于 lg 时 main 不是滚动容器，那圈负边距只在 lg 起生效：这条旧路径不许被这次改动带走。
  check(n.beforeDisplay !== 'none', 'S19 窄屏那条覆盖带还在（负边距只在 lg 起生效）', `→ ::before display=${n.beforeDisplay}`)
  check(Math.abs((n.bar.top - n.mainTop) - parseFloat(n.mainPadTop)) <= 1, 'S20 窄屏吸顶条仍贴在 main 内容盒顶（旧几何没被动）', `→ bar.top-main.top=${(n.bar.top - n.mainTop).toFixed(2)} vs main 的 padding-top ${n.mainPadTop}`)
  console.log(`  窄屏旧有现象（本次未动）：覆盖带 ${n.beforeH} 比 main 的上内边距 ${n.mainPadTop} 高 ${(parseFloat(n.beforeH) - parseFloat(n.mainPadTop)).toFixed(2)}px`)
  await page.s('Emulation.clearDeviceMetricsOverride')

  await send('Browser.close').catch(() => null)
}

try {
  await main()
} finally {
  chrome?.kill()
  rmSync(userDataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 })
  try { ws?.close() } catch { /* already closed */ }
  if (userId) await prisma.teamMember.deleteMany({ where: { userId } }).catch(() => null)
  await prisma.user.deleteMany({ where: { email } })
  const left = await prisma.user.count({ where: { email } })
  check(left === 0, 'Z1 夹具账号清干净', `→ 剩 ${left}`)
  await prisma.$disconnect()
}

if (failures.length) {
  console.log(`\n${failures.length} 条未过：`)
  for (const x of failures) console.log(` - ${x}`)
  process.exit(1)
}
console.log(`\n全部通过 · 截图在 ${SHOT_DIR}`)
console.log('未证清单：深色/薄荷等其余主题下的缝色（只量了浅色主题）；卡片菜单 fixed 浮层压过这条带子时的观感。')
