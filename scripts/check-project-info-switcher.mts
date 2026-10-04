import { spawn, type ChildProcess } from 'node:child_process'
import { rmSync } from 'node:fs'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/encryption'

/**
 * 他 10-03 点单的「项目信息身份块照 Frame.io 那排复刻」的判据（改动点 1-5 全上，4 保留现在的口径）：
 *  A 组 视觉：封面块→文字 16px、第二行不带图标且 14px、身份块上内边距 20px、
 *    措辞改成「N 位成员」但数字仍旧是接口给的 memberCount（他上一轮刚纠正过口径，不许换成团队人数）。
 *  B 组 行为：整块是一枚弹出式按钮（对标那排也是整块可点），点开是项目菜单。
 *    菜单原本给了三项（设置／归档／删除），他 10-03 看完截图把后两项点掉；10-04 又把设置那三节
 *    （项目详情／客户信息与通知／客户分享页面）搬进这排，于是菜单＝那三节、点哪项浮层落在哪项；
 *    同日再点单加第四行「成员管理」，开的是同一层浮栏里的成员名单。
 *    B21/B15/B16 是在替「删的是菜单里的行、动作本身还在面板那两枚按钮上、照旧先弹确认窗」作证。
 *    键盘（Escape／方向键）与点外面都要关得掉。
 *  B22/B23/A8/A9/B4/B4b 是他 10-03 第二轮「这个细节真的差，按对标图的样式调」加的红：
 *    拿同一枚 Edge 窗口的两张 1484×768 截图（对标那张＋我们那张）同尺度对着量的——
 *    封面块里那枚白色文件夹图标对标没有（A8）、那块渐变两端要真的走得开而不是黑压黑（A9）、
 *    箭头那枚跟它自己的标题几乎同色而不是跟弱档同灰（B4/B4b）、
 *    弹层跟身份块同宽不带描边底色吃 --popover（B8/B22/B23）。
 *    唯一没照搬的是整块尺寸：同一张比例尺下（我们这块封面 48px＝29 图像像素、间距 16px＝9 图像像素两把尺对得上）
 *    对标那块是 20×21 图像像素、我们是 29×28，即我们大 30-45%；但「块高 ÷ 两行文字高」两侧都是 1.2-1.3，
 *    说明整块是等比放大，不是排错了——这条留着他一句话再定。
 * 登录只在浏览器里做（会话指纹绑设备头＋UA，Node 侧令牌在浏览器一刷就烧掉整枚会话）。
 * CDP 用 Node 内置 WebSocket，零依赖。页面里跑的代码零反斜杠（模板字面量会吃掉 \s \d）。
 */
const BASE = process.env.INFO_CHECK_BASE || 'http://localhost:3000'
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const prisma = new PrismaClient()
const stamp = Date.now()
const failures: string[] = []
const teamSlug = `info-menu-${stamp}`
const pw = `info-menu-${stamp}`
const cdpPort = 9300 + (stamp % 600)
const userDataDir = join(tmpdir(), `info-menu-${stamp}`)
const tokens: string[] = []
const OWNER = { email: `info-owner-${stamp}@example.invalid`, name: 'Info Owner' }
const MEMBER = { email: `info-member-${stamp}@example.invalid`, name: 'Info Member' }
let chrome: ChildProcess | undefined

function check(ok: boolean, label: string, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` ${detail}` : ''}`)
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** 对比度实算：菜单那三行不许我"看着还行"就放过（craft floor：正文 ≥4.5:1）。 */
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

async function closePage(page: Page) {
  await send('Target.closeTarget', { targetId: page.targetId }).catch(() => null)
  await send('Target.disposeBrowserContext', { browserContextId: page.browserContextId }).catch(() => null)
  await sleep(400)
}

async function loginInBrowser(page: Page, email: string) {
  const deviceId = `info-${stamp}-${email.slice(0, 6)}`
  await page.s('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.setItem('vitransfer_device_id', ${JSON.stringify(deviceId)})`,
  })
  await run(page, '/login')
  if (!await waitFor(page, `document.body && document.body.children.length > 0`, 90_000)) return 'no-page'
  return String(await evalJs(page, `(async () => {
    const r = await fetch('/api/auth/login', { method: 'POST', cache: 'no-store',
      headers: { 'content-type': 'application/json', 'X-ViTransfer-Device-ID': ${JSON.stringify(deviceId)} },
      body: JSON.stringify({ email: ${JSON.stringify(email)}, password: ${JSON.stringify(pw)} }) })
    const j = await r.json().catch(() => null)
    if (j?.tokens?.refreshToken) localStorage.setItem('vitransfer_refresh_token', j.tokens.refreshToken)
    return r.status + ' ' + (j?.tokens?.refreshToken ? 'session' : JSON.stringify(j?.error ?? '').slice(0, 90))
  })()`))
}

/** 看得见的身份块（这组件在项目页挂两枚：侧栏 bare 与窄屏 aside，按可见挑）。 */
const TRIGGER = `[...document.querySelectorAll('[data-tutorial="project-info-trigger"]')].filter(b => b.offsetParent !== null)[0]`

/** 几何判据证不了「看着对不对」：SHOT_DIR 给了就把这两态存成图，我自己眼里过一遍。 */
async function shot(page: Page, name: string, clip: { x: number; y: number; width: number; height: number }) {
  const dir = process.env.SHOT_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  const { data } = await page.s('Page.captureScreenshot', { clip: { ...clip, scale: 2 } })
  writeFileSync(join(dir, `${name}.png`), Buffer.from(data, 'base64'))
  console.log(`截图 → ${dir}/${name}.png`)
}

/** 身份块画出来的事实：几何、字号、第二行画了什么、按钮属性、菜单。 */
async function blockFacts(page: Page) {
  return JSON.parse(String(await evalJs(page, `(() => {
    const btn = ${TRIGGER}
    if (!btn) return JSON.stringify({ missing: true, total: document.querySelectorAll('[data-tutorial="project-info-trigger"]').length })
    const kids = [...btn.children]
    const cover = kids[0], middle = kids[1], chevron = kids[kids.length - 1]
    const cbox = cover ? cover.getBoundingClientRect() : null
    const mbox = middle ? middle.getBoundingClientRect() : null
    const title = middle ? middle.children[0] : null
    const line2 = middle ? middle.children[1] : null
    const line2p = line2 ? (line2.querySelector('p') || line2) : null
    const header = btn.parentElement ? btn.parentElement.parentElement : null
    const hcs = header ? getComputedStyle(header) : null
    const ccs = cover ? getComputedStyle(cover) : null
    const chevBox = chevron ? chevron.getBoundingClientRect() : null
    return JSON.stringify({
      gap: cbox && mbox ? Math.round(mbox.left - cbox.right) : null,
      coverW: cbox ? Math.round(cbox.width) : null,
      coverH: cbox ? Math.round(cbox.height) : null,
      coverRadius: ccs ? ccs.borderRadius : null,
      coverSvgs: cover ? cover.querySelectorAll('svg').length : null,
      coverBgImage: ccs ? ccs.backgroundImage : null,
      titleSize: title ? getComputedStyle(title).fontSize : null,
      titleColor: title ? getComputedStyle(title).color : null,
      line2Text: line2p ? line2p.textContent.trim() : null,
      line2Size: line2p ? getComputedStyle(line2p).fontSize : null,
      line2Svgs: line2 ? line2.querySelectorAll('svg').length : null,
      line2Color: line2p ? getComputedStyle(line2p).color : null,
      headerPadTop: hcs ? hcs.paddingTop : null,
      headerPadBottom: hcs ? hcs.paddingBottom : null,
      gapAboveBlock: (() => {
        const panel = document.getElementById('project-info-panel')
        const first = panel ? panel.firstElementChild : null
        const r = first ? first.getBoundingClientRect() : null
        return r && cbox ? Math.round(cbox.top - r.top) : null
      })(),
      tag: btn.tagName.toLowerCase(),
      haspopup: btn.getAttribute('aria-haspopup'),
      expanded: btn.getAttribute('aria-expanded'),
      chevronSize: chevBox ? [Math.round(chevBox.width), Math.round(chevBox.height)] : null,
      chevronColor: chevron ? getComputedStyle(chevron).color : null,
      blockRect: (() => { const r = btn.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] })(),
    })
  })()`)))
}

/** 菜单画出来的事实：项次序列、几何、焦点落点。 */
async function menuFacts(page: Page) {
  return JSON.parse(String(await evalJs(page, `(() => {
    const menu = [...document.querySelectorAll('[role="menu"]')].filter(m => m.offsetParent !== null)[0]
    if (!menu) return JSON.stringify({ open: false, anyMenu: document.querySelectorAll('[role="menu"]').length })
    const items = [...menu.querySelectorAll('[role="menuitem"]')].filter(i => i.offsetParent !== null)
    const mr = menu.getBoundingClientRect()
    const btn = ${TRIGGER}
    const br = btn.getBoundingClientRect()
    const active = document.activeElement
    const probe = document.createElement('div')
    probe.className = 'bg-popover'
    document.body.appendChild(probe)
    const popoverColor = getComputedStyle(probe).backgroundColor
    probe.remove()
    const mcs = getComputedStyle(menu)
    // 换到 frame 主题再读一次底色：那套主题下 --card 是灰片、--popover 是纯白，
    // 只有真吃了 --popover 的弹层才会跟着翻白。不换主题这两枚 token 同值，断言就是假的。
    const root = document.documentElement
    const prevTheme = root.getAttribute('data-theme')
    root.setAttribute('data-theme', 'frame')
    const bgInFrame = getComputedStyle(menu).backgroundColor
    if (prevTheme === null) root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', prevTheme)
    return JSON.stringify({
      open: true,
      bgInFrame,
      menuBorderTopWidth: mcs.borderTopWidth,
      menuBorderTopStyle: mcs.borderTopStyle,
      triggerWidth: Math.round(br.width),
      popoverColor,
      texts: items.map(i => i.textContent.trim()),
      disabled: items.map(i => Boolean(i.disabled)),
      menuBg: getComputedStyle(menu).backgroundColor,
      itemColors: items.map(i => getComputedStyle(i.querySelector('span') ?? i).color),
      itemIconColors: items.map(i => { const s = i.querySelector('svg'); return s ? getComputedStyle(s).color : null }),
      itemSizes: items.map(i => getComputedStyle(i).fontSize),
      left: Math.round(mr.left), top: Math.round(mr.top), right: Math.round(mr.right), width: Math.round(mr.width),
      triggerRight: Math.round(br.right),
      inSidebar: (() => {
        const side = menu.closest('section')
        return side ? Math.round(side.getBoundingClientRect().right) : null
      })(),
      focusText: active ? active.textContent.trim() : null,
      focusIsItem: Boolean(active && active.closest && active.closest('[role="menu"]')),
    })
  })()`)))
}

async function click(page: Page, expr: string) {
  return evalJs(page, `(() => { const el = (${expr}); if (!el) return 'not-found'; el.click(); return 'clicked' })()`)
}

/**
 * 按键走页面内的 KeyboardEvent（target＝当前焦点，bubbles）。
 * 为什么不用 CDP Input.dispatchKeyEvent：这一趟实测连着两次 Runtime.evaluate 拿不到回包、
 * Chrome 那条连接死掉，判据跑不完。这里断的是「本组件自己那套 keydown 处理接得住」，
 * 真硬件键盘／读屏的焦点遍历不在这份判据的承诺里，跑完会打印在未证清单。
 */
async function pressKey(page: Page, key: string) {
  return evalJs(page, `(() => {
    const target = document.activeElement || document.body
    const fired = target.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }))
    target.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }))
    return JSON.stringify({ from: target.tagName.toLowerCase(), notCancelledByDefault: fired })
  })()`)
}

try {
  // ── fixture：一枚团队 + 两个成员 + 一枚项目（人数口径要真数字）──────────
  const owner = await prisma.user.create({ data: { email: OWNER.email, name: OWNER.name, password: await hashPassword(pw), phone: `138${String(stamp).slice(-8)}` } })
  const member = await prisma.user.create({ data: { email: MEMBER.email, name: MEMBER.name, password: await hashPassword(pw), phone: `137${String(stamp).slice(-8)}` } })
  const team = await prisma.team.create({
    data: {
      name: teamSlug, slug: teamSlug, shareKey: teamSlug, createdById: owner.id, subscriptionPlan: 'BETA',
      members: { create: [
        { userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
        { userId: member.id, role: 'MEMBER', status: 'ACTIVE' },
      ] },
    },
  })
  const project = await prisma.project.create({
    data: { teamId: team.id, createdById: owner.id, projectCode: `IM${String(stamp).slice(-6)}`, title: `身份块对标-${stamp}`, slug: `im-${stamp}`, shareSlug: `im-s-${stamp}`, allowReverseShare: true },
  })

  const login = await call('POST', '/api/auth/login', '', { email: OWNER.email, password: pw })
  const adminToken = login.json?.tokens?.accessToken as string | undefined
  if (!adminToken) throw new Error(`登录失败 → ${login.status}`)
  tokens.push(adminToken)

  // 接口给的 memberCount 是「口径没变」的参照物：界面显示的数字必须和它一模一样。
  const api = await call('GET', `/api/projects/${project.id}`, adminToken)
  const apiCount = api.json?.memberCount as number | undefined
  check(typeof apiCount === 'number' && apiCount > 0, 'A0 接口给出真实人数（界面那行的数字要有出处）', `→ GET /api/projects/[id] ${api.status} memberCount=${String(apiCount)}`)

  // dev 冷路由要 20-35 秒：先焐热，否则量到的是 webpack 编译不是产品。
  const warm = async (path: string, headers?: Record<string, string>) => {
    try { return String((await fetch(`${BASE}${path}`, { headers, cache: 'no-store', redirect: 'manual' })).status) }
    catch (e) { return `预热失败 ${(e as Error).message}` }
  }
  for (const p of ['/login', '/studio/projects', `/studio/projects/${project.id}`, `/studio/projects/${project.id}/settings`,
    `/api/projects/${project.id}`, `/api/projects/${project.id}/share-links`, '/api/team-center', '/api/announcements', '/api/comments/for-me',
    `/api/projects/${project.id}/photo-albums`, `/api/projects/${project.id}/recycle-bin`, `/api/projects/${project.id}/project-uploads`]) {
    console.log(`预热 ${p} → ${await warm(p, p.startsWith('/api/') ? { authorization: `Bearer ${adminToken}` } : undefined)}`)
  }

  chrome = await connectChrome()
  const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then(r => r.json())
  await attachSocket(webSocketDebuggerUrl)

  const page = await openPage()
  check(/^200 session$/.test(await loginInBrowser(page, OWNER.email)), 'P0 浏览器内登录')
  await run(page, `/studio/projects/${project.id}`)
  check(await waitFor(page, `${TRIGGER}`, 120_000), 'P1 项目页侧栏的身份块画出来了', '→ 没等到的话就是 data-tutorial 没挂上')
  await sleep(1_200)

  // ── A 组：视觉 ─────────────────────────────────────────────────────────
  const f = await blockFacts(page)
  console.log(`  身份块事实 → ${JSON.stringify(f)}`)
  await shot(page, 'info-block-closed', { x: f.blockRect[0] - 12, y: f.blockRect[1] - 46, width: f.blockRect[2] + 24, height: 130 })
  check(f.gap === 16, 'A1 封面块到文字列的间距＝16px（对标量到的数，我们是 12）', `→ 实量 ${String(f.gap)}`)
  check(Number(f.line2Svgs) === 0, 'A2 第二行不再画那枚人形图标（对标那行是纯文字）', `→ 行内 svg ${String(f.line2Svgs)} 枚`)
  check(f.line2Size === '14px', 'A3 第二行字号 14px（原来吃 text-sm＝13.125px）', `→ 实测 ${String(f.line2Size)}`)
  check(f.headerPadTop === '20px', 'A4 身份块上内边距 20px（对标那块离栏顶 20px，我们 bare 是 0）', `→ paddingTop ${String(f.headerPadTop)}`)
  check(f.headerPadBottom === '11.25px', 'A4b 身份块下那条线没被顺手改掉（pb-3 在 15px 根字号下＝11.25px）', `→ paddingBottom ${String(f.headerPadBottom)}`)
  check(f.line2Text === `${apiCount} 位成员`, 'A5 措辞对齐「N 位成员」，数字仍是接口那个 memberCount（口径保留现在的）', `→ 界面 ${JSON.stringify(f.line2Text)}／接口 ${String(apiCount)}`)
  check(f.titleSize === '20px' && f.coverW === 48 && f.coverH === 48 && f.coverRadius === '8px',
    'A6 护栏：名称 20px、封面块 48×48、圆角 8px 一字没动', `→ ${JSON.stringify([f.titleSize, f.coverW, f.coverH, f.coverRadius])}`)
  check(Number(f.gapAboveBlock) >= 20 && Number(f.gapAboveBlock) <= 26, 'A7 折叠标题到封面块的实际留白在 20px 上下（这是画出来的距离，不是我只看 computed）', `→ ${String(f.gapAboveBlock)}px`)
  check(Number(f.coverSvgs) === 0, 'A8 封面块里不再画那枚白色文件夹图标（对标那块是纯渐变面，10-03 同尺度截图两侧对比出来的）', `→ 块内 svg ${String(f.coverSvgs)} 枚`)
  check(/255,\s*255,\s*255/.test(String(f.coverBgImage)), 'A9 封面块的对角渐变有一端是提亮（原来是黑→更黑，看着是一块实心）', `→ ${String(f.coverBgImage)}`)

  // ── B 组：整块可点出项目菜单 ───────────────────────────────────────────
  check(f.tag === 'button' && f.haspopup === 'menu', 'B1 整块是一枚弹出式按钮（对标那排整块可点，不是只有箭头能点）', `→ tag ${String(f.tag)} aria-haspopup ${String(f.haspopup)}`)
  check(f.expanded === 'false', 'B2 没点开时 aria-expanded=false（读屏才知道现在是关着）', `→ ${String(f.expanded)}`)
  check(Array.isArray(f.chevronSize) && f.chevronSize[0] === 16 && f.chevronSize[1] === 16, 'B3 右侧那枚上下箭头 16×16（对标量的就是 16）', `→ ${JSON.stringify(f.chevronSize)}`)
  check(/^rgb/.test(String(f.chevronColor)) && f.chevronColor === f.titleColor,
    'B4 箭头跟名称同色（对标那枚箭头最暗像素 (76,80,99) 几乎就是它标题的 (63,65,77)；我们原来吃 --muted-foreground，实量最暗只到 (138,141,156)）',
    `→ 箭头 ${String(f.chevronColor)} 名称 ${String(f.titleColor)}`)
  check(f.chevronColor !== f.line2Color, 'B4b 箭头不再和第二行同灰（第二行是对标的弱档，箭头不是）', `→ 箭头 ${String(f.chevronColor)} 第二行 ${String(f.line2Color)}`)

  console.log(`  点身份块 → ${await click(page, `${TRIGGER}`)}`)
  const opened = await waitFor(page, `[...document.querySelectorAll('[role="menu"]')].filter(m => m.offsetParent !== null).length`, 20_000)
  const m1 = await menuFacts(page)
  check(Boolean(opened) && m1.open, 'B5 点一下把项目菜单弹出来', `→ ${JSON.stringify(m1).slice(0, 120)}`)
  await shot(page, 'info-menu-open', { x: f.blockRect[0] - 12, y: f.blockRect[1] - 46, width: f.blockRect[2] + 24, height: 240 })
  const expandedNow = String(await evalJs(page, `(() => { const b = ${TRIGGER}; return b ? b.getAttribute('aria-expanded') : null })()`))
  check(expandedNow === 'true', 'B6 弹出后 aria-expanded 翻成 true', `→ ${expandedNow}`)
  check(JSON.stringify(m1.texts) === JSON.stringify(['项目详情', '客户信息与通知', '客户分享页面', '成员管理']),
    'B7 菜单里那四行＝设置那三节＋成员管理（他 10-04 把这三项搬进这排菜单，原来单列的「项目设置」不再自己占一行；10-04 又点单加第四行成员）', `→ ${JSON.stringify(m1.texts)}`)
  check(m1.left === (f.blockRect?.[0] ?? -1) && Math.abs(m1.width - m1.triggerWidth) <= 1,
    'B8 菜单与身份块同宽同左缘（对标那块弹层占栏宽 0.94、左缘就贴着那块封面，不是 210px 一张小卡）',
    `→ 块 left ${String(f.blockRect?.[0])} 宽 ${String(f.blockRect?.[2])} / 菜单 left ${m1.left} 宽 ${m1.width}`)
  check(m1.inSidebar === null || m1.right <= m1.inSidebar, 'B9 菜单右缘没被侧栏那块的 overflow 裁掉（裁了就点不到那一项）', `→ 菜单右 ${m1.right}／侧栏右 ${m1.inSidebar}`)
  check(m1.menuBorderTopStyle === 'none' || m1.menuBorderTopWidth === '0px',
    'B22 菜单不带描边（对标那层只有投影浮着，一圈 1px 边框是本站自己的手搓味）',
    `→ ${String(m1.menuBorderTopStyle)} ${String(m1.menuBorderTopWidth)}`)
  check(m1.menuBg === m1.popoverColor && m1.bgInFrame === 'rgb(255, 255, 255)',
    'B23 菜单底色吃 --popover（对标是浮在浅栏上的纯白；bg-card 在 frame 主题下是 #f2f3f6 灰片。换到那套主题量一次才算数，默认主题这两枚 token 同值）',
    `→ 默认 ${String(m1.menuBg)}／popover ${String(m1.popoverColor)}／frame 下 ${String(m1.bgInFrame)}`)

  const menuBg = rgbOf(String(m1.menuBg))
  const ratio = (c: string) => {
    const rgb = rgbOf(c)
    return rgb && menuBg ? Number(contrast(rgb, menuBg).toFixed(2)) : null
  }
  const itemRatios = (m1.itemColors || []).map((c: string) => ratio(c))
  check(itemRatios.length === 4 && itemRatios.every((r: number | null) => r !== null && r >= 4.5),
    'B19 四行标签字色压菜单底到 4.5:1（getComputedStyle 反查实算，不是我看着还行）', `→ 底 ${String(m1.menuBg)} 比值 ${JSON.stringify(itemRatios)}`)
  const iconRatios = (m1.itemIconColors || []).map((c: string | null) => (c ? ratio(c) : null))
  check(iconRatios.length === 4 && iconRatios.every((r: number | null) => r !== null && r >= 3),
    'B19b 四行图标压菜单底到 3:1（WCAG 非文本下限）', `→ ${JSON.stringify(iconRatios)}`)
  check((m1.itemSizes || []).every((s: string) => s === '14px'), 'B20 菜单行 14px（不吃控件阶梯压平后的 text-sm）', `→ ${JSON.stringify(m1.itemSizes)}`)

  console.log(`  Escape → ${JSON.stringify(await pressKey(page, 'Escape'))}`)
  await sleep(500)
  const afterEsc = await menuFacts(page)
  const focusBack = String(await evalJs(page, `(() => { const a = document.activeElement; const b = ${TRIGGER}; return a && b && a === b ? 'trigger' : (a ? a.tagName.toLowerCase() : 'none') })()`))
  check(m1.open && afterEsc.open === false, 'B10 Escape 关得掉', `→ ${JSON.stringify(afterEsc).slice(0, 100)}`)
  check(focusBack === 'trigger', 'B11 关掉后焦点回到身份块（不然键盘用户掉进页面里找不着北）', `→ activeElement ${focusBack}`)

  console.log(`  再点开 → ${await click(page, `${TRIGGER}`)}`)
  await waitFor(page, `[...document.querySelectorAll('[role="menu"]')].filter(m => m.offsetParent !== null).length`, 20_000)
  await pressKey(page, 'ArrowDown')
  await sleep(300)
  const mDown = await menuFacts(page)
  check(mDown.open && mDown.focusIsItem && mDown.focusText === '项目详情',
    'B12 方向键把焦点送进第一项（菜单三项，第一项就是「项目详情」）', `→ 焦点 ${JSON.stringify(mDown.focusText)}`)
  await pressKey(page, 'ArrowDown')
  await sleep(300)
  const mDown2 = await menuFacts(page)
  check(mDown2.open && mDown2.focusIsItem && mDown2.focusText === '客户信息与通知',
    'B13 再按一次走到第二项（三项之间真能走，不是钉在唯一那行）', `→ ${JSON.stringify([mDown.focusText, mDown2.focusText])}`)
  await pressKey(page, 'ArrowUp')
  await sleep(300)
  const mUp = await menuFacts(page)
  check(mUp.open && mUp.focusText === '项目详情', 'B13b 往上按走得回来（键盘在这一排不是单向的）', `→ ${JSON.stringify(mUp.focusText)}`)

  // 点外面关掉
  await evalJs(page, `(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return true })()`)
  await sleep(500)
  check((await menuFacts(page)).open === false, 'B14 点外面关得掉（照团队切换器那套手搓下拉的现成规矩）')

  // 他删的是菜单里那两行，动作本身归面板下面那两枚按钮管——这里当场按一遍：
  // 菜单项没了，但「归档项目」还在，而且照旧先弹产品的确认窗，取消之后库里一字不动。
  const PANEL_ARCHIVE = `(() => {
    const btn = ${TRIGGER}
    const section = btn && btn.closest('section')
    return section && [...section.querySelectorAll('button')].filter(b => b.offsetParent !== null && b.innerText.trim() === '归档项目' && !b.closest('[role="menu"]'))[0]
  })()`
  check(await evalJs(page, `Boolean(${PANEL_ARCHIVE})`) === true, 'B21 菜单里删掉那两行后，面板下面那枚「归档项目」按钮还在（删的是入口，不是整个动作）')
  console.log(`  点面板的「归档项目」→ ${await click(page, PANEL_ARCHIVE)}`)
  // Radix 的窗是 position:fixed，fixed 元素的 offsetParent 恒为 null——照菜单那套 filter 会把
  // 真弹出来的确认窗判成「没弹」，所以这里量的是实际占位。
  const DLG = `[...document.querySelectorAll('[role="dialog"]')].filter(d => d.getBoundingClientRect().width > 0)`
  const dlg = await waitFor(page, `${DLG}.length`, 20_000)
  const dlgText = String(await evalJs(page, `(() => { const d = ${DLG}[0]; return d ? d.innerText.replace(/\\s+/g, ' ').slice(0, 80) : '' })()`))
  check(Boolean(dlg) && /存档|归档/.test(dlgText), 'B15 归档弹的是产品那面确认窗（不是直接改状态）', `→ ${JSON.stringify(dlgText)}`)
  console.log(`  点「取消」→ ${await click(page, `${DLG}[0] ? [...${DLG}[0].querySelectorAll('button')].find(b => b.textContent.trim() === '取消') : null`)}`)
  await sleep(1_200)
  const statusAfterCancel = await prisma.project.findUnique({ where: { id: project.id }, select: { status: true } })
  check(statusAfterCancel?.status === 'IN_REVIEW', 'B16 取消之后库里状态一字未动', `→ ${String(statusAfterCancel?.status)}`)

  // 菜单那三项：10-04 搬家后不再换路由——点哪项，项目页里浮起设置面板并落在那一节。
  await click(page, `${TRIGGER}`)
  await waitFor(page, `[...document.querySelectorAll('[role="menu"]')].filter(m => m.offsetParent !== null).length`, 20_000)
  console.log(`  点「客户分享页面」→ ${await click(page, `[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find(i => i.textContent.trim() === '客户分享页面')`)}`)
  const floated = await waitFor(page, `document.querySelector('[data-tutorial="project-settings-overlay"]')`, 40_000)
  const pathAfterMenu = String(await evalJs(page, 'location.pathname'))
  check(floated && pathAfterMenu === `/studio/projects/${project.id}`,
    'B17 点「客户分享页面」在项目页里浮起设置面板、URL 一字不动（不再是另一条路由）', `→ ${pathAfterMenu}`)
  // 落在哪一节由浮层自己的导航作证：亮着的那一项必须就是刚点的那行（三项各管一节，不是都开在同一节）。
  const litNav = String(await evalJs(page, `(() => {
    const p = document.querySelector('[data-tutorial="project-settings-panel"]')
    if (!p) return 'no-panel'
    const lit = [...p.querySelectorAll('nav button')].filter(b => b.offsetParent !== null && getComputedStyle(b).backgroundColor !== 'rgba(0, 0, 0, 0)')
    return lit.length === 1 ? lit[0].innerText.trim() : ('亮着 ' + lit.length + ' 项')
  })()`))
  check(litNav === '客户分享页面', 'B17b 浮层落在点的那一节（面板导航亮的是「客户分享页面」）', `→ ${JSON.stringify(litNav)}`)

  // 非 bare 那枚（窄屏 aside）也带同一块菜单：不许把行为钉在 bare 条件上。
  // 上一行 B17 之后浮层还开着，这里整页重载拿干净的项目页，并且必须等到 900px 下
  // 卡片态那枚画出来——只等 body 有子节点会在水合前／旧页面上就放行（10-03 就是这样假 FAIL 过一次）。
  await run(page, `/studio/projects/${project.id}`)
  check(await waitFor(page, TRIGGER, 90_000), 'B18a 整页重载后身份块又画出来了（浮层不挡这条路）')
  await page.s('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 1, mobile: false })
  check(await waitFor(page, TRIGGER, 30_000), 'B18b 压到 900px 后卡片态那枚画出来了')
  await sleep(800)
  const smallF = await blockFacts(page)
  check(smallF.missing !== true && smallF.haspopup === 'menu', 'B18 窄屏那枚（卡片态）也是同一块菜单，没被 bare 条件挡掉', `→ ${JSON.stringify(smallF).slice(0, 140)}`)
  await page.s('Emulation.clearDeviceMetricsOverride')

  await closePage(page)

  // ── C 组：四语言 ───────────────────────────────────────────────────────
  const zh = readFileSync('src/locales/zh.json', 'utf8')
  check(zh.includes('"projectMemberCount": "{count} 位成员"'), 'C1 中文那句改成「{count} 位成员」', `→ ${JSON.stringify(/"projectMemberCount":[^\n]*/.exec(zh)?.[0] ?? '')}`)
  const others = ['en', 'de', 'nl'].filter(l => !/"projectMemberCount": "\{count, plural,/.test(readFileSync(`src/locales/${l}.json`, 'utf8')))
  check(others.length === 0, 'C2 英德荷仍是各自的复数句（那句本来就等价于「N 位成员」，不跟着改字面）', others.length ? `→ 动了 ${others.join('/')}` : '')
  const sole = (zh.match(/projectMemberCount/g) || []).length
  check(sole === 1, 'C3 这句全站只有身份块在用（改措辞不会顺带改掉别处的文案）', `→ locale 里出现 ${sole} 次`)
  // 这枚菜单需要一个无障碍名（对标那面 AX 上就叫「项目菜单」），四语言都得有。
  const noMenuLabel = ['zh', 'en', 'de', 'nl'].filter(l => !readFileSync(`src/locales/${l}.json`, 'utf8').includes('"projectMenuLabel"'))
  check(noMenuLabel.length === 0, 'C4 菜单的无障碍名四语言都在', noMenuLabel.length ? `→ 缺 ${noMenuLabel.join('/')}` : '')

  await send('Browser.close').catch(() => null)
} finally {
  chrome?.kill()
  rmSync(userDataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 })
  try { ws?.close() } catch { /* already closed */ }
  for (const t of tokens) await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${t}` } }).catch(() => null)
  const teamRow = await prisma.team.findFirst({ where: { slug: teamSlug }, select: { id: true } })
  if (teamRow) {
    await prisma.shareLink.deleteMany({ where: { projectId: { in: (await prisma.project.findMany({ where: { teamId: teamRow.id }, select: { id: true } })).map(p => p.id) } } })
    await prisma.project.deleteMany({ where: { teamId: teamRow.id } })
    await prisma.teamMember.deleteMany({ where: { teamId: teamRow.id } })
    await prisma.team.deleteMany({ where: { id: teamRow.id } })
  }
  await prisma.user.deleteMany({ where: { email: { in: [OWNER.email, MEMBER.email] } } })
  const left = {
    teams: await prisma.team.count({ where: { slug: teamSlug } }),
    projects: await prisma.project.count({ where: { slug: `im-${stamp}` } }),
    users: await prisma.user.count({ where: { email: { in: [OWNER.email, MEMBER.email] } } }),
  }
  check(Object.values(left).every(n => n === 0), 'Z1 fixture 全部清干净', `→ 剩 ${JSON.stringify(left)}`)
  await prisma.$disconnect()
}

if (failures.length) {
  console.log(`\n${failures.length} 条未过：`)
  for (const x of failures) console.log(` - ${x}`)
  process.exit(1)
}
console.log('\n全部通过')
console.log('未证清单（这份判据证不到的，转浏览器批次或人工）：真硬件键盘与读屏的焦点遍历、英文界面下的菜单项宽度、四主题下的 hover 色。')
