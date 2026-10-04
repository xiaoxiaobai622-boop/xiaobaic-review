import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/encryption'

/**
 * 他 10-04 点单的「在点项目头像那排加一枚成员管理，照对标的站做」（方案 B）的判据。
 *
 * 对标那面（next.frame.io 的项目协作者窗，10-04 在他登录的 Edge 里量过）给的是：
 * 窗头 = 项目名 + 「N 位成员」，一枚搜索框筛团队里的人，一行行名单，右侧移除，还有一条「设为受限」开关。
 * 那条开关 10-04 他自己做在「新建项目」那一路了（Project.restricted ＋迁移），没长在这扇窗里：
 * 名单窗的移除/添加走的仍是 ProjectMember，D10/D11 钉的是「列的默认值与迁移在盘上」和「这扇窗不掺和受限」。
 *
 * 口径是这份判据的核心：名单＝能打开这个项目的人，和身份块那行数字、和端点真的放谁进来，
 * 三者必须是同一批人（A3 拿详情接口的 memberCount 对名单长度，B2 拿被加进来的人真的列得见本项目对写）。
 * 人数与名单共用 project-access 里同一枚 where 提供者（D3），两处不许各写一份 OR。
 *
 * 登录在浏览器里做（会话指纹绑设备头＋UA，Node 侧令牌在浏览器一刷就烧掉整枚会话）；
 * API 层的断言用 Node 令牌，那是接口自己的门。CDP 用 Node 内置 WebSocket，零依赖。
 * 页面里跑的代码不写反斜杠：模板字面量会把 \s \d 吃掉。
 */
const BASE = process.env.MEMBERS_CHECK_BASE || 'http://localhost:3000'
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const prisma = new PrismaClient()
const stamp = Date.now()
const teamSlug = `pmm-${stamp}`
const otherSlug = `pmm-x-${stamp}`
const pw = `pmm-${stamp}`
const cdpPort = 9300 + (stamp % 600)
const userDataDir = join(tmpdir(), `pmm-${stamp}`)
const failures: string[] = []
const tokens: string[] = []
let chrome: ChildProcess | undefined

function check(ok: boolean, label: string, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` → ${detail}` : ''}`)
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function readSource(rel: string): string | null {
  const file = fileURLToPath(new URL(`../src/${rel}`, import.meta.url))
  return existsSync(file) ? readFileSync(file, 'utf8') : null
}

/** 对比度实算：名单那几行小字不许「看着还行」就放过（craft floor：正文 ≥4.5:1）。 */
function luminance([r, g, b]: number[]) {
  const f = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
function contrast(a: number[], b: number[]) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}
function rgbOf(css: string): number[] | null {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(css)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

async function call(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

async function login(email: string) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: pw }),
  })
  const json = await res.json().catch(() => null)
  const token = (json?.tokens?.accessToken as string) || ''
  if (token) tokens.push(token)
  return token
}

/** `User.phone` 是唯一键、`requireApiUser` 硬要绑过手机号，所以每人发一枚没被占用的号。 */
async function makeUser(email: string, name: string, scope?: 'ALL_PROJECTS' | 'ASSIGNED_ONLY') {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      return await prisma.user.create({
        data: {
          email, name, password: await hashPassword(pw),
          phone: `19${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`,
          ...(scope ? { projectAccessScope: scope } : {}),
        },
      })
    } catch (error) {
      const target = (error as { meta?: { target?: string[] } })?.meta?.target ?? []
      if (target.includes('email')) throw error
      if ((error as { code?: string })?.code !== 'P2002') throw error
    }
  }
  throw new Error(`分配不到唯一手机号：${email}`)
}

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
    }, 40_000)
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
  return page
}

type Page = Awaited<ReturnType<typeof openPage>>

async function evalJs(page: Page, expression: string) {
  const r = await page.s('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(`页面 JS 异常：${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
  return r.result.value
}

async function waitFor(page: Page, expression: string, timeoutMs = 60_000) {
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

async function click(page: Page, expr: string) {
  return evalJs(page, `(() => { const el = (${expr}); if (!el) return 'not-found'; el.click(); return 'clicked' })()`)
}

/** 输入框要的是 input 事件（React 受控组件听 change 里的 input），只赋值不重渲染筛不出候选。 */
async function typeInto(page: Page, expr: string, value: string) {
  return evalJs(page, `(() => {
    const el = (${expr}); if (!el) return 'not-found'
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, ${JSON.stringify(value)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return 'typed'
  })()`)
}

async function pressKey(page: Page, key: string) {
  return evalJs(page, `(() => {
    const target = document.activeElement || document.body
    target.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }))
    return target.tagName.toLowerCase()
  })()`)
}
/**
 * 真鼠标（CDP Input.dispatchMouseEvent）：下面那组叠放判据要的是「焦点真的落在那枚按钮上」，
 * 而页面里的 `el.click()` 只发 click、不改 activeElement ⇒ 拿它点撤人按钮，测到的焦点永远是 <body>，
 * 「关掉确认框焦点回到名单行」这条就成了探针自证的假话。坐标取不到（元素没画出来）就报 not-found 让断言红。
 */
async function realClick(page: Page, expr: string) {
  const at = JSON.parse(String(await evalJs(page, `(() => {
    const el = (${expr}); if (!el) return 'null'
    const b = el.getBoundingClientRect(); if (b.width === 0 || b.height === 0) return 'null'
    return JSON.stringify([b.x + b.width / 2, b.y + b.height / 2])
  })()`))) as number[] | null
  if (!at) return 'not-found'
  await page.s('Input.dispatchMouseEvent', { type: 'mousePressed', x: at[0], y: at[1], button: 'left', clickCount: 1 })
  await page.s('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at[0], y: at[1], button: 'left', clickCount: 1 })
  return `clicked@${at[0].toFixed(0)},${at[1].toFixed(0)}`
}
/** 真键盘：Radix 的 Escape 监听挂在 document 的捕获阶段，CDP 发的事件才和它同一棵树。 */
async function realPressKey(page: Page, key: string, vk: number) {
  await page.s('Input.dispatchKeyEvent', { type: 'keyDown', key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
  await page.s('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
  return key
}
/** 焦点归谁：窗开着时只许在窗里，窗关掉后得回到打开它的那枚按钮。 */
async function focusWhere(page: Page, inside: string) {
  return JSON.parse(String(await evalJs(page, `(() => {
    const a = document.activeElement, box = (${inside})
    return JSON.stringify({ tag: a ? a.tagName.toLowerCase() : 'none', text: a ? String(a.textContent || '').trim().slice(0, 24) : '', inside: Boolean(box && a && box.contains(a)) })
  })()`))) as { tag: string; text: string; inside: boolean }
}

const TRIGGER = `[...document.querySelectorAll('[data-tutorial="project-info-trigger"]')].filter(b => b.offsetParent !== null)[0]`
/**
 * 小弹窗有两层：遮罩（Radix Overlay，fixed inset-0）与卡片（Radix Content）。
 * `-overlay` 这枚名字沿用浮层时代的写法，卡片改成居中后它不再承担「盖住主区」，而是替整屏挡指针。
 */
const OVERLAY = `[data-tutorial="project-members-overlay"]`
/** 成员窗那一张卡的宽度：他 10-04 点「改成小弹窗」时给的两扇窗一宽一窄，这一扇是窄的（设置窗 760，见 check-project-settings-panel.mts A2b）。 */
const MODAL_WIDTH = 560

/** 居中一张卡的几何：卡片在视口正中、遮罩铺满整屏（窄栏这次在遮罩底下）、窗头钉着正文自己滚。 */
async function modalGeometry(page: Page) {
  return JSON.parse(String(await evalJs(page, `(() => {
    const panel = ${PANEL}
    const scrim = document.querySelector(${JSON.stringify(OVERLAY)})
    const main = document.getElementById('main-content')
    if (!panel || !scrim || !main) return JSON.stringify(null)
    const rail = main.previousElementSibling
    const box = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height } }
    const cs = getComputedStyle(panel)
    const scs = getComputedStyle(scrim)
    const hit = (x, y) => {
      const e = document.elementFromPoint(x, y)
      if (!e) return { tag: 'none', inPanel: false, inScrim: false, inRail: false }
      return { tag: e.tagName.toLowerCase(), inPanel: panel.contains(e), inScrim: scrim === e || scrim.contains(e), inRail: rail ? rail.contains(e) : false }
    }
    const header = panel.firstElementChild
    const body = panel.lastElementChild
    const bcs = body ? getComputedStyle(body) : null
    const hcs = header ? getComputedStyle(header) : null
    const hBefore = header ? header.getBoundingClientRect().top : null
    // 正文滚得动吗：只有真溢出时这个读数才有内容，溢出与否一并回传，别让「没滚」冒充「滚了也没歪」。
    let bodyTop = null, hAfter = null, scrolled = false
    if (body && body.scrollHeight > body.clientHeight) {
      body.scrollTop = 60
      bodyTop = body.scrollTop
      hAfter = header ? header.getBoundingClientRect().top : null
      scrolled = body.scrollTop > 0
      body.scrollTop = 0
    }
    const alphaOf = (c) => {
      if (!c) return null
      const slash = c.indexOf('/')
      if (slash > -1) return parseFloat(c.slice(slash + 1))
      const parts = c.split(',')
      return parts.length > 3 ? parseFloat(parts[3]) : 1
    }
    const p = box(panel), m = box(main), rb = rail ? box(rail) : null, sb = box(scrim)
    return JSON.stringify({
      p, s: sb, m, railRight: rb ? rb.r : null, railCenterX: rb ? rb.l + rb.w / 2 : null, railCenterY: rb ? rb.t + rb.h / 2 : null,
      innerW: innerWidth, innerH: innerHeight,
      maxWidth: cs.maxWidth,
      childCount: panel.children.length,
      overflowY: bcs ? bcs.overflowY : null,
      headerShrink: hcs ? hcs.flexShrink : null,
      bodyOverflows: body ? body.scrollHeight > body.clientHeight : null,
      bodyTopAfterScroll: bodyTop, headerTopBefore: hBefore, headerTopAfterScroll: hAfter, bodyScrolled: scrolled,
      bodyHScroll: body ? body.scrollWidth > body.clientWidth + 1 : null,
      scrimAlpha: alphaOf(scs.backgroundColor), scrimBg: scs.backgroundColor,
      hitCenter: hit((p.l + p.r) / 2, (p.t + p.b) / 2),
      // 卡片左边缘外 8px：这一点铁定在卡外、又还在视口内（卡宽钉在 560，两侧必然留得下这 8px）。
      hitOutside: hit(p.l - 8, (p.t + p.b) / 2),
      hitRail: rb ? hit(rb.l + rb.w / 2, rb.t + rb.h / 2) : 'no-rail',
    })
  })()`)))
}
/**
 * 确认框叠在小弹窗上那件事的读数。两层都是 z-50，谁在上面由门户里的挂载顺序决定，
 * 所以断的是 elementFromPoint 命中谁＋DOM 顺序，而不是比 z-index 数字。
 */
async function stacking(page: Page) {
  return JSON.parse(String(await evalJs(page, `(() => {
    const panel = ${PANEL}
    const dlg = [...${CONFIRM}].slice(-1)[0] ?? null
    if (!panel || !dlg) return JSON.stringify(null)
    const b = dlg.getBoundingClientRect()
    const at = (x, y) => {
      const e = document.elementFromPoint(x, y)
      return e ? { tag: e.tagName.toLowerCase(), inConfirm: dlg.contains(e), inPanel: panel.contains(e) } : null
    }
    const a = document.activeElement
    return JSON.stringify({
      box: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
      // 确认框排在卡片之后＝后挂载＝同层号里画在上面。
      afterPanel: Boolean(dlg.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_PRECEDING),
      mid: at(b.x + b.width / 2, b.y + b.height / 2),
      // 确认框正下方 8px：那一点该落在成员卡片上，证明确认框只是叠着、没有铺满。
      below: at(b.x + b.width / 2, b.bottom + 8),
      focusInConfirm: Boolean(a && dlg.contains(a)),
      focusTag: a ? a.tagName.toLowerCase() : 'none',
    })
  })()`))) as null | { box: number[]; afterPanel: boolean; mid: any; below: any; focusInConfirm: boolean; focusTag: string }
}
const MENU_ITEM = (text: string) => `[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find(i => i.textContent.trim() === ${JSON.stringify(text)})`
const PANEL = `[...document.querySelectorAll('[data-tutorial="project-members-panel"]')].filter(d => d.getBoundingClientRect().width > 0)[0]`
const ROW = `[...document.querySelectorAll('[data-tutorial="project-member-row"]')]`
// 成员浮层自己就是一枚 role="dialog"，确认窗必须从「除了它之外」的那批里找，否则确认没弹也会绿。
const CONFIRM = `[...document.querySelectorAll('[role="dialog"]')].filter(d => d.getBoundingClientRect().width > 0 && d.getAttribute('data-tutorial') !== 'project-members-panel')`
// click/typeInto 要的是「页面侧 JS 表达式」：喂裸 CSS 选择器会被解析成 `data - tutorial = '…'`，
// 页面抛 SyntaxError 看着像组件没画出来，其实是探针写错。
const SEARCH = `[...document.querySelectorAll('[data-tutorial="project-members-search"]')][0]`
const ADD_BUTTON = `[...document.querySelectorAll('[data-tutorial="project-member-add"]')][0]`
// 找不到人时宁可返回 null 让断言红，也不要页面抛 TypeError 把整趟跑断。
const REMOVE_FREE = `[...document.querySelectorAll('[data-tutorial="project-member-row"]')].find(r => r.textContent.includes('PMM Free'))?.querySelector('[data-tutorial="project-member-remove"]') ?? null`
// 页面侧的选择器一律平铺成一枚常量：`${CONFIRM}` 嵌进另一枚模板字面量里读起来容易，也错得快。
const CONFIRM_OK = `${CONFIRM}.slice(-1)[0] ? [...${CONFIRM}.slice(-1)[0].querySelectorAll('button')].find(b => /移除|确定|确认/.test(b.textContent)) : null`

async function shot(page: Page, name: string, clip: { x: number; y: number; width: number; height: number }) {
  const dir = process.env.SHOT_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  const { data } = await page.s('Page.captureScreenshot', { clip: { ...clip, scale: 2 } })
  writeFileSync(join(dir, `${name}.png`), Buffer.from(data, 'base64'))
  console.log(`截图 → ${dir}/${name}.png`)
}

/** 浮层画出来的事实：标题、行数、每行的字与控件、搜索框、栏面底色。 */
async function panelFacts(page: Page) {
  return JSON.parse(String(await evalJs(page, `(() => {
    const panel = ${PANEL}
    if (!panel) return JSON.stringify({ open: false, anyPanel: document.querySelectorAll('[data-tutorial="project-members-panel"]').length })
    const head = panel.querySelector('h2')
    const rows = ${ROW}
    const search = document.querySelector('[data-tutorial="project-members-search"]')
    const pr = panel.getBoundingClientRect()
    const pcs = getComputedStyle(panel)
    // 底色当场存成字符串：getComputedStyle 给的是活对象，留到组装返回值时那次重算已经踩在「还原主题」的过渡上，读出来是半路的白。
    const bgDefault = pcs.backgroundColor
    // --card 与 --popover 在默认主题下同值，不换到 frame 主题这条断言就是假的。
    const root = document.documentElement
    const prevTheme = root.getAttribute('data-theme')
    // 这张卡带着 duration-200 + transition-property: all，换主题那一刻底色正在从旧值走过去，同步读只读得到起点
    //（实测：frame 下 --popover 已是 0 0% 100%，底色仍量成旧的灰）。这条断言问的是底色归哪枚 token，不是问动画，
    // 所以量之前把这一张卡的过渡按住，量完当场交还——别改全局样式，那会连累后面每一条读数。
    const prevTransition = panel.style.transition
    panel.style.transition = 'none'
    root.setAttribute('data-theme', 'frame')
    const bgInFrame = getComputedStyle(panel).backgroundColor
    const varInFrame = getComputedStyle(root).getPropertyValue('--popover').trim()
    if (prevTheme === null) root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', prevTheme)
    // 交还过渡之前先让还原后的值重算一次：否则下一次重算会把「白 → 灰」看成一次颜色变化、过渡重新启动，
    // 之后在这张卡上读到的每一条都走在半路上（10-04 实测：默认主题的底色因此被读成纯白）。
    void getComputedStyle(panel).backgroundColor
    panel.style.transition = prevTransition
    // --popover 存的是 HSL 三元组不是颜色，直接读 var() 量不到；挂一枚 bg-popover 的探针才拿得到实色。
    const probe = document.createElement('div')
    probe.className = 'bg-popover'
    probe.style.position = 'fixed'
    probe.style.left = '-9999px'
    document.body.appendChild(probe)
    const popoverColor = getComputedStyle(probe).backgroundColor
    probe.remove()
    const close = document.querySelector('[data-tutorial="project-members-close"]')
    const addBtn = document.querySelector('[data-tutorial="project-member-add"]')
    // 来源标签的对比度要对着它自己脚下的底色算：标签若自带底色，拿栏面当分母就是假数。
    const chip = panel.querySelector('[data-tutorial="project-member-source"]')
    const chipRaw = chip ? getComputedStyle(chip).backgroundColor : null
    const chipBg = chipRaw && chipRaw !== 'rgba(0, 0, 0, 0)' ? chipRaw : getComputedStyle(panel).backgroundColor
    return JSON.stringify({
      open: true,
      ariaLabel: panel.getAttribute('aria-label'),
      modal: panel.getAttribute('aria-modal'),
      title: head ? head.textContent.trim() : null,
      count: (function () { const p = panel.querySelectorAll('p'); return p.length ? p[0].textContent.trim() : null })(),
      rowCount: rows.length,
      rowTexts: rows.map(r => r.textContent.replace(/\s+/g, ' ').trim()),
      rowAvatars: rows.map(r => r.querySelectorAll('svg, img, span').length > 0),
      removeStates: rows.map(r => { const b = r.querySelector('[data-tutorial="project-member-remove"]'); return b ? { disabled: Boolean(b.disabled), title: b.getAttribute('title') } : null }),
      placeholder: search ? search.getAttribute('placeholder') : null,
      searchValue: search ? search.value : null,
      candidateRows: document.querySelectorAll('[data-tutorial="project-member-add"]').length,
      candidateTexts: [...document.querySelectorAll('[data-tutorial="project-member-add"]')].map(b => { const li = b.closest('li'); return li ? li.textContent.replace(/\s+/g, ' ').trim() : '' }),
      emptyText: (function () { const e = document.querySelector('[data-tutorial="project-members-empty"]'); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null })(),
      panelBg: bgDefault,
      popoverColor,
      chipBg,
      bgInFrame,
      // 这条红了要看两样：这页的 --popover 在 frame 下到底是多少，以及这张卡挂的是哪一串类。
      varInFrame,
      panelClass: panel.className,
      radius: pcs.borderRadius,
      panelBox: [Math.round(pr.left), Math.round(pr.top), Math.round(pr.width), Math.round(pr.height)],
      closeBox: close ? [Math.round(close.getBoundingClientRect().width), Math.round(close.getBoundingClientRect().height)] : null,
      addBox: addBtn ? [Math.round(addBtn.getBoundingClientRect().width), Math.round(addBtn.getBoundingClientRect().height)] : null,
      secondaryColor: (function () { const s = document.querySelector('[data-tutorial="project-member-contact"]'); return s ? getComputedStyle(s).color : null })(),
      chipColor: (function () { const s = panel.querySelector('[data-tutorial="project-member-source"]'); return s ? getComputedStyle(s).color : null })(),
      bodyOverflowY: (function () { const b = panel.lastElementChild; return b ? getComputedStyle(b).overflowY : null })(),
      settingsOverlay: Boolean(document.querySelector('[data-tutorial="project-settings-overlay"]')),
    })
  })()`)))
}

/** 身份块那行人数（浮层加完人之后要跟着翻，证明它不是只改库不改脸）。 */
async function identityCount(page: Page) {
  return String(await evalJs(page, `(() => {
    const btn = ${TRIGGER}
    if (!btn) return 'no-trigger'
    const lines = btn.querySelectorAll('p')
    return lines.length ? lines[lines.length - 1].textContent.trim() : 'no-line'
  })()`))
}

try {
  // ── fixture：一枚团队（负责人 + 全项目成员 + 已指派 + 待指派 + 停用）+ 一枚别团的局外人 ──
  const owner = await makeUser(`pmm-owner-${stamp}@example.invalid`, 'PMM Owner')
  const team = await prisma.team.create({
    data: {
      name: teamSlug, slug: teamSlug, shareKey: teamSlug, createdById: owner.id, subscriptionPlan: 'BETA',
      members: { create: { userId: owner.id, role: 'OWNER', status: 'ACTIVE' } },
    },
  })
  const allProjectsUser = await makeUser(`pmm-all-${stamp}@example.invalid`, 'PMM AllProjects', 'ALL_PROJECTS')
  await prisma.teamMember.create({ data: { teamId: team.id, userId: allProjectsUser.id, role: 'MEMBER', status: 'ACTIVE' } })
  const assignedUser = await makeUser(`pmm-asg-${stamp}@example.invalid`, 'PMM Assigned', 'ASSIGNED_ONLY')
  await prisma.teamMember.create({ data: { teamId: team.id, userId: assignedUser.id, role: 'MEMBER', status: 'ACTIVE' } })
  const freeUser = await makeUser(`pmm-free-${stamp}@example.invalid`, 'PMM Free', 'ASSIGNED_ONLY')
  await prisma.teamMember.create({ data: { teamId: team.id, userId: freeUser.id, role: 'MEMBER', status: 'ACTIVE' } })
  const disabledUser = await makeUser(`pmm-off-${stamp}@example.invalid`, 'PMM Disabled', 'ALL_PROJECTS')
  await prisma.teamMember.create({ data: { teamId: team.id, userId: disabledUser.id, role: 'MEMBER', status: 'DISABLED' } })
  const project = await prisma.project.create({
    data: {
      teamId: team.id, createdById: owner.id, projectCode: `PM${String(stamp).slice(-7)}`,
      title: `成员管理-${stamp}`, slug: `pmm-${stamp}`, shareSlug: `pmm-s-${stamp}`, status: 'IN_REVIEW',
    },
  })
  await prisma.projectMember.create({ data: { projectId: project.id, userId: assignedUser.id } })

  // 局外人：另一枚团队，跟本项目毫无关系，用来证 403 那道门。
  const outsider = await makeUser(`pmm-x-${stamp}@example.invalid`, 'PMM Outsider')
  await prisma.team.create({
    data: {
      name: otherSlug, slug: otherSlug, shareKey: otherSlug, createdById: outsider.id, subscriptionPlan: 'BETA',
      members: { create: { userId: outsider.id, role: 'OWNER', status: 'ACTIVE' } },
    },
  })

  const ownerToken = await login(owner.email)
  if (!ownerToken) throw new Error(`负责人登录失败`)
  const memberToken = await login(assignedUser.email)
  const freeToken = await login(freeUser.email)
  const outsiderToken = await login(outsider.email)

  const membersPath = `/api/projects/${project.id}/members`
  const detail = await call('GET', `/api/projects/${project.id}`, ownerToken)
  const apiCount = detail.json?.memberCount as number | undefined
  check(typeof apiCount === 'number', 'A0 项目详情接口给得出人数', `→ ${detail.status} memberCount=${String(apiCount)}`)

  // ── A 组：读名单 ───────────────────────────────────────────────────────
  const g = await call('GET', membersPath, ownerToken)
  check(g.status === 200 && Array.isArray(g.json?.members), 'A1 负责人读得到成员名单', `→ ${g.status}`)
  const roster = (g.json?.members ?? []) as any[]
  check(roster.length === 3, 'A2 名单就是「能打开本项目」那三行（负责人 + 全部项目 + 已指派）', `→ ${roster.length} 行：${roster.map(m => m.name).join('/')}`)
  check(g.json?.memberCount === apiCount && roster.length === apiCount,
    'A3 名单长度＝身份块那个 memberCount（人数与名单不许各说各话）', `→ 名单 ${roster.length}／接口 ${String(apiCount)}`)
  const sourceOf = (name: string) => roster.find(m => m.name === name)?.source
  check(sourceOf('PMM Owner') === 'teamAdmin' && sourceOf('PMM AllProjects') === 'allProjects' && sourceOf('PMM Assigned') === 'assigned',
    'A4 每行标出「为什么能进来」', `→ ${JSON.stringify(roster.map(m => [m.name, m.source]))}`)
  check(Boolean(g.json?.canManage), 'A5 负责人这侧 canManage＝true（才谈得上写）', `→ ${String(g.json?.canManage)}`)
  const removable = roster.filter(m => m.canRemove).map(m => m.name)
  check(JSON.stringify(removable) === JSON.stringify(['PMM Assigned']),
    'A6 只有「靠本项目授权进来」那行能撤（角色与团队范围进来的撤不动）', `→ 可撤 ${JSON.stringify(removable)}`)
  check(roster.every(m => typeof m.email === 'string' && typeof m.phone === 'string'),
    'A7 管理员读得到每行的联系方式（与批注 PII 那条款一致）', `→ ${JSON.stringify(roster.map(m => [Boolean(m.email), Boolean(m.phone)]))}`)
  const candidates = (g.json?.candidates ?? []) as any[]
  check(candidates.length === 1 && candidates[0].name === 'PMM Free',
    'A8 待添加＝团队里 ACTIVE、又还没进本项目的「仅指定项目」成员', `→ ${JSON.stringify(candidates.map(c => c.name))}`)
  check(!roster.some(m => m.name === 'PMM Disabled') && !candidates.some(c => c.name === 'PMM Disabled'),
    'A9 停用的团队成员两处都不出现（ DISABLED 不算能进来的人）')

  const gm = await call('GET', membersPath, memberToken)
  check(gm.status === 200 && gm.json?.canManage === false, 'A10 普通成员读得到名单、但 canManage＝false', `→ ${gm.status} canManage=${String(gm.json?.canManage)}`)
  // 断的是「这三位各自的邮箱与手机号没漏进这台响应」，不是「整串里找不到 @ 和 19」——
  // 后者会被 cuid 主键里恰好出现的 19 打成假红，也会被邮箱以外的无关字符放过。
  const memberPayload = JSON.stringify(gm.json ?? {})
  const pii = [owner, allProjectsUser, assignedUser, freeUser].flatMap(u => [u.email, u.phone].filter(Boolean) as string[])
  check(pii.every(v => !memberPayload.includes(v)),
    'A11 普通成员那侧不吐邮箱与手机号（PII 只给项目管理员，和详情接口的老规矩一致）', `→ 漏 ${JSON.stringify(pii.filter(v => memberPayload.includes(v)))}`)
  check((gm.json?.candidates ?? []).length === 0, 'A12 普通成员没有候选池（他能看，但不能加人）', `→ ${String((gm.json?.candidates ?? []).length)}`)
  const go = await call('GET', membersPath, outsiderToken)
  check(go.status === 403 || go.status === 404, 'A13 别的人碰不到这枚项目的名单', `→ ${go.status}`)
  const gn = await call('GET', membersPath, '')
  check(gn.status === 401 || gn.status === 403, 'A14 不带令牌直接拒（不是先查库再拒）', `→ ${gn.status}`)

  // ── B 组：写名单 ───────────────────────────────────────────────────────
  const p1 = await call('POST', membersPath, ownerToken, { userId: freeUser.id })
  check(p1.status === 200, 'B1 负责人把待授权的成员加进本项目', `→ ${p1.status} ${JSON.stringify(p1.json?.error ?? '').slice(0, 60)}`)
  const gB1 = await call('GET', membersPath, ownerToken)
  check((gB1.json?.members ?? []).length === 4 && gB1.json?.memberCount === 4,
    'B2 加完之后名单与人数一起到 4（不是只写了一行库）', `→ 名单 ${String((gB1.json?.members ?? []).length)}／人数 ${String(gB1.json?.memberCount)}`)
  const listAfterAdd = await call('GET', '/api/projects', freeToken)
  check((listAfterAdd.json?.projects ?? []).some((x: any) => x.id === project.id),
    'B3 被加进来的人现在真能在自己的项目列表里看见这枚（名单那句「能进来」是事实不是装饰）', `→ ${listAfterAdd.status} 共 ${String((listAfterAdd.json?.projects ?? []).length)} 枚`)

  await call('POST', membersPath, ownerToken, { userId: freeUser.id })
  const dupRows = await prisma.projectMember.count({ where: { projectId: project.id, userId: freeUser.id } })
  check(dupRows === 1, 'B4 重复添加同一人不产生第二行（幂等，库里的唯一键不许撞）', `→ ${dupRows} 行`)

  const badPost = await call('POST', membersPath, ownerToken, { userId: outsider.id })
  const outsiderRows = await prisma.projectMember.count({ where: { projectId: project.id, userId: outsider.id } })
  check(badPost.status >= 400 && badPost.status < 500 && outsiderRows === 0,
    'B5 往本项目塞一个不在这个团队的人：拒掉，库里一行没多', `→ ${badPost.status} 行数 ${outsiderRows}`)
  const noBody = await call('POST', membersPath, ownerToken, {})
  check(noBody.status >= 400 && noBody.status < 500, 'B6 缺 userId 的请求是 4xx 不是 500', `→ ${noBody.status}`)

  const pm = await call('POST', membersPath, memberToken, { userId: freeUser.id })
  check(pm.status === 403, 'B7 普通成员 POST → 403（只有 OWNER/ADMIN 能写）', `→ ${pm.status}`)
  const dm = await call('DELETE', `${membersPath}/${allProjectsUser.id}`, memberToken)
  check(dm.status === 403, 'B8 普通成员 DELETE → 403', `→ ${dm.status}`)

  const d1 = await call('DELETE', `${membersPath}/${freeUser.id}`, ownerToken)
  check(d1.status === 200, 'B9 负责人撤掉那行授权', `→ ${d1.status}`)
  const gB9 = await call('GET', membersPath, ownerToken)
  const listAfterDel = await call('GET', '/api/projects', freeToken)
  check((gB9.json?.members ?? []).length === 3 && gB9.json?.memberCount === 3,
    'B10 撤掉之后名单与人数回到 3', `→ 名单 ${String((gB9.json?.members ?? []).length)}／人数 ${String(gB9.json?.memberCount)}`)
  check(!(listAfterDel.json?.projects ?? []).some((x: any) => x.id === project.id),
    'B11 被撤掉的人列表里再没有这枚项目（撤授权是真撤，不是界面好看）', `→ ${String((listAfterDel.json?.projects ?? []).length)} 枚`)
  const dRole = await call('DELETE', `${membersPath}/${allProjectsUser.id}`, ownerToken)
  const roleRows = await prisma.projectMember.count({ where: { projectId: project.id, userId: allProjectsUser.id } })
  check(dRole.status >= 400 && roleRows === 0,
    'B12 撤不动那行照字面拒（没有授权行可删；界面也不给这枚按钮，见 C14）', `→ ${dRole.status} 行数 ${roleRows}`)
  const dGhost = await call('DELETE', `${membersPath}/no-such-user-${stamp}`, ownerToken)
  check(dGhost.status >= 400 && dGhost.status < 500, 'B13 撤一个不存在的人不炸', `→ ${dGhost.status}`)

  await prisma.team.update({ where: { id: team.id }, data: { status: 'DISABLED' } })
  const disabledWrite = await call('POST', membersPath, ownerToken, { userId: freeUser.id })
  const disabledRows = await prisma.projectMember.count({ where: { projectId: project.id, userId: freeUser.id } })
  check(disabledWrite.status === 403 && disabledRows === 0,
    'B14 团队停用之后写不进去（全站写闸门在这两条路上也生效）', `→ ${disabledWrite.status} 行数 ${disabledRows}`)
  await prisma.team.update({ where: { id: team.id }, data: { status: 'ACTIVE' } })

  // ── 预热：dev 冷路由要 20-35 秒，量到的不该是 webpack 编译 ──────────────
  const warm = async (path: string, headers?: Record<string, string>) => {
    try { return String((await fetch(`${BASE}${path}`, { headers, cache: 'no-store', redirect: 'manual' })).status) }
    catch (e) { return `预热失败 ${(e as Error).message}` }
  }
  for (const p of ['/login', `/studio/projects/${project.id}`, membersPath, `/api/projects/${project.id}`, '/api/team-center', '/api/announcements', '/api/comments/for-me']) {
    console.log(`预热 ${p} → ${await warm(p, p.startsWith('/api/') ? { authorization: `Bearer ${ownerToken}` } : undefined)}`)
  }

  // ── C 组：浏览器里的入口与浮层 ─────────────────────────────────────────
  chrome = await connectChrome()
  const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then(r => r.json())
  await attachSocket(webSocketDebuggerUrl)
  const page = await openPage()
  const deviceId = `pmm-${stamp}-owner`
  await page.s('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.setItem('vitransfer_device_id', ${JSON.stringify(deviceId)})`,
  })
  await run(page, '/login')
  check(await waitFor(page, 'document.body && document.body.children.length > 0', 90_000), 'C0 登录页画出来了')
  const browserLogin = String(await evalJs(page, `(async () => {
    const r = await fetch('/api/auth/login', { method: 'POST', cache: 'no-store',
      headers: { 'content-type': 'application/json', 'X-ViTransfer-Device-ID': ${JSON.stringify(deviceId)} },
      body: JSON.stringify({ email: ${JSON.stringify(owner.email)}, password: ${JSON.stringify(pw)} }) })
    const j = await r.json().catch(() => null)
    if (j?.tokens?.refreshToken) localStorage.setItem('vitransfer_refresh_token', j.tokens.refreshToken)
    return r.status + ' ' + (j?.tokens?.refreshToken ? 'session' : 'no-session')
  })()`))
  check(/^200 session$/.test(browserLogin), 'C1 浏览器内登录', `→ ${browserLogin}`)

  await run(page, `/studio/projects/${project.id}`)
  check(await waitFor(page, TRIGGER, 120_000), 'C2 项目页的身份块画出来了')
  await sleep(1_200)
  const countBefore = await identityCount(page)
  check(countBefore === '3 位成员', 'C3 加人之前身份块写的是「3 位成员」', `→ ${JSON.stringify(countBefore)}`)

  console.log(`  点身份块 → ${await click(page, TRIGGER)}`)
  check(await waitFor(page, `[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].length >= 4`, 20_000), 'C4 菜单弹出来且有第四行')
  const menuTexts = String(await evalJs(page, `JSON.stringify([...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map(i => i.textContent.trim()))`))
  check(JSON.parse(menuTexts).includes('成员管理'), 'C5 菜单第四行就是「成员管理」', `→ ${menuTexts}`)
  const menuIcons = String(await evalJs(page, `(() => { const i = (${MENU_ITEM('成员管理')}); return i ? i.querySelectorAll('svg').length : -1 })()`))
  check(Number(menuIcons) === 1, 'C6 那一行带一枚图标（跟前三行同一套手搓菜单行的排法）', `→ svg ${menuIcons}`)
  // 这张图要证的是「菜单开着、里面真有第四行」：照硬编码矩形截只会截到侧栏那排导航，
  // 菜单开没开画出来一模一样（10-04 第一版就是这样）。所以量它自己的矩形，量不到＝这条证据没成立。
  const menuBox = JSON.parse(String(await evalJs(page, `(() => { const m = document.querySelector('[role="menu"]'); if (!m) return 'null'; const b = m.getBoundingClientRect(); return JSON.stringify([b.x, b.y, b.width, b.height]) })()`))) as number[] | null
  check(menuBox !== null && menuBox[2] > 100 && menuBox[3] > 100, 'C6b 截图这一刻菜单还开着且有实际尺寸（否则那张图证不了第四行）', `→ ${JSON.stringify(menuBox)}`)
  if (menuBox) {
    await shot(page, 'members-menu', {
      x: Math.max(0, menuBox[0] - 12),
      y: Math.max(0, menuBox[1] - 12),
      width: menuBox[2] + 24,
      height: menuBox[3] + 24,
    })
  }

  console.log(`  点「成员管理」→ ${await click(page, MENU_ITEM('成员管理'))}`)
  check(await waitFor(page, PANEL, 60_000), 'C7 点它浮起成员浮层（走的是项目页那套浮层机制，不是另一条路由）')
  // 浮层先画的是「正在加载...」：不等到名单真落地就量，后面每一条读的都是加载壳。
  check(await waitFor(page, `${ROW}.length > 0`, 30_000), 'C7b 名单画出来了（加载中不许当成空名单）')
  const pathAfter = String(await evalJs(page, 'location.pathname'))
  check(pathAfter === `/studio/projects/${project.id}`, 'C8 URL 一字不动', `→ ${pathAfter}`)
  const cf = await panelFacts(page)
  console.log(`  浮层事实 → ${JSON.stringify(cf).slice(0, 420)}`)
  await shot(page, 'members-panel', { x: cf.panelBox?.[0] ?? 60, y: cf.panelBox?.[1] ?? 60, width: cf.panelBox?.[2] ?? 700, height: Math.min(560, cf.panelBox?.[3] ?? 560) })
  check(cf.title === `成员管理-${stamp} 的成员`, 'C9 窗头那行是「〈项目名〉 的成员」（对标是「添加到〈项目名〉」，本站这句说的是这张名单是什么）', `→ ${JSON.stringify(cf.title)}`)
  check(cf.ariaLabel === cf.title && cf.modal === 'true', 'C10 这枚窗有无障碍名且 aria-modal（读屏知道现在是待在窗里）', `→ ${JSON.stringify([cf.ariaLabel, cf.modal])}`)
  check(cf.count === '3 位成员', 'C11 窗头人数沿用身份块那句「N 位成员」', `→ ${JSON.stringify(cf.count)}`)
  check(cf.rowCount === 3, 'C12 名单画三行（与接口 A2 同一批人）', `→ ${String(cf.rowCount)}`)
  check(cf.rowTexts?.join('|').includes('团队管理员') && cf.rowTexts.join('|').includes('全部项目') && cf.rowTexts.join('|').includes('已授权本项目'),
    'C13 每行那枚来源标签把「为什么能进来」写在脸上（对标那面靠一条开关说的话，本站得自己讲清）', `→ ${JSON.stringify(cf.rowTexts)}`)
  const removeStates = (cf.removeStates ?? []) as Array<{ disabled: boolean; title: string | null } | null>
  check(removeStates.length === 3
    && removeStates.filter(s => s && s.disabled === false).length === 1
    && removeStates.filter(s => s && s.disabled).every(s => Boolean(s?.title)),
    'C14 撤不动那两行的按钮是 disabled 且带原因，只有「已授权本项目」那行能点', `→ ${JSON.stringify(cf.removeStates)}`)
  check(cf.rowAvatars?.every(Boolean) === true && cf.rowTexts?.join('|').includes('PMM Owner'), 'C15 每行有头像与昵称')
  check(typeof cf.placeholder === 'string' && cf.placeholder.includes('搜索'), 'C16 搜索框那行提示说要搜什么', `→ ${JSON.stringify(cf.placeholder)}`)
  check(cf.candidateRows === 1 && cf.candidateTexts.join('|').includes('PMM Free'), 'C17 待添加那位一进窗就列得出来', `→ ${JSON.stringify([cf.candidateRows, cf.candidateTexts])}`)

  console.log(`  搜「Free」→ ${await typeInto(page, SEARCH, 'Free')}`)
  await sleep(600)
  const searched = await panelFacts(page)
  check(searched.candidateRows === 1 && searched.candidateTexts.join('|').includes('PMM Free'),
    'C18 输入名字筛得出那一位（筛的是昵称，也筛手机号与邮箱，见 C20）', `→ ${JSON.stringify(searched.candidateTexts)}`)
  console.log(`  搜一串不存在 → ${await typeInto(page, SEARCH, 'zzz-none')}`)
  await sleep(600)
  const noMatch = await panelFacts(page)
  check(noMatch.candidateRows === 0 && Boolean(noMatch.emptyText), 'C19 搜不到就给一句话，不许留一片空白', `→ ${JSON.stringify(noMatch.emptyText)}`)
  console.log(`  搜手机号 → ${await typeInto(page, SEARCH, String(freeUser.phone).slice(-4))}`)
  await sleep(600)
  const byPhone = await panelFacts(page)
  check(byPhone.candidateRows === 1, 'C20 拿手机号后四位也筛得出来（本站成员主要靠手机号认人）', `→ ${String(byPhone.candidateRows)}`)

  console.log(`  清空搜索 → ${await typeInto(page, SEARCH, '')}`)
  await sleep(500)
  console.log(`  点候选行的「添加」→ ${await click(page, ADD_BUTTON)}`)
  const added = await waitFor(page, `${ROW}.filter(r => r.textContent.includes('PMM Free')).length > 0`, 30_000)
  await sleep(900)
  const afterAdd = await panelFacts(page)
  const countAfterAdd = await identityCount(page)
  const dbRows = await prisma.projectMember.count({ where: { projectId: project.id, userId: freeUser.id } })
  check(Boolean(added) && afterAdd.rowCount === 4, 'C21 点「添加」→ 名单当场多一行', `→ ${String(afterAdd.rowCount)} 行`)
  check(dbRows === 1, 'C22 库里落的是那一条授权行（界面背后是真写）', `→ ${dbRows} 行`)
  check(countAfterAdd === '4 位成员', 'C23 身份块那行数字跟着翻成「4 位成员」（两处不许各说各话）', `→ ${JSON.stringify(countAfterAdd)}`)
  const freeRow = ((afterAdd.rowTexts ?? []) as string[]).find(t => t.includes('PMM Free')) || ''
  check(freeRow.includes('已授权本项目'), 'C24 新加那行的来源写「已授权本项目」（对标那面叫「直接成员」，本站说的是这行的由来）', `→ ${JSON.stringify(freeRow)}`)

  console.log(`  撤掉刚加那行 → ${await click(page, REMOVE_FREE)}`)
  // 成员浮层自己也是 role="dialog"，所以确认窗要按「不是那枚面板」筛，否则面板一直在就算「弹了确认」＝假绿。
  const confirmed = await waitFor(page, `${CONFIRM}.length > 0`, 20_000)
  const dlgText = String(await evalJs(page, `(() => { const ds = ${CONFIRM}; const d = ds[ds.length - 1]; return d ? d.textContent.replace(/\\s+/g, ' ').slice(0, 120) : '' })()`))
  check(Boolean(confirmed) && /PMM Free/.test(dlgText), 'C25 撤人先弹确认（删的是访问权，不是一点就没）', `→ ${JSON.stringify(dlgText)}`)
  console.log(`  确认 → ${await click(page, CONFIRM_OK)}`)
  // 定长 1.2 秒的等待实测输过一次竞态（10-04 第二轮：确认点了、这里读到还是 4 行／库 1，第三轮同样的代码又绿）。
  // 撤一条授权要走 DELETE + 重取名单 + 页面重取项目详情三次往返，快慢不由脚本决定 ⇒ 改成等这两件事真落地，最多 20 秒；
  // 等不到照样红，断言的力气没减，只是不再靠掷硬币。
  const removedLanded = await waitFor(page, `(() => {
    const rows = ${ROW}
    const btn = ${TRIGGER}
    const ps = btn ? [...btn.querySelectorAll('p')] : []
    return rows.every(r => !r.textContent.includes('PMM Free')) && ps.some(p => /3 位成员/.test(p.textContent))
  })()`, 20_000)
  const afterRemove = await panelFacts(page)
  const countAfterRemove = await identityCount(page)
  const rowsLeft = await prisma.projectMember.count({ where: { projectId: project.id, userId: freeUser.id } })
  check(afterRemove.rowCount === 3 && rowsLeft === 0, 'C26 确认之后名单回到三行、库里那条授权没了', `→ ${String(afterRemove.rowCount)} 行／库 ${rowsLeft}${removedLanded ? '' : '｜20 秒内界面没跟上'}`)
  check(countAfterRemove === '3 位成员', 'C27 身份块数字也回到「3 位成员」', `→ ${JSON.stringify(countAfterRemove)}`)

  check(cf.settingsOverlay === false, 'C28 成员窗开着时设置浮层不在（同一页面两枚窗互斥）')

  // 关掉再开设置：证明互斥是双向的，不是顺手把另一枚藏了。
  console.log(`  Escape → ${await pressKey(page, 'Escape')}`)
  await sleep(500)
  const afterEsc = await panelFacts(page)
  const focusBack = String(await evalJs(page, `(() => { const a = document.activeElement; const b = ${TRIGGER}; return a && b && a === b ? 'trigger' : (a ? a.tagName.toLowerCase() : 'none') })()`))
  check(afterEsc.open === false, 'C29 Escape 关得掉', `→ ${JSON.stringify(afterEsc).slice(0, 80)}`)
  check(focusBack === 'trigger', 'C30 关掉后焦点还给身份块（键盘用户不掉回页面顶部）', `→ ${focusBack}`)
  console.log(`  点身份块再点「项目详情」→ ${await click(page, TRIGGER)}`)
  await sleep(500)
  console.log(`  ${await click(page, MENU_ITEM('项目详情'))}`)
  check(await waitFor(page, `document.querySelector('[data-tutorial="project-settings-overlay"]')`, 60_000), 'C31 设置浮层照旧开（第四行没把原来那三节挤坏）')
  const bothOpen = String(await evalJs(page, `JSON.stringify({ m: document.querySelectorAll('[data-tutorial="project-members-panel"]').length, s: document.querySelectorAll('[data-tutorial="project-settings-panel"]').length })`))
  check(JSON.parse(bothOpen).m === 0, 'C32 开设置时成员窗已不在（两枚各一份，不许叠着）', `→ ${bothOpen}`)

  // 视觉下限：栏面底色、控件尺寸、小字对比度——都是这站已有的规矩，浮层不能自带一套。
  check(cf.panelBg === cf.popoverColor && cf.bgInFrame === 'rgb(255, 255, 255)',
    'C33 浮层栏面吃 --popover（默认主题 --card 与 --popover 同值，所以必须同时在 frame 下量到纯白，否则这条是假绿）',
    `→ 默认 ${String(cf.panelBg)}／popover ${String(cf.popoverColor)}／frame ${String(cf.bgInFrame)}（frame 下这页的 --popover ${String(cf.varInFrame)}／卡的类 ${String(cf.panelClass)}）`)
  check(cf.radius === '8px', 'C34 四角 8px 圆角，跟其余栏面同一枚数', `→ ${String(cf.radius)}`)
  check(cf.closeBox?.[1] === 44, 'C35 关闭钮 44×44（他 10-02 点的数；h-11 会被控件阶梯压平，必须写 px 字面量）', `→ ${JSON.stringify(cf.closeBox)}`)
  check(Boolean(cf.addBox && cf.addBox[0] > 0 && cf.addBox[1] > 0),
    'C36 候选行那枚「添加」真画出来了（这版没对标的尺寸数，所以只断它存在，不编一个数进去）', `→ ${JSON.stringify(cf.addBox)}`)
  const ratio = (c: string | null, on: string | null) => {
    const rgb = c ? rgbOf(c) : null
    const back = on ? rgbOf(on) : null
    return rgb && back ? Number(contrast(rgb, back).toFixed(2)) : null
  }
  check(ratio(cf.secondaryColor, String(cf.panelBg)) !== null && ratio(cf.secondaryColor, String(cf.panelBg))! >= 4.5,
    'C37 次要字（联系方式）压栏面 ≥4.5:1（实算，不是我看着还行）', `→ ${String(cf.secondaryColor)} = ${String(ratio(cf.secondaryColor, String(cf.panelBg)))}:1`)
  const chipOn = String(cf.chipBg ?? cf.panelBg)
  check(ratio(cf.chipColor, chipOn) !== null && ratio(cf.chipColor, chipOn)! >= 4.5,
    'C38 来源标签的字压它自己的底 ≥4.5:1（不许拿灰压灰）', `→ ${String(cf.chipColor)} 压 ${chipOn} = ${String(ratio(cf.chipColor, chipOn))}:1`)

  // ── 小弹窗这组：10-04「把他们都改成小弹窗」的几何与叠放 ─────────────────
  // 上面那组事实是在窗刚开的时候量的；这一组重新开一次窗，先量居中那张卡，
  // 再拿真鼠标＋真键盘测「移除成员那一步的确认框叠在小弹窗上」——按他点单的原话，这条要实测，不靠推理。
  console.log(`  先收掉 C31 那枚设置浮层 → ${await click(page, `document.querySelector('[data-tutorial="project-settings-close"]')`)}`)
  check(await waitFor(page, `document.querySelectorAll('[data-tutorial="project-settings-overlay"]').length === 0`, 20_000),
    'C39 设置浮层收掉了（下面量的必须只有成员窗这一枚）')

  console.log(`  真指针点身份块 → ${await realClick(page, TRIGGER)}`)
  check(await waitFor(page, `[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].length >= 4`, 20_000), 'C40 真指针也开得出那排菜单')
  console.log(`  真指针点「成员管理」→ ${await realClick(page, MENU_ITEM('成员管理'))}`)
  check(await waitFor(page, PANEL, 60_000), 'C41 成员窗开出来了（真指针那条路走得通，不是只有 el.click() 能用）')
  check(await waitFor(page, `${ROW}.length > 0`, 30_000), 'C41b 名单落地了（加载中量到的是壳）')

  const mgRaw = await modalGeometry(page)
  const near = (a: number, b: number) => Math.abs(a - b) <= 0.6
  check(!!mgRaw, 'C42 量得到卡片与遮罩的几何', mgRaw ? '' : '→ 弹窗没画出来，下面这组读的是占位值')
  const mg = mgRaw ?? {
    p: { l: NaN, t: NaN, r: NaN, b: NaN, w: NaN, h: NaN }, s: { l: NaN, t: NaN, r: NaN, b: NaN, w: NaN, h: NaN },
    innerW: NaN, innerH: NaN, maxWidth: 'n/a', childCount: NaN, overflowY: 'n/a', headerShrink: 'n/a',
    bodyHScroll: null, scrimAlpha: null, scrimBg: null, railRight: null,
    hitCenter: 'no-panel', hitOutside: 'no-panel', hitRail: 'no-panel',
  }
  check(!!mgRaw && near(mg.p.l, mg.innerW - mg.p.r) && near(mg.p.t, mg.innerH - mg.p.b),
    'C43 卡片坐在视口正中（左右余白相等、上下余白相等）',
    mgRaw ? `→ 左 ${mg.p.l.toFixed(2)} 右余 ${(mg.innerW - mg.p.r).toFixed(2)}｜顶 ${mg.p.t.toFixed(2)} 底余 ${(mg.innerH - mg.p.b).toFixed(2)}` : '→ 量不到')
  check(!!mgRaw && mg.maxWidth === `${MODAL_WIDTH}px` && near(mg.p.w, Math.min(MODAL_WIDTH, mg.innerW - 32)),
    `C44 宽钉在 ${MODAL_WIDTH}px（两扇窗一宽一窄：成员这扇窄、设置那扇 760，见 check-project-settings-panel.mts A2b；屏不够宽时两侧各让 16px）`,
    mgRaw ? `→ max-width ${mg.maxWidth} 实宽 ${mg.p.w.toFixed(2)}｜视口 ${mg.innerW}×${mg.innerH}` : '→ 量不到')
  check(!!mgRaw && mg.p.t >= 16 - 0.6 && mg.innerH - mg.p.b >= 16 - 0.6,
    'C45 整张卡在视口里、上下各留得出 16px（不再是铺满主区那一大片）',
    mgRaw ? `→ 顶 ${mg.p.t.toFixed(2)} 底余 ${(mg.innerH - mg.p.b).toFixed(2)} 卡高 ${mg.p.h.toFixed(2)}` : '→ 量不到')
  check(!!mgRaw && mg.s.l <= 0.6 && mg.s.t <= 0.6 && near(mg.s.r, mg.innerW) && near(mg.s.b, mg.innerH),
    'C46 遮罩铺满整屏（fixed inset-0）：这扇窗现在管的是整个视口',
    mgRaw ? `→ 遮罩 ${mg.s.l.toFixed(1)}/${mg.s.t.toFixed(1)}→${mg.s.r.toFixed(1)}/${mg.s.b.toFixed(1)}｜视口 ${mg.innerW}×${mg.innerH}` : '→ 量不到')
  check(mg.hitCenter?.inPanel === true, 'C47 卡片正中确实画在最上面', `→ 命中 ${JSON.stringify(mg.hitCenter)}`)
  check(mg.hitOutside?.inScrim === true && mg.hitOutside?.inPanel === false,
    'C48 卡片左边缘外 8px 归遮罩（点外面收窗那条路还在）', `→ 命中 ${JSON.stringify(mg.hitOutside)}`)
  check(mg.hitRail?.inScrim === true && mg.hitRail?.inRail === false,
    'C49 窄栏这回落进遮罩底下：窗开着时它画着但点不着（改版前断的是「不盖窄栏」，他点「都改成小弹窗」时认下了这条变化）',
    `→ 窄栏右 ${String(mg.railRight)} 命中 ${JSON.stringify(mg.hitRail)}`)
  check(!!mgRaw && mg.childCount === 2 && mg.headerShrink === '0' && mg.overflowY === 'auto',
    'C50 卡片只有两层：窗头（flex-shrink 0，钉着）＋正文（overflow-y auto，自己滚）',
    `→ ${mg.childCount} 层｜窗头 ${mg.headerShrink}｜正文 ${mg.overflowY}`)
  check(!!mgRaw && mg.bodyHScroll === false,
    `C51 缩到 ${MODAL_WIDTH}px 之后名单不许横向溢出（挤一条横滚出来就等于有人读不全）`,
    mgRaw ? `→ 横滚 ${String(mg.bodyHScroll)}｜卡宽 ${mg.p.w.toFixed(2)}` : '→ 量不到')

  // 叠放那三条要一位真能撤的成员：C26 已经撤掉了，这里照界面自己的路再加回来。
  console.log(`  重新把 PMM Free 加回名单（给下面那三条真点一次的机会）`)
  await click(page, ADD_BUTTON)
  check(await waitFor(page, `${ROW}.find(r => r.textContent.includes('PMM Free'))`, 30_000), 'C51b 名单里又有 PMM Free')

  console.log(`  真指针点那行的「移除」→ ${await realClick(page, REMOVE_FREE)}`)
  check(await waitFor(page, `[...${CONFIRM}].length > 0`, 20_000), 'C52 确认框弹出来了')
  await sleep(700)
  const st = await stacking(page)
  check(!!st, 'C53 确认框和小弹窗同时画着、量得到叠放（量不到＝确认没真叠上去）', st ? '' : '→ 两者不同时在')
  check(!!st && st.mid?.inConfirm === true && st.mid?.inPanel === false,
    'C54 确认框正中归确认框、不归成员卡片（elementFromPoint 才是「谁在上面」的答案：两层同一个 z-50，比数字没意义）',
    `→ 命中 ${JSON.stringify(st?.mid)}`)
  check(!!st && st.afterPanel === true,
    'C55 确认框在 DOM 里排在卡片之后（后挂载才后画：靠门户的挂载顺序，不是靠谁写了更大的 z）', `→ ${JSON.stringify(st?.afterPanel)}`)
  check(!!st && st.focusInConfirm === true,
    'C56 真指针点下去之后焦点进了确认框（焦点没跟着跳上来，键盘用户就在窗后头瞎按）', `→ 焦点在 ${String(st?.focusTag)}`)
  console.log(`  真键盘 Escape → ${await realPressKey(page, 'Escape', 27)}`)
  check(await waitFor(page, `[...${CONFIRM}].length === 0`, 20_000), 'C57 Escape 关掉确认框')
  const openAfterEsc = Number(await evalJs(page, `document.querySelectorAll(${JSON.stringify(OVERLAY)}).length`))
  const panelStill = String(await evalJs(page, `(${PANEL}) ? 'yes' : 'no'`))
  check(openAfterEsc === 1 && panelStill === 'yes',
    'C58 Escape 只关上面那层：成员窗还在（按前 1 枚遮罩、按后还是 1 枚，不是两层一起被带走）', `→ 遮罩 ${openAfterEsc} 枚｜卡片 ${panelStill}`)
  await sleep(600)
  const back = await focusWhere(page, `${ROW}.find(r => r.textContent.includes('PMM Free')) ?? null`)
  check(back.inside === true,
    'C59 确认框收掉后焦点回到名单里那一行（不是掉回 <body>：Radix 的模态窗关掉只还原给它自己的 Trigger，这页没有那枚子节点，得自己接住）',
    `→ 焦点 ${back.tag} ${JSON.stringify(back.text)}`)
  const notRemoved = await prisma.projectMember.count({ where: { projectId: project.id, userId: freeUser.id } })
  const rowCountEsc = Number(await evalJs(page, `${ROW}.length`))
  check(notRemoved === 1 && rowCountEsc === 4,
    'C60 Escape 是取消不是确认：库里那条授权还在、名单还是四行', `→ 库 ${notRemoved} 行｜名单 ${rowCountEsc} 行`)

  // 窄屏那枚（卡片态）也带同一块菜单：不许把行为钉在 bare 条件上。
  await run(page, `/studio/projects/${project.id}`)
  check(await waitFor(page, TRIGGER, 90_000), 'C61 整页重载后身份块又画出来了')
  await page.s('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 1, mobile: false })
  check(await waitFor(page, TRIGGER, 30_000), 'C62 压到 900px 后卡片态那枚画出来了')
  await sleep(800)
  console.log(`  窄屏点身份块 → ${await click(page, TRIGGER)}`)
  await sleep(500)
  const smallItem = String(await evalJs(page, `(() => { const i = (${MENU_ITEM('成员管理')}); return i ? 'yes' : 'no' })()`))
  check(smallItem === 'yes', 'C63 窄屏那枚菜单里也有第四行（没绑在 bare 那支上）')
  await page.s('Emulation.clearDeviceMetricsOverride')
  await closePageSafe(page)

  // ── D 组：结构（把「机制」钉住，别让下次改动悄悄换掉它）─────────────────
  const actions = readSource('components/ProjectActions.tsx') || ''
  check((actions.match(/<MenuItem/g) || []).length === 4, 'D1 身份块菜单就是四行 MenuItem', `→ ${String((actions.match(/<MenuItem/g) || []).length)} 枚`)
  check(/onOpenMembers/.test(actions), 'D2 第四行把「开成员浮层」交给页面（跟那三节一样的接线）')
  const pageSrc = readSource('app/studio/projects/[id]/page.tsx') || ''
  check(/ProjectMembersPanel/.test(pageSrc) && /kind:\s*'members'/.test(pageSrc), 'D3 页面用同一枚浮层状态挂成员窗（互斥是结构来的，不是两处 setState 互相记得）')
  const access = readSource('lib/project-access.ts') || ''
  const routeSrc = readSource('app/api/projects/[id]/route.ts') || ''
  const membersRoute = readSource('app/api/projects/[id]/members/route.ts') || ''
  const memberDeleteRoute = readSource('app/api/projects/[id]/members/[userId]/route.ts') || ''
  check(/export function projectViewersWhere/.test(access), 'D4 人数口径只有一份：project-access 导出那枚共享 where 提供者', `→ ${JSON.stringify(/export function projectViewersWhere[^\n]*/.exec(access)?.[0]?.slice(0, 46) ?? '')}`)
  check(/projectViewersWhere/.test(routeSrc) && /projectViewersWhere/.test(membersRoute),
    'D5 详情路由与成员名单都从它取（第三份 OR 条件是下一次改动的定时炸弹）')
  check(!/ASSIGNED_ONLY/.test(routeSrc) || /ASSIGNED_ONLY/.test(access),
    'D6 详情路由里不再自己留一份判定（要留就得和共享那份同源）')
  for (const [name, src] of [['POST/GET', membersRoute], ['DELETE', memberDeleteRoute]] as const) {
    check(/canAdministerProject/.test(src) && /requireProjectWritable/.test(src),
      `D7 ${name} 那条路同时过 OWNER/ADMIN 闸门与全站写闸门`, `→ ${src ? '文件在' : '文件不存在'}`)
  }
  const overlayShared = readSource('components/ProjectOverlay.tsx') || ''
  const panelSrc = readSource('components/ProjectMembersPanel.tsx') || ''
  check(/export function ProjectOverlay/.test(overlayShared) && /ProjectOverlay/.test(panelSrc) && /ProjectOverlay/.test(readSource('components/ProjectSettingsPanel.tsx') || ''),
    'D8 浮层外壳只有一份，设置窗与成员窗共用（复制一份 fixed＋scrim＋Escape 是下一处的漂移）')
  check(!/function SettingsOverlay/.test(readSource('components/ProjectSettingsPanel.tsx') || ''), 'D9 设置面板不再自己留着那层外壳')

  // 「受限」这列 10-04 他自己点单加在「新建项目」那一路（对标 frame.io restricted），迁移随代码同批上线。
  // D10 从原来的「不许冒出这列」改成钉住这次落地的三个形态：默认关、迁移在盘上、写成 NOT NULL DEFAULT false。
  // 默认关这条最关键——上线那天存量项目要是全变受限，等于把所有人的项目藏起来。
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  check(/restricted\s+Boolean\s+@default\(false\)/.test(schema),
    'D10 schema 里那列＝restricted Boolean @default(false)（默认关＝这次上线不把存量项目一起变成受限）',
    `→ ${JSON.stringify(/restricted\s+Boolean[^\n]*/.exec(schema)?.[0] ?? '没有这列')}`)
  const MIGRATION_DIR = 'prisma/migrations/20261004120000_add_project_restricted'
  const migrationSql = existsSync(`${MIGRATION_DIR}/migration.sql`) ? readFileSync(`${MIGRATION_DIR}/migration.sql`, 'utf8') : ''
  check(/ADD COLUMN\s+"restricted" BOOLEAN NOT NULL DEFAULT false/.test(migrationSql),
    'D10b 迁移在盘上且写成 NOT NULL DEFAULT false（schema 有列而库里没列，`prisma migrate deploy` 那天应用一查就崩；写不成 DEFAULT 则存量行填不进值，迁移直接失败）',
    `→ ${JSON.stringify(migrationSql.replace(/^--.*$/gm, '').trim().slice(0, 80))}`)
  // 他点单的受限开关在「新建项目」弹窗里，不在这扇窗；名单这条路要是哪天自己读 restricted，就是第三份口径。
  check(!/restricted/.test(membersRoute) && !/restricted/.test(panelSrc), 'D11 名单这扇窗与这条路都不掺和受限（口径仍是「能打开这个项目的人」那一份）')

  // 旧判据必须跟着改，否则它继续按三行断言、新那一行被删掉也不会响。
  const switcher = readFileSync('scripts/check-project-info-switcher.mts', 'utf8')
  check(switcher.includes("'成员管理'"), 'D12 身份块那份判据已把第四行算进去（旧判据不跟着改就是假绿）')

  // ── E 组：四语言 ───────────────────────────────────────────────────────
  // 这一排就是面板与菜单实际消费的 key：projectMembersEmpty 早就没有消费者了
  // （空态分「一个人都没剩下」和「搜不到」两句，见 C19），留着它只会让 E1 断一句界面画不出来的话。
  const KEYS = ['projectMembers', 'projectMembersTitle', 'projectMembersSection', 'projectMembersAddSection',
    'projectMembersSearchPlaceholder', 'projectMembersNoCandidates', 'projectMembersAllAdded',
    'projectMembersSourceAdmin', 'projectMembersSourceAllProjects',
    'projectMembersSourceAssigned', 'projectMembersRemoveBlockedHint', 'projectMembersAdded', 'projectMembersRemoved',
    'projectMembersRemoveConfirm']
  const locales = ['zh', 'en', 'de', 'nl'] as const
  for (const locale of locales) {
    const section = JSON.parse(readFileSync(`src/locales/${locale}.json`, 'utf8')).projects || {}
    const missing = KEYS.filter(key => typeof section[key] !== 'string' || !section[key].trim())
    check(missing.length === 0, `E1 ${locale} 补齐 ${KEYS.length} 个成员面板新 key`, missing.length ? `→ 缺 ${missing.join('/')}` : '')
    check(/\{title\}/.test(section.projectMembersTitle || ''), `E2 ${locale} 窗头那句插项目名`, `→ ${JSON.stringify(section.projectMembersTitle || '')}`)
    check(/\{name\}/.test(section.projectMembersAdded || '') && /\{name\}/.test(section.projectMembersRemoved || ''),
      `E3 ${locale} 添加/移除的回执写的是「谁」，不是「操作成功」`, `→ ${JSON.stringify([section.projectMembersAdded, section.projectMembersRemoved])}`)
  }
  const zhSection = JSON.parse(readFileSync('src/locales/zh.json', 'utf8')).projects || {}
  check(zhSection.projectMembers === '成员管理', 'E4 中文那行就叫「成员管理」（跟他点单的原话同一个词）', `→ ${JSON.stringify(zhSection.projectMembers)}`)
  const zhChips = [zhSection.projectMembersSourceAdmin, zhSection.projectMembersSourceAllProjects, zhSection.projectMembersSourceAssigned]
  check(zhChips[0] !== zhChips[1] && zhChips[1] !== zhChips[2],
    'E5 三枚来源标签是三句不同的话（一个词盖不住三种由来）', `→ ${JSON.stringify(zhChips)}`)
  check(JSON.stringify(zhChips) === JSON.stringify(['团队管理员', '全部项目', '已授权本项目']),
    'E5b 中文这三句就是 C13 在界面里等的那三句（改了 locale 而判据没跟着改，界面条断言就成了假绿）', `→ ${JSON.stringify(zhChips)}`)
  for (const locale of locales) {
    const all = readFileSync(`src/locales/${locale}.json`, 'utf8')
    check((all.match(/"projectMembers"/g) || []).length === 1, `E6 ${locale} 新 key 挂对地方（projects 段里一份，没顺手在别处再写一枚）`)
  }

  await send('Browser.close').catch(() => null)
} finally {
  chrome?.kill()
  rmSync(userDataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 })
  try { ws?.close() } catch { /* already closed */ }
  for (const t of tokens) await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${t}` } }).catch(() => null)
  const teamRows = await prisma.team.findMany({ where: { slug: { in: [teamSlug, otherSlug] } }, select: { id: true } })
  const ids = teamRows.map(t => t.id)
  const projectIds = (await prisma.project.findMany({ where: { teamId: { in: ids } }, select: { id: true } })).map(p => p.id)
  await prisma.shareLink.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => null)
  await prisma.projectMember.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => null)
  await prisma.project.deleteMany({ where: { teamId: { in: ids } } }).catch(() => null)
  await prisma.teamMember.deleteMany({ where: { teamId: { in: ids } } }).catch(() => null)
  await prisma.team.deleteMany({ where: { id: { in: ids } } }).catch(() => null)
  await prisma.user.deleteMany({ where: { email: { startsWith: 'pmm-', contains: String(stamp) } } }).catch(() => null)
  const left = {
    teams: await prisma.team.count({ where: { slug: { in: [teamSlug, otherSlug] } } }),
    projects: await prisma.project.count({ where: { slug: `pmm-${stamp}` } }),
    assignments: await prisma.projectMember.count({ where: { projectId: { in: projectIds } } }),
    users: await prisma.user.count({ where: { email: { startsWith: 'pmm-', contains: String(stamp) } } }),
  }
  check(Object.values(left).every(n => n === 0), 'Z1 fixture 全部清干净', `→ 剩 ${JSON.stringify(left)}`)
  await prisma.$disconnect()
}

async function closePageSafe(page: Page) {
  await send('Target.closeTarget', { targetId: page.targetId }).catch(() => null)
  await send('Target.disposeBrowserContext', { browserContextId: page.browserContextId }).catch(() => null)
  await sleep(400)
}

if (failures.length) {
  console.log(`\n${failures.length} 条未过：`)
  for (const x of failures) console.log(` - ${x}`)
  process.exit(1)
}
console.log('\n全部通过')
console.log('未证清单（这份判据证不到的，转人工）：真硬件键盘与读屏焦点遍历、英文／德文／荷兰文界面下的行宽、四套主题下来源标签的字色、手机视口（本站后台窄屏只到卡片态）。')
