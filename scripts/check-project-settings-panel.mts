import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { rmSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 他 10-03 的话：「把项目设置里面的内容放到外面去」，随后点了 A 方案
 * （A＝项目页内浮一层设置面板，自带那几段导航，内容从设置页抽成共享组件复用，/settings 保留可直链）。
 *
 * 这份判据断的是六件事：
 *  1 入口分两类：身份块菜单那三项（＝设置那三节）＋工具栏与右键菜单的「项目设置」开浮层，URL 必须还停在 /studio/projects/<id>；
 *    两枚「开启收录」不在他点单里，10-04 改回原样——照旧换成 /settings 整页，且 DOM 里 0 枚浮层。
 *  2 浮层盖的是「除全局窄栏以外的整块主区」：面板四边正好坐在 #main-content 内缩 2px 上（顶边贴视口顶，
 *    因为顶栏早就没了、--admin-header-height 实测 0px），窄栏一寸没被盖住、还点得着。
 *  3 栏面照壳层那套：bg-popover + 8px 圆角 + shadow-elevation-lg，缝那 2px 透出来的是半透明遮罩不是实色墙。
 *  4 内容一份不差也不多一份：导航三项、「客户分享页面」八行、「项目详情」四行，与 /settings 直链逐字相等；
 *    上一轮删掉的那十二串一句都不许被搬回来。
 *  5 链路还通：浮层里改名 → 「重新处理」窗 → PATCH → 库里真变了；Escape／点遮罩／关闭钮都能收掉；连开两次只有一枚。
 *  6 搬家不搭车：表单只有一份（路由文件变薄并引用同一组件）、八行 key 全仓只被一个文件引用、
 *    面板引用的 key 四语言齐全、审片页冻结区零 diff。
 *
 * 登录只在浏览器里做（会话指纹绑设备头＋UA，Node 侧令牌在浏览器一刷就烧掉整枚会话）。
 * CDP 用 Node 内置 WebSocket，零依赖。页面里跑的代码零反斜杠。
 * 口令与密钥只从 .env 读进 process.env，绝不落进任何文件与日志。
 */
const BASE = process.env.PANEL_CHECK_BASE || 'http://localhost:3000'
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ROUTE_FILE = 'src/app/studio/projects/[id]/settings/page.tsx'
const PANEL_FILE = 'src/components/ProjectSettingsPanel.tsx'
const PROJECT_PAGE_FILE = 'src/app/studio/projects/[id]/page.tsx'
const ACTIONS_FILE = 'src/components/ProjectActions.tsx'
/** 浮层相对 #main-content 的内缩＝壳层那条缝的宽度（C2.13/14 定死的 2px）。 */
const SEAM = 2

for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const i = line.indexOf('=')
  if (i > 0 && !line.startsWith('#')) {
    const k = line.slice(0, i).trim()
    if (k && !process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, '')
  }
}
const { PrismaClient } = await import('@prisma/client')
const { hashPassword } = await import('../src/lib/encryption')
const prisma = new PrismaClient()

const stamp = Date.now()
const failures: string[] = []
const teamSlug = `panel-${stamp}`
const pw = `panel-${stamp}`
const cdpPort = 9400 + (stamp % 500)
const userDataDir = join(tmpdir(), `panel-${stamp}`)
const OWNER = { email: `panel-owner-${stamp}@example.invalid`, name: 'Panel Owner' }
let chrome: ChildProcess | undefined

/** 上一轮四刀砍掉的十列：搬代码最容易把它们顺手搬回来，这里钉住 0 命中。 */
const PRUNED = ['timestampDisplay', 'previewResolution', 'skipTranscoding', 'applyPreviewLut',
  'usePreviewForApprovedPlayback', 'sharePassword', 'authMode', 'guestMode', 'guestLatestOnly', 'guestShowPhotos']

function check(ok: boolean, label: string, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` ${detail}` : ''}`)
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function zh(key: string) {
  const v = JSON.parse(readFileSync('src/locales/zh.json', 'utf8'))?.projects?.[key]
  return v ?? `!!缺 key:projects.${key}!!`
}
function zhc(key: string) {
  const v = JSON.parse(readFileSync('src/locales/zh.json', 'utf8'))?.common?.[key]
  return v ?? `!!缺 key:common.${key}!!`
}

// ── CDP ────────────────────────────────────────────────────────────────
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
async function run(page: Page, path: string) { await page.s('Page.navigate', { url: `${BASE}${path}` }) }
async function closePage(page: Page) {
  await send('Target.closeTarget', { targetId: page.targetId }).catch(() => null)
  await send('Target.disposeBrowserContext', { browserContextId: page.browserContextId }).catch(() => null)
  await sleep(400)
}
async function click(page: Page, expr: string) {
  return evalJs(page, `(() => { const el = (${expr}); if (!el) return 'not-found'; el.click(); return 'clicked' })()`)
}
/** 按键走页面内的 KeyboardEvent（target＝当前焦点，bubbles）；真硬件键盘不在这份判据的承诺里。 */
async function pressKey(page: Page, key: string) {
  return evalJs(page, `(() => {
    const target = document.activeElement || document.body
    target.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }))
    target.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }))
    return target.tagName.toLowerCase()
  })()`)
}
async function shot(page: Page, name: string) {
  const dir = process.env.SHOT_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  const { data } = await page.s('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(dir, `${name}.png`), Buffer.from(data, 'base64'))
  console.log(`截图 → ${dir}/${name}.png`)
}

async function loginInBrowser(page: Page, email: string) {
  const deviceId = `panel-${stamp}`
  await page.s('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.setItem('vitransfer_device_id', ${JSON.stringify(deviceId)})`,
  })
  await page.s('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__reqs=[]; const of=window.fetch; window.fetch=async function(u,o){ try{ const m=(o&&o.method)||'GET'; const b=(o&&o.body)?String(o.body):null; if(m!=='GET') window.__reqs.push({m:m,u:String(u&&u.url||u),b:b}) }catch(e){}; return of.apply(this,arguments) }`,
  })
  await run(page, '/login')
  if (!await waitFor(page, `document.body && document.body.children.length > 0`, 120_000)) return 'no-page'
  return String(await evalJs(page, `(async () => {
    const r = await fetch('/api/auth/login', { method: 'POST', cache: 'no-store',
      headers: { 'content-type': 'application/json', 'X-ViTransfer-Device-ID': ${JSON.stringify(deviceId)} },
      body: JSON.stringify({ email: ${JSON.stringify(email)}, password: ${JSON.stringify(pw)} }) })
    const j = await r.json().catch(() => null)
    if (j?.tokens?.refreshToken) localStorage.setItem('vitransfer_refresh_token', j.tokens.refreshToken)
    return r.status + ' ' + (j?.tokens?.refreshToken ? 'session' : JSON.stringify(j?.error ?? '').slice(0, 90))
  })()`))
}

const OVERLAY = `[data-tutorial="project-settings-overlay"]`
const SCRIM = `[data-tutorial="project-settings-scrim"]`
const PANEL = `[data-tutorial="project-settings-panel"]`
const CLOSE = `[data-tutorial="project-settings-close"]`
const TRIGGER = `[...document.querySelectorAll('[data-tutorial="project-info-trigger"]')].filter(b => b.offsetParent !== null)[0]`
/** 素材区右键菜单：`<main id="review-workspace">` 直属的那枚 fixed 浮层。 */
const CTX_MENU = '#review-workspace > div.fixed'
/**
 * 身份块那排菜单（absolute 层，offsetParent 可用）。他 10-04 把设置那三节搬进这里，
 * 于是这排项次的文案就是 EXPECT_NAV 那三项，点第几项浮层就该落在第几节。
 */
const OPEN_MENU = `[...document.querySelectorAll('[role="menu"]')].filter(m => m.offsetParent !== null)[0]`
const MENU_COUNT = `[...document.querySelectorAll('[role="menu"]')].filter(m => m.offsetParent !== null).length`
const MENU_ITEMS = `(${OPEN_MENU} ? [...${OPEN_MENU}.querySelectorAll('[role="menuitem"]')].filter(i => i.offsetParent !== null) : [])`
const menuTexts = async (page: Page) => JSON.parse(String(await evalJs(page, `JSON.stringify(${MENU_ITEMS}.map(i => i.innerText.trim()))`)))
const clickMenuItem = (page: Page, label: string) => click(page, `${MENU_ITEMS}.find(i => i.innerText.trim() === ${JSON.stringify(label)})`)

const openCount = (page: Page) => evalJs(page, `document.querySelectorAll(${JSON.stringify(OVERLAY)}).length`)
/** waitFor 的入参是一段 JS 表达式，选择器字符串本身不是表达式，必须包成 querySelector。 */
const waitSel = (page: Page, selector: string, ms = 30_000) => waitFor(page, `document.querySelector(${JSON.stringify(selector)})`, ms)
const waitPanel = (page: Page, ms = 30_000) => waitSel(page, PANEL, ms)
const waitClosed = (page: Page, ms = 20_000) => waitFor(page, `document.querySelectorAll(${JSON.stringify(OVERLAY)}).length === 0`, ms)
/** click 的入参是一段 JS 表达式，选择器常量必须包成 querySelector，否则 `[data-x]` 会被读成「给非引用赋值」。 */
const clickSel = (page: Page, selector: string) => click(page, `document.querySelector(${JSON.stringify(selector)})`)
/**
 * 右键菜单这层用 offsetParent 判可见是错的：position:fixed 的元素 offsetParent 恒为 null。
 * 只按「盒子有尺寸＋菜单里有那行字」认，两处读数（在不在、点哪枚）共用同一条解析。
 */
const ctxMenuExpr = `(() => { const d = [...document.querySelectorAll(${JSON.stringify(CTX_MENU)})]` +
  `.filter(x => x.innerText && x.innerText.indexOf(${JSON.stringify(zh('projectSettings'))}) > -1)[0]; return d || null })()`
const CTX_MENU_SHOWN = `(() => { const d = ${ctxMenuExpr}; if (!d) return false;` +
  ` const b = d.getBoundingClientRect(); return b.width > 0 && b.height > 0 })()`
const clickCtxMenuItem = (page: Page) => click(page, `(() => { const d = ${ctxMenuExpr}; if (!d) return null;` +
  ` return [...d.querySelectorAll('button')].filter(b => b.innerText.trim() === ${JSON.stringify(zh('projectSettings'))})[0] || null })()`)
/**
 * 「收掉浮层」这类判据必须有前置：按之前真有 1 枚，事后 0 枚才算数。
 * 不加前置的话，浮层压根没画出来时 length===0 一次就成立，红色跑批里会混进假绿。
 */
async function closeBy(page: Page, act: () => Promise<unknown>) {
  const before = Number(await openCount(page))
  const detail = await act()
  const closed = await waitClosed(page)
  return { before, after: Number(await openCount(page)), closed, detail: String(detail) }
}
async function pathname(page: Page) { return String(await evalJs(page, 'location.pathname')) }
/** 浮层内当前的导航三项＋当前这节画出来的 label——面板作用域，不吃页面那侧的同名节点。 */
async function panelNav(page: Page) {
  return JSON.parse(String(await evalJs(page, `JSON.stringify(
    [...document.querySelectorAll(${JSON.stringify(PANEL)} + ' nav button')].filter(b => b.offsetParent !== null).map(b => b.innerText.trim())
  )`)))
}
async function panelLabels(page: Page) {
  return JSON.parse(String(await evalJs(page, `JSON.stringify(
    [...document.querySelectorAll(${JSON.stringify(PANEL)} + ' label')].filter(l => l.offsetParent !== null).map(l => l.innerText.trim()).filter(s => s.length > 0)
  )`)))
}
async function panelText(page: Page) {
  return String(await evalJs(page, `(() => { const p = document.querySelector(${JSON.stringify(PANEL)}); return p ? p.innerText : '' })()`))
}
async function pickSection(page: Page, label: string) {
  const r = await click(page, `[...document.querySelectorAll(${JSON.stringify(PANEL)} + ' nav button')].filter(b => b.offsetParent !== null && b.innerText.trim() === ${JSON.stringify(label)})[0]`)
  await sleep(600)
  return r
}
/** 页内版（/settings 直链）的两份读数：作用域用 #main-content，浮层不在里面时和它是同一棵树。 */
async function pageNav(page: Page) {
  return JSON.parse(String(await evalJs(page, `JSON.stringify(
    [...document.querySelectorAll('#main-content nav.sticky button')].filter(b => b.offsetParent !== null).map(b => b.innerText.trim())
  )`)))
}
async function pageLabels(page: Page) {
  return JSON.parse(String(await evalJs(page, `JSON.stringify(
    [...document.querySelectorAll('#main-content label')].filter(l => l.offsetParent !== null).map(l => l.innerText.trim()).filter(s => s.length > 0)
  )`)))
}
async function pickPageSection(page: Page, label: string) {
  const r = await click(page, `[...document.querySelectorAll('#main-content nav.sticky button')].filter(b => b.offsetParent !== null && b.innerText.trim() === ${JSON.stringify(label)})[0]`)
  await sleep(600)
  return r
}
/** 按文案找 #main-content 里可见的按钮／链接（DOM 顺序＝页面书写顺序，工具栏在收录区之前）。 */
async function clickByLabel(page: Page, label: string, nth = 0) {
  return click(page, `[...document.querySelectorAll('#main-content button, #main-content a')].filter(e => e.offsetParent !== null && e.innerText.trim() === ${JSON.stringify(label)})[${nth}]`)
}
async function countByLabel(page: Page, label: string) {
  return Number(await evalJs(page, `[...document.querySelectorAll('#main-content button, #main-content a')].filter(e => e.offsetParent !== null && e.innerText.trim() === ${JSON.stringify(label)}).length`))
}
/** 左侧工作区那排导航写着「收录文件 0」这种带计数徽标的串，只能按前缀找。 */
async function clickWorkspaceTab(page: Page, label: string) {
  return click(page, `[...document.querySelectorAll('#main-content nav button')].filter(b => b.offsetParent !== null && b.innerText.trim().startsWith(${JSON.stringify(label)}))[0]`)
}
async function geometry(page: Page) {
  return JSON.parse(String(await evalJs(page, `(() => {
    const panel = document.querySelector(${JSON.stringify(PANEL)})
    const scrim = document.querySelector(${JSON.stringify(SCRIM)})
    const main = document.getElementById('main-content')
    if (!panel || !main) return JSON.stringify(null)
    const rail = main.previousElementSibling
    const box = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height } }
    const cs = getComputedStyle(panel)
    const scs = scrim ? getComputedStyle(scrim) : null
    const hit = (x, y) => { const e = document.elementFromPoint(x, y); if (!e) return 'none'; return { inPanel: panel.contains(e), inRail: rail ? rail.contains(e) : false, tag: e.tagName.toLowerCase(), cls: String(e.className).slice(0, 60) } }
    const alphaOf = (c) => {
      if (!c) return null
      const slash = c.indexOf('/')
      if (slash > -1) return parseFloat(c.slice(slash + 1))
      const parts = c.split(',')
      return parts.length > 3 ? parseFloat(parts[3]) : 1
    }
    const p = box(panel), m = box(main), rb = rail ? box(rail) : null
    // --popover 存的是 HSL 三元组（形如 220 14% 96%），产品侧由 Tailwind 以 hsl(var(--popover)) 消费。
    // 探针直接写 backgroundColor:'var(--popover)' 拿到的是无效声明 ⇒ 浏览器回落 transparent，
    // 于是把合格的面板判成 FAIL。探针必须走产品同一条消费路径：挂一枚 bg-popover 工具类元素。
    const probeRgb = () => {
      const probe = document.createElement('div')
      probe.className = 'bg-popover'
      document.body.appendChild(probe)
      const v = getComputedStyle(probe).backgroundColor
      probe.remove()
      return v
    }
    const popoverRgb = probeRgb()
    // 默认主题里 --card == --popover，直接比会放走「错用了卡片色」；临时切到 frame 那套（两色不同）再比一次。
    const root = document.documentElement
    const prevTheme = root.getAttribute('data-theme')
    root.setAttribute('data-theme', 'frame')
    const framePanelBg = getComputedStyle(panel).backgroundColor
    const framePopoverRgb = probeRgb()
    if (prevTheme === null) root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', prevTheme)
    return JSON.stringify({
      p, m, railRight: rb ? rb.r : null, railVisible: rail ? rail.offsetParent !== null : false,
      headerVar: getComputedStyle(document.documentElement).getPropertyValue('--admin-header-height').trim(),
      panelBg: cs.backgroundColor, popoverRgb, framePanelBg, framePopoverRgb,
      panelRadius: cs.borderTopLeftRadius, panelShadow: cs.boxShadow,
      scrimAlpha: scs ? alphaOf(scs.backgroundColor) : null, scrimBg: scs ? scs.backgroundColor : null,
      hitCenter: hit((p.l + p.r) / 2, (p.t + p.b) / 2),
      hitSeam: hit(m.l + 1, m.t + 1),
      hitRail: rb ? hit(rb.l + rb.w / 2, rb.t + 20) : 'no-rail',
      innerW: innerWidth, innerH: innerHeight,
    })
  })()`)))
}
async function patchBodies(page: Page) {
  return JSON.parse(String(await evalJs(page, `JSON.stringify((window.__reqs || []).filter(x => x.m === 'PATCH' && x.u.indexOf('/api/projects/') > -1))`)))
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) { if (name !== 'locales' && name !== 'node_modules') sourceFiles(p, acc) }
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) acc.push(p)
  }
  return acc
}
function filesCalling(key: string, files: string[]) {
  const re = new RegExp(`\\b(?:t|tc)\\(\\s*'${key}'\\s*[,)]`)
  return files.filter(f => re.test(readFileSync(f, 'utf8')))
}
function keysCalledIn(src: string) {
  const out: { ns: string, key: string }[] = []
  const seen = new Set<string>()
  for (const m of src.matchAll(/\b(t|tc)\(\s*'([A-Za-z0-9_]+)'/g)) {
    const ns = m[1] === 't' ? 'projects' : 'common'
    const id = `${ns}.${m[2]}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ ns, key: m[2] })
  }
  return out
}
function localeHas(ns: string, key: string) {
  const hits: string[] = []
  for (const l of ['zh', 'en', 'de', 'nl']) {
    if (JSON.parse(readFileSync(`src/locales/${l}.json`, 'utf8'))?.[ns]?.[key] !== undefined) hits.push(l)
  }
  return hits
}

const EXPECT_NAV = ['projectDetails', 'clientInfoNotifications', 'clientSharePage'].map(zh)
const EXPECT_SHARE = ['allowClientApproval', 'allowAssetDownloads', 'allowPhotoDownloads',
  'allowClientFileAttachments', 'allowReverseShare', 'showClientTutorial',
  'hideFeedbackSection', 'restrictCommentsLatest'].map(zh)
const EXPECT_DETAILS = ['titleLabel', 'descriptionLabel', 'enableRevisionTracking', 'dueDateLabel'].map(zh)
const BANNED = ['视频处理', '访问安全', '跳过转码', '预览分辨率', '应用预览 LUT', '验证方式', '访客模式', '客户页面密码', '使用预览进行批准的播放', '评论时间显示', '仅展示最新版本', '向客人展示相册']

let project = undefined as any

try {
  const owner = await prisma.user.create({ data: { email: OWNER.email, name: OWNER.name, password: await hashPassword(pw), phone: `136${String(stamp).slice(-8)}` } })
  const team = await prisma.team.create({
    data: { name: teamSlug, slug: teamSlug, shareKey: teamSlug, createdById: owner.id, subscriptionPlan: 'BETA', members: { create: [{ userId: owner.id, role: 'OWNER', status: 'ACTIVE' }] } },
  })
  // allowReverseShare 显式设 false：工具栏那枚「开启收录」只在没开收录时出现，空态那枚也靠它。
  project = await prisma.project.create({
    data: {
      teamId: team.id, createdById: owner.id, projectCode: `PA${String(stamp).slice(-6)}`,
      title: `设置浮层-${stamp}`, slug: `panel-${stamp}`, shareSlug: `panel-s-${stamp}`,
      allowReverseShare: false,
    },
  })

  const warm = async (path: string) => {
    try { return String((await fetch(`${BASE}${path}`, { cache: 'no-store' })).status) } catch (e) { return `预热失败 ${(e as Error).message}` }
  }
  for (const p of ['/login', `/studio/projects/${project.id}`, `/studio/projects/${project.id}/settings`]) {
    console.log(`预热 ${p} → ${await warm(p)}`)
  }

  chrome = await connectChrome()
  const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then(r => r.json())
  await attachSocket(webSocketDebuggerUrl)
  const page = await openPage()
  check(/^200 session$/.test(await loginInBrowser(page, OWNER.email)), 'P0 浏览器内登录')

  // ── A1 身份块菜单：三项就是那三节，点哪节浮层落在哪节 ───────────────────
  await run(page, `/studio/projects/${project.id}`)
  check(await waitFor(page, TRIGGER, 150_000), 'A1a 项目页身份块画出来了', '→ 等不到就是页面自己坏了，后面的判据都无意义')
  console.log(`  点身份块 → ${await click(page, TRIGGER)}`)
  check(await waitFor(page, MENU_COUNT, 20_000), 'A1b 项目菜单弹出来了')
  const menuNow = await menuTexts(page)
  check(JSON.stringify(menuNow) === JSON.stringify(EXPECT_NAV),
    'A1d 菜单里那三行就是设置那三节（他 10-04 要把这三项搬进这排菜单，原来单列的「项目设置」不再自己占一行）', `→ 实画 ${JSON.stringify(menuNow)}`)
  console.log(`  点「${zh('projectDetails')}」→ ${await clickMenuItem(page, zh('projectDetails'))}`)
  check(await waitPanel(page, 60_000), 'A1 点「项目详情」浮层就出来了（他要点的是「不跳整页」）', `→ 浮层 ${await openCount(page)} 枚`)
  const urlAfterMenu = await pathname(page)
  check(urlAfterMenu === `/studio/projects/${project.id}`, 'A1c 换的是一层浮层，不是路由：URL 还停在项目页', `→ ${urlAfterMenu}`)
  await sleep(1_200)

  // ── A2/A3 浮层的几何与栏面 ─────────────────────────────────────────────
  // 量不到时不抛异常：填一份 NaN／占位读数，让这八条各报各的 FAIL，红才看得见全貌。
  const measured = await geometry(page)
  const g = measured ?? {
    p: { l: NaN, t: NaN, r: NaN, b: NaN, w: NaN, h: NaN }, m: { l: NaN, t: NaN, r: NaN, b: NaN, w: NaN, h: NaN },
    railRight: null, railVisible: false, headerVar: 'n/a', panelBg: 'n/a', popoverRgb: 'n/a',
    framePanelBg: 'n/a', framePopoverRgb: 'n/a', panelRadius: 'n/a', panelShadow: 'n/a',
    scrimAlpha: null, scrimBg: null, hitCenter: 'no-panel', hitSeam: 'no-panel', hitRail: 'no-panel',
    innerW: NaN, innerH: NaN,
  }
  check(!!measured, 'A2a 量得到浮层与 #main-content 的几何', measured ? '' : '→ 面板没画出来，下面这组读的是占位值')
  const near = (a: number, b: number) => Math.abs(a - b) <= 0.6
  check(near(g.p.l - g.m.l, SEAM) && near(g.m.r - g.p.r, SEAM) && near(g.p.t - g.m.t, SEAM) && near(g.m.b - g.p.b, SEAM),
    `A2 面板四边正好坐在主区内缩 ${SEAM}px 上（缝跟壳层同一档，不多不少）`,
    `→ 左 ${g.p.l.toFixed(2)} 右 ${g.p.r.toFixed(2)} 顶 ${g.p.t.toFixed(2)} 底 ${g.p.b.toFixed(2)}｜主区 ${g.m.l.toFixed(2)}/${g.m.r.toFixed(2)}/${g.m.t.toFixed(2)}/${g.m.b.toFixed(2)}`)
  check(near(g.m.t, 0) && g.headerVar === '0px', 'A2b 顶边贴视口顶：--admin-header-height 实测就是 0px（顶栏早没了，浮层不该给它留位子）', `→ 主区顶 ${g.m.t}，变量 ${g.headerVar}`)
  check(near(g.m.b, g.innerH), 'A2c 浮层铺到视口底（盖的是整块主区，不是居中一张小窗）', `→ 主区底 ${g.m.b} 视口 ${g.innerH}`)
  check(g.railVisible === true && g.railRight !== null && g.p.l >= g.railRight - 0.6,
    'A2d 窄栏没被盖住：面板左边界在窄栏右边缘之外', `→ 窄栏右 ${String(g.railRight)} 面板左 ${g.p.l.toFixed(2)}`)
  check(g.hitCenter?.inPanel === true, 'A2e 面板正中确实画在最上面（elementFromPoint 命中面板）', `→ 命中 ${JSON.stringify(g.hitCenter)}`)
  check(g.hitSeam?.inPanel === false, `A2f 缝那 2px 真的透出来（主区内缩 1px 处不属于面板）`, `→ 命中 ${JSON.stringify(g.hitSeam)}`)
  check(g.hitRail?.inRail === true && g.hitRail?.inPanel === false, 'A2g 遮罩没糊到窄栏上：窄栏正中仍归窄栏自己（还能点）', `→ 命中 ${JSON.stringify(g.hitRail)}`)
  check(g.panelRadius === '8px', 'A3a 面板圆角 8px（跟壳层六块栏面同一档）', `→ ${g.panelRadius}`)
  check(!!measured && g.panelShadow !== 'none' && g.panelShadow.length > 0, 'A3b 面板浮得起：阴影不是 none', `→ ${String(g.panelShadow).slice(0, 60)}`)
  // 探针自己也得作证：一枚 bg-popover 元素若是全透明，说明消费路径没走通，此时比出来的相等/不等都不作数。
  const probeWorks = !/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)/.test(String(g.popoverRgb)) &&
    !/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)/.test(String(g.framePopoverRgb))
  check(!!measured && probeWorks && g.panelBg === g.popoverRgb && g.framePanelBg === g.framePopoverRgb,
    'A3c 面板底色就是 --popover（栏面这一层，跟壳层同一块白；frame 主题下再比一次，免得 --card 冒充）',
    `→ 默认 ${g.panelBg} vs ${g.popoverRgb}｜frame ${g.framePanelBg} vs ${g.framePopoverRgb}${probeWorks ? '' : '｜探针读成透明，这条不算数'}`)
  const alpha = Number(g.scrimAlpha)
  check(g.scrimBg !== null && alpha > 0 && alpha < 1, 'A3d 遮罩是半透明不是实色墙（底下项目页透得出来，这层才叫浮层）', `→ ${g.scrimBg}`)

  // ── A4 内容一份不差也不多一份 ───────────────────────────────────────────
  const overlayNav = await panelNav(page)
  check(JSON.stringify(overlayNav) === JSON.stringify(EXPECT_NAV),
    'A4 浮层自带那几段导航，正好三项（跟 /settings 同一份，没少搬也没多搬）', `→ 实画 ${JSON.stringify(overlayNav)}`)
  const overlayDetailLabels = await panelLabels(page)
  check(JSON.stringify(overlayDetailLabels) === JSON.stringify(EXPECT_DETAILS),
    'A4b 浮层「项目详情」一节四行 label 一字不多一字不少', `→ 实画 ${JSON.stringify(overlayDetailLabels)}`)
  console.log(`  浮层里切到「${zh('clientSharePage')}」→ ${await pickSection(page, zh('clientSharePage'))}`)
  const overlayShareLabels = await panelLabels(page)
  check(JSON.stringify(overlayShareLabels) === JSON.stringify(EXPECT_SHARE),
    'A4c 浮层切到「客户分享页面」画的就是那八行（上一轮他圈的删减，搬完还是那个结果）', `→ 实画 ${JSON.stringify(overlayShareLabels)}`)
  const overlayText = await panelText(page)
  const leaked = BANNED.filter(s => overlayText.includes(s))
  check(overlayText.length > 0 && leaked.length === 0, 'A4d 浮层里那十二串一句都不许回来（搬代码最容易顺手把砍掉的两节搬回来）', `→ 正文 ${overlayText.length} 字，还剩 ${JSON.stringify(leaked)}`)
  console.log(`  浮层里切到「${zh('projectDetails')}」→ ${await pickSection(page, zh('projectDetails'))}`)
  const backToDetail = await panelLabels(page)
  check(JSON.stringify(backToDetail) === JSON.stringify(EXPECT_DETAILS),
    'A5 浮层里切节能切回来（导航是真在用，不是画了三项摆设）', `→ 实画 ${JSON.stringify(backToDetail)}`)
  await shot(page, 'panel-1-overlay-open')

  // ── A6/A7/A8 三种收法 ──────────────────────────────────────────────────
  const byEsc = await closeBy(page, async () => { console.log(`  Escape → ${await pressKey(page, 'Escape')}`); return 'Escape' })
  check(byEsc.before === 1 && byEsc.closed, 'A6 Escape 收掉浮层（按前必须真有 1 枚，不然「没了」是句假话）', `→ 按前 ${byEsc.before} 枚，按后 ${byEsc.after} 枚`)
  check(await pathname(page) === `/studio/projects/${project.id}`, 'A6b Escape 之后 URL 还是项目页（浮层没有偷偷 push 一条历史）', `→ ${await pathname(page)}`)
  check(await waitFor(page, TRIGGER) , 'A6c 底下项目页还在（身份块重新可见）')

  console.log(`  再点「${zh('projectSettings')}」→ ${await clickByLabel(page, zh('projectSettings'))}`)
  check(await waitPanel(page), 'A7 工具栏「项目设置」也是开浮层（不是跳页）', `→ ${await pathname(page)}`)
  const bySeam = await closeBy(page, () => evalJs(page, `(() => { const m = document.getElementById('main-content').getBoundingClientRect(); const e = document.elementFromPoint(m.left + 1, m.top + 1); if (!e) return 'none'; e.click(); return 'clicked:' + e.tagName.toLowerCase() })()`))
  check(bySeam.before === 1 && bySeam.closed,
    'A7b 点缝／遮罩那层就把浮层收掉（他要么 Escape 要么点外面，不该逼人找关闭钮）', `→ 点前 ${bySeam.before} 枚，点后 ${bySeam.after} 枚｜点的是 ${bySeam.detail}`)
  console.log(`  再点「${zh('projectSettings')}」→ ${await clickByLabel(page, zh('projectSettings'))}`)
  check(await waitSel(page, CLOSE), 'A8 浮层里有明确的关闭控件')
  const byCloseBtn = await closeBy(page, async () => { console.log(`  点关闭 → ${await clickSel(page, CLOSE)}`); return CLOSE })
  check(byCloseBtn.before === 1 && byCloseBtn.closed, 'A8b 点关闭控件收掉浮层', `→ 点前 ${byCloseBtn.before} 枚，点后 ${byCloseBtn.after} 枚`)

  // ── A9 右键菜单入口 ────────────────────────────────────────────────────
  const ctx = await evalJs(page, `(() => {
    const m = document.getElementById('review-workspace')
    if (!m) return 'no-workspace'
    const b = m.getBoundingClientRect()
    m.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + b.width / 2, clientY: b.top + 60 }))
    return 'dispatched'
  })()`)
  const menuUp = await waitFor(page, CTX_MENU_SHOWN, 15_000)
  check(menuUp, 'A9a 素材区右键菜单弹出来了（这层是 fixed，offsetParent 恒 null，只能按盒子＋文案认）', `→ ${ctx}`)
  const menuClick = await clickCtxMenuItem(page)
  console.log(`  点右键菜单里的「项目设置」→ ${menuClick}`)
  check(menuClick === 'clicked', 'A9b 点的确实是菜单里那枚（点不到就 FAIL，绝不回落到工具栏的同名按钮）', `→ ${menuClick}`)
  check(await waitPanel(page), 'A9 右键菜单里那项也改成开浮层', `→ ${await pathname(page)}`)
  console.log(`  Escape → ${await pressKey(page, 'Escape')}`)
  await waitClosed(page)

  // ── A10 菜单三项各点一次：各落在自己那一节 ──────────────────────────────
  console.log(`  点身份块 → ${await click(page, TRIGGER)}`)
  check(await waitFor(page, MENU_COUNT, 20_000), 'A10a 菜单又弹出来了（这趟点「客户分享页面」）')
  console.log(`  点菜单里的「${zh('clientSharePage')}」→ ${await clickMenuItem(page, zh('clientSharePage'))}`)
  check(await waitPanel(page), 'A10 菜单点「客户分享页面」，浮层就落在这一节（三项各管一节，不是都开在同一节上）', `→ ${await pathname(page)}`)
  const atShare = await panelLabels(page)
  check(JSON.stringify(atShare) === JSON.stringify(EXPECT_SHARE), 'A10b 落在分享那一节，画的还是那八行', `→ 实画 ${JSON.stringify(atShare)}`)
  console.log(`  Escape → ${await pressKey(page, 'Escape')}`)
  await waitClosed(page)

  console.log(`  点身份块 → ${await click(page, TRIGGER)}`)
  check(await waitFor(page, MENU_COUNT, 20_000), 'A10c 菜单第三次弹出来（这趟点「客户信息与通知」）')
  console.log(`  点菜单里的「${zh('clientInfoNotifications')}」→ ${await clickMenuItem(page, zh('clientInfoNotifications'))}`)
  check(await waitPanel(page), 'A10d 菜单点「客户信息与通知」也开浮层，URL 照样不动', `→ ${await pathname(page)}`)
  const atClientInfo = await panelLabels(page)
  check(atClientInfo.indexOf(zh('companyBrandName')) > -1 &&
    JSON.stringify(atClientInfo) !== JSON.stringify(EXPECT_SHARE) && JSON.stringify(atClientInfo) !== JSON.stringify(EXPECT_DETAILS),
    'A10e 这一节画的是自己的行（有「公司品牌名」，且既不是分享那八行也不是详情那四行）', `→ 实画 ${JSON.stringify(atClientInfo).slice(0, 160)}`)
  console.log(`  Escape → ${await pressKey(page, 'Escape')}`)
  await waitClosed(page)

  // ── A11 两枚「开启收录」：他 10-04 要改回去——照旧走 /settings 整页，不浮层 ──
  const SETTINGS_PATH = `/studio/projects/${project.id}/settings`
  const collectCount = await countByLabel(page, zh('enableCollection'))
  check(collectCount >= 1, `A11a 「${zh('enableCollection')}」入口在（没开收录时工具栏那枚先出现）`, `→ 找到 ${collectCount} 枚`)
  console.log(`  点工具栏「${zh('enableCollection')}」→ ${await clickByLabel(page, zh('enableCollection'), 0)}`)
  check(await waitFor(page, `location.pathname === ${JSON.stringify(SETTINGS_PATH)}`, 90_000),
    'A11 工具栏「开启收录」回到老路：换成 /settings 整页（这枚不是他点单要搬的，改回去了）', `→ ${await pathname(page)}`)
  check(Number(await openCount(page)) === 0, 'A11b 这一路 DOM 里 0 枚浮层（改回去＝真没开浮层，不是整页和浮层各来一份）', `→ 浮层 ${await openCount(page)} 枚`)

  await run(page, `/studio/projects/${project.id}`)
  check(await waitFor(page, TRIGGER, 120_000), 'A11c 回项目页（空态那枚还要再点一次）')
  console.log(`  切到「${zh('collection')}」区 → ${await clickWorkspaceTab(page, zh('collection'))}`)
  await sleep(900)
  const bothCollect = await countByLabel(page, zh('enableCollection'))
  check(bothCollect >= 2, 'A11d 收录空态里那枚「开启收录」也露出来了（工具栏一枚＋空态一枚）', `→ 现在可见 ${bothCollect} 枚`)
  console.log(`  点空态「${zh('enableCollection')}」→ ${await clickByLabel(page, zh('enableCollection'), 1)}`)
  check(await waitFor(page, `location.pathname === ${JSON.stringify(SETTINGS_PATH)}`, 90_000),
    'A11e 空态那枚同样回到老路：进 /settings 整页', `→ ${await pathname(page)}`)

  await run(page, `/studio/projects/${project.id}`)
  check(await waitFor(page, TRIGGER, 120_000), 'A11f 再回项目页（下面改名这组要跑在浮层里）')
  console.log(`  点身份块 → ${await click(page, TRIGGER)}`)
  check(await waitFor(page, MENU_COUNT, 20_000), 'A11g 菜单第四次弹出来')
  console.log(`  点菜单里的「${zh('projectDetails')}」→ ${await clickMenuItem(page, zh('projectDetails'))}`)
  check(await waitPanel(page), 'A11h 浮层重新打开，落在「项目详情」那一节', `→ ${await pathname(page)}`)

  // ── A12 浮层里改名保存：整条链路还通 ──────────────────────────────────
  console.log(`  浮层里切到「${zh('projectDetails')}」→ ${await pickSection(page, zh('projectDetails'))}`)
  const NEW_TITLE = `设置浮层改名-${stamp}`
  check(await evalJs(page, `(() => {
    const el = document.querySelector(${JSON.stringify(PANEL)} + ' #title')
    if (!el) return false
    const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
    d.set.call(el, ${JSON.stringify(NEW_TITLE)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return el.value === ${JSON.stringify(NEW_TITLE)}
  })()`) === true, 'A12a 浮层里的名称输入框改得动（受控值真收到了，不是只画了个框）')
  console.log(`  点「${zhc('saveChanges')}」→ ${await click(page, `[...document.querySelectorAll(${JSON.stringify(PANEL)} + ' button')].filter(b => b.offsetParent !== null && b.innerText.trim() === ${JSON.stringify(zhc('saveChanges'))})[0]`)}`)
  const DLG = `[...document.querySelectorAll('[role="dialog"]')].filter(d => d.getBoundingClientRect().width > 0 && d.matches(${JSON.stringify(PANEL)}) === false && d.querySelector(${JSON.stringify(PANEL)}) === null)`
  check(await waitFor(page, `${DLG}.length`, 30_000), 'A12b 浮层里改名照旧弹「重新处理」窗（Radix 弹窗盖在浮层之上，不是被浮层压住）')
  console.log(`  点「无需重新处理即可保存」→ ${await click(page, `${DLG}[0] ? [...${DLG}[0].querySelectorAll('button')].find(b => b.textContent.trim() === '无需重新处理即可保存') : null`)}`)
  const savedAt = Date.now()
  let saved: any = null
  while (Date.now() - savedAt < 40_000) {
    saved = await prisma.project.findUnique({ where: { id: project.id }, select: { title: true } })
    if (saved?.title === NEW_TITLE) break
    await sleep(500)
  }
  check(saved?.title === NEW_TITLE, 'A12 浮层里保存整条链路跑得通：改名 → 确认窗 → 库里标题真变了', `→ 库里 ${JSON.stringify(saved?.title)}`)
  const patches = await patchBodies(page)
  const patchBody = patches.length ? JSON.parse(patches[patches.length - 1].b) : null
  const carried = patchBody ? PRUNED.filter(k => Object.prototype.hasOwnProperty.call(patchBody, k)) : PRUNED
  check(patches.length === 1 && carried.length === 0, 'A12c 真发出去的 PATCH 请求体仍不带那十列（搬家没把砍掉的载荷搬回来）',
    `→ ${patches.length} 发 PATCH，仍带 ${JSON.stringify(carried)}`)
  await shot(page, 'panel-2-overlay-saving')
  console.log(`  Escape → ${await pressKey(page, 'Escape')}`)
  await waitClosed(page)

  // ── A13 连开两次不叠层 ────────────────────────────────────────────────
  console.log(`  连点两次「${zh('projectSettings')}」`)
  await clickByLabel(page, zh('projectSettings'))
  await waitPanel(page)
  await pressKey(page, 'Escape')
  await waitClosed(page)
  await clickByLabel(page, zh('projectSettings'))
  await sleep(1_200)
  const oc = await openCount(page)
  check(oc === 1, 'A13 开关一轮后 DOM 里只有一枚浮层（没叠两层、没漏门户）', `→ ${oc} 枚`)
  await shot(page, 'panel-3-overlay-second-open')
  await pressKey(page, 'Escape')
  await waitClosed(page)

  // ── B1/B2 /settings 直链仍是完整的一页 ────────────────────────────────
  await run(page, `/studio/projects/${project.id}/settings`)
  check(await waitFor(page, `document.querySelectorAll('#main-content nav.sticky button').length > 0`, 120_000),
    'B1 老直链 /settings 还进得去（浮层不代替路由，别人存的书签不能死）')
  const noOverlayHere = await openCount(page)
  check(noOverlayHere === 0, 'B1b /settings 是页内版，不套浮层（同一份内容两种外壳，别在页里再浮一层）', `→ 浮层 ${noOverlayHere} 枚`)
  const pageNavNow = await pageNav(page)
  check(JSON.stringify(pageNavNow) === JSON.stringify(overlayNav),
    'B1c 页内版与浮层版导航逐字相等（内容只有 ProjectSettingsPanel 这一份）', `→ 页 ${JSON.stringify(pageNavNow)} 浮 ${JSON.stringify(overlayNav)}`)
  console.log(`  页内版切到「${zh('clientSharePage')}」→ ${await pickPageSection(page, zh('clientSharePage'))}`)
  const pageShareLabels = await pageLabels(page)
  check(JSON.stringify(pageShareLabels) === JSON.stringify(overlayShareLabels),
    'B1d 页内版「客户分享页面」八行与浮层版逐字相等（两处不各写一遍）', `→ 页 ${JSON.stringify(pageShareLabels)}`)
  await shot(page, 'panel-4-settings-route')
  console.log(`  点「${zh('backToProject')}」→ ${await click(page, `[...document.querySelectorAll('#main-content a')].filter(a => a.offsetParent !== null && a.innerText.trim() === ${JSON.stringify(zh('backToProject'))})[0]`)}`)
  check(await waitFor(page, `location.pathname === ${JSON.stringify(`/studio/projects/${project.id}`)}`, 60_000),
    'B2 页内版「返回项目」仍回项目页', `→ ${await pathname(page)}`)
  await closePage(page)

  // ── C 组：源码（内容只有一份、入口改线、没搭车） ───────────────────────
  check(existsSync(PANEL_FILE), 'C1 内容抽成了 src/components/ProjectSettingsPanel.tsx（浮层和路由共用一份）')
  const routeSrc = readFileSync(ROUTE_FILE, 'utf8')
  const panelSrc = existsSync(PANEL_FILE) ? readFileSync(PANEL_FILE, 'utf8') : ''
  check(panelSrc.includes("variant") && /'overlay'|'page'|"overlay"|"page"/.test(panelSrc),
    'C1b 组件按 variant 出两种外壳（overlay 浮层 / page 页内），不是两套代码')
  check(routeSrc.includes('ProjectSettingsPanel'), 'C1c 路由文件只是薄薄一层壳，把 projectId 交给同一个组件')
  // 薄到什么程度不拍脑袋：跟 HEAD 那版（他点单删减后 691 行）比，壳必须不到原样的一半。
  const headLines = execFileSync('git', ['show', `HEAD:${ROUTE_FILE}`], { encoding: 'utf8' }).split('\n').length
  const routeLines = routeSrc.split('\n').length
  check(routeLines < headLines / 2, `C1d 路由文件薄到 HEAD 那版（${headLines} 行）的一半以下，现在 ${routeLines} 行（表单真搬走了，不是复制一份）`)
  const formKeys = ['allowReverseShare', 'allowAssetDownloads', 'restrictCommentsToLatestVersion', 'clientNotificationSchedule']
  const stillInRoute = formKeys.filter(k => new RegExp(`\\b${k}\\b`).test(routeSrc))
  check(stillInRoute.length === 0, 'C1e 路由文件里已经没有那些表单状态与载荷字段（搬＝一边有一边没）', `→ 还剩 ${JSON.stringify(stillInRoute)}`)

  const files = sourceFiles('src')
  const SHARE_KEYS = ['allowClientApproval', 'allowAssetDownloads', 'allowPhotoDownloads', 'allowClientFileAttachments',
    'allowReverseShare', 'showClientTutorial', 'hideFeedbackSection', 'restrictCommentsLatest']
  const refMap = SHARE_KEYS.map(k => ({ k, n: filesCalling(k, files) }))
  const dup = refMap.filter(x => x.n.length > 1)
  check(refMap.every(x => x.n.length === 1), `C2 「客户分享页面」那八行的 key，全仓每行只允许一个文件引用（内容不许两处各写一遍）`,
    dup.length ? `→ 多处引用：${dup.map(x => `${x.k}→${x.n.map(f => f.replace('src/', '')).join(' ')}`).join('；').slice(0, 240)}` : `→ 逐行 1 处：${refMap.map(x => x.n[0] ? x.n[0].replace('src/', '') : `${x.k}=0 处引用`).join(' ')}`)

  const panelKeys = keysCalledIn(panelSrc)
  const keyMissing = panelKeys.filter(x => localeHas(x.ns, x.key).length < 4)
  check(panelKeys.length > 0 && keyMissing.length === 0,
    `C3 组件引用的 ${panelKeys.length} 个 key 四语言全在（搬家不该引入缺 key，也不该顺手造新词）`,
    panelKeys.length === 0 ? '→ 组件里一个 key 都没抽到：ProjectSettingsPanel 还不存在或内容是空的，这条 PASS 不算数'
      : keyMissing.length ? `→ 缺语言：${keyMissing.slice(0, 12).map(x => `${x.ns}.${x.key}(${localeHas(x.ns, x.key).join('') || '全无'})`).join(' ')}` : `→ ${panelKeys.length} 个 key 四语言齐`)

  const prunedBack = PRUNED.filter(k => new RegExp(`\\b${k}\\b`).test(panelSrc))
  check(prunedBack.length === 0, 'C4 上一轮砍掉的十列没被搬回组件里（state、载荷、JSX 一起算）', `→ 还剩 ${JSON.stringify(prunedBack)}`)

  const projSrc = readFileSync(PROJECT_PAGE_FILE, 'utf8')
  const actionsSrc = readFileSync(ACTIONS_FILE, 'utf8')
  // 「/settings」这条路由串现在只许留在两枚「开启收录」的 Link 上：他 10-04 要那两枚改回原样，
  // 设置那三节的入口（工具栏／右键菜单／身份块菜单）一个都不许再拼它。
  const settingsLines = projSrc.split('\n').map((l, i) => ({ l, i })).filter(x => x.l.includes('/settings'))
  const notCollectLinks = settingsLines
    .filter(x => !projSrc.split('\n').slice(x.i, x.i + 4).join(' ').includes('enableCollection'))
    .map(x => x.l.trim().slice(0, 70))
  check(settingsLines.length === 2 && notCollectLinks.length === 0 && !/\/settings['"`]/.test(actionsSrc),
    'C5 全仓只剩两枚「开启收录」还在拼 /settings（其余设置入口改成了浮层，菜单那三项不带路由）',
    `→ 项目页 ${settingsLines.length} 处、其中不属于「开启收录」的 ${JSON.stringify(notCollectLinks)}，ProjectActions ${/\/settings['"`]/.test(actionsSrc) ? '有' : '没有'}`)

  const dirty = execFileSync('git', ['diff', '--name-only'], { encoding: 'utf8' }).split('\n').filter(Boolean)
  const frozen = ['src/components/ThumbnailReel.tsx', 'src/app/studio/projects/[id]/share/page.tsx',
    'src/app/share/[teamSlug]/SharePageClient.tsx', 'src/app/share/[teamSlug]/[projectSlug]/page.tsx', 'src/components/VideoPlayer.tsx']
  const touched = frozen.filter(f => dirty.includes(f))
  check(touched.length === 0, 'C6 审片页冻结区一字没动（搬家只碰设置这条线）',
    touched.length ? `→ 被顺手改了 ${touched.join(' ')}` : '')
} finally {
  chrome?.kill()
  rmSync(userDataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 })
  try { ws?.close() } catch { /* already closed */ }
  if (project) {
    await prisma.shareLink.deleteMany({ where: { projectId: project.id } })
    await prisma.project.deleteMany({ where: { id: project.id } })
  }
  const teamRow = await prisma.team.findFirst({ where: { slug: teamSlug }, select: { id: true } })
  if (teamRow) {
    await prisma.teamMember.deleteMany({ where: { teamId: teamRow.id } })
    await prisma.team.deleteMany({ where: { id: teamRow.id } })
  }
  await prisma.user.deleteMany({ where: { email: OWNER.email } })
  const left = {
    teams: await prisma.team.count({ where: { slug: teamSlug } }),
    projects: await prisma.project.count({ where: { slug: `panel-${stamp}` } }),
    users: await prisma.user.count({ where: { email: OWNER.email } }),
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
console.log('未证清单（这份判据证不到的，转浏览器批次或人工）：真鼠标滚轮在浮层内的滚动与橡皮筋、键盘 Tab 顺序是否只走浮层内（遮罩没做 inert）、窄屏（<1024）下浮层与窄栏的排布、英文/德文/荷兰文导航换行、连开快关心跳与请求竞态。')
