import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/encryption'
import { allocateTeamId } from '../src/lib/team-id'

/**
 * 10-18 他点单「按 1–13 做」：窄栏那两枚面板的出现方式照 next.frame.io 复刻。
 * 取证是在他自己 Edge 里量的（1484px 宽的窗口）：通知面板 x=41→286、顶到底，宽＝窄栏的 6.0 倍，
 * 正好盖住项目侧栏那一列，右边工具栏一寸没挪；标题行与标签行之间只有一条分隔线；空态整块垂直居中。
 * 搜索那枚放大镜不是面板，是一条链接，进 /search?query= 整页。
 *
 * S 组＝源码结构（不跑浏览器也能钉住「别再退回小卡」）；N 组＝接口；B 组＝浏览器几何与行为实测。
 * 会往本地库建一次性 fixture，所以这条永远不进 CI。
 * CDP 用 Node 内置 WebSocket，零依赖；登录只在浏览器里做（会话指纹绑设备头＋UA）。
 */
const BASE = process.env.SHARE_CHECK_BASE || 'http://localhost:3000'
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const WITH_BROWSER = process.argv.includes('--browser')
const prisma = new PrismaClient()
const stamp = Date.now()
const short = String(stamp).slice(-7)
const failures: string[] = []
const pw = `rail-panel-${stamp}`
const cdpPort = 9300 + (stamp % 600)
const userDataDir = join(tmpdir(), `rail-panel-${stamp}`)
let chrome: ChildProcess | undefined

let ids: Record<string, string> = {}
let teamIds: string[] = []
let projectIds: string[] = []
// 一个词同时钉住两路：素材名与项目名都含它，才能一次验「项目命中也在、别队的搜不到」。
const word = `第3集-${String(stamp).slice(-7)}`
let assetName = `对标素材${word}.mp4`
let adminToken = ''

const NOTIF = 'src/components/RailNotifications.tsx'
const SEARCH = 'src/components/RailSearch.tsx'
const RAIL = 'src/components/StudioRail.tsx'
const SEARCH_PAGE = 'src/app/studio/search/page.tsx'
const SEARCH_CLIENT = 'src/components/RailSearchPage.tsx'
const SEARCH_API = 'src/app/api/studio/search/route.ts'
const FEEDBACK = 'src/components/RailFeedback.tsx'

const read = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : `<<缺文件 ${path}>>`)
// 搜索页允许拆成「薄壳 page ＋ 客户端组件」，两份都读进来再判，别把形态钉死。
const pageSource = () => `${read(SEARCH_PAGE)}\n${existsSync(SEARCH_CLIENT) ? read(SEARCH_CLIENT) : ''}`

function check(ok: boolean, label: string, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` ${detail}` : ''}`)
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

// ── CDP ──────────────────────────────────────────────────────────────────
let ws: WebSocket | undefined
let msgId = 0
/** 红的时候得说清是哪一步坏的：这枚数组专门记 /api/comments/for-me 的回包码。 */
const networkLog: string[] = []
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
      if (msg.method === 'Network.responseReceived' && /\/api\/(comments\/for-me|announcements|feedback)/.test(msg.params?.response?.url || '')) {
        networkLog.push(`${msg.params.response.url.split('?')[0].replace('http://localhost:3000', '')} ${msg.params.response.status}`)
      }
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

async function waitFor(page: Page, expression: string, timeoutMs = 60_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await evalJs(page, `(() => { try { return (${expression}) ? true : false } catch { return false } })()`)) return true
    await sleep(400)
  }
  return false
}

/** 设计走查用的截图，落 /tmp（仓库里不留图）。加 --shots 才拍。 */
const SHOTS = process.argv.includes('--shots')
const SHOT_DIR = '/tmp/rail-panels-shots'
async function shot(page: Page, name: string) {
  if (!SHOTS) return
  mkdirSync(SHOT_DIR, { recursive: true })
  const { data } = await page.s('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(SHOT_DIR, `${name}.png`), Buffer.from(String(data), 'base64'))
  console.log(`  截图 ${name}.png`)
}

async function closePage(page: Page) {
  await send('Target.closeTarget', { targetId: page.targetId }).catch(() => null)
  await send('Target.disposeBrowserContext', { browserContextId: page.browserContextId }).catch(() => null)
  await sleep(300)
}

/** 每枚页面独立登录：设备 id 必须在建会话前种进上下文。 */
async function loginInBrowser(page: Page, email: string) {
  const deviceId = `rail-panel-${stamp}-${email.slice(0, 5)}`
  await page.s('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.setItem('vitransfer_device_id', ${JSON.stringify(deviceId)})`,
  })
  await page.s('Page.navigate', { url: `${BASE}/login` })
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

const ownerEmail = `rp-owner-${short}@example.invalid`
const cleanEmail = `rp-clean-${short}@example.invalid`
const peerEmail = `rp-peer-${short}@example.invalid`

/** 面板几何一次取回来：六个边界＋底色＋圆角＋阴影＋分隔线条数＋可见文案。 */
const PANEL_FACTS = `(() => {
  const p = document.querySelector('[data-rail-panel="notifications"]')
  if (!p) return JSON.stringify({ missing: true })
  const b = p.getBoundingClientRect()
  const probe = document.createElement('div'); probe.className = 'bg-popover'; document.body.appendChild(probe)
  const popoverBg = getComputedStyle(probe).backgroundColor
  probe.remove()
  const wide = [...p.querySelectorAll('*')].filter(e => e !== p
    && (parseFloat(getComputedStyle(e).borderTopWidth) > 0 || parseFloat(getComputedStyle(e).borderBottomWidth) > 0)
    && e.getBoundingClientRect().width > b.width * 0.6)
  return JSON.stringify({
    left: Math.round(b.left), top: Math.round(b.top), bottom: Math.round(b.bottom),
    width: Math.round(b.width), height: Math.round(b.height), innerH: window.innerHeight, innerW: window.innerWidth,
    bg: getComputedStyle(p).backgroundColor, popoverBg,
    radius: getComputedStyle(p).borderTopLeftRadius, shadow: getComputedStyle(p).boxShadow,
    rules: wide.map(e => getComputedStyle(e).borderTopWidth + ':' + Math.round(e.getBoundingClientRect().width)),
    text: p.innerText,
  })
})()`

try {
  // ══ S 组：源码结构 ════════════════════════════════════════════════════
  console.log('\n── S 组：源码结构 ──')
  const notif = read(NOTIF)
  const search = read(SEARCH)
  const rail = read(RAIL)
  const s0 = (text: string) => /kinds\.reply \? items/.test(text)
  const page = pageSource()
  const api = read(SEARCH_API)

  check(!/absolute left-full/.test(notif) && !/\bw-96\b/.test(notif),
    'S1 通知不再是浮在窄栏旁边的小卡（absolute left-full＋w-96 那套壳子整个退场）',
    `→ 还留着 left-full:${/absolute left-full/.test(notif)} w-96:${/\bw-96\b/.test(notif)}`)
  const missing = ['fixed', 'top-0', 'bottom-0', 'left-14', 'lg:left-\\[56px\\]', 'w-\\[288px\\]', 'bg-popover']
    .filter(c => !new RegExp(c).test(notif))
  check(missing.length === 0,
    'S2 通知改成整高栏面：贴窄栏右缘（left-14／lg 56px）、顶到底、宽 288（＝项目侧栏那一列）、底色吃本站栏面 bg-popover',
    `→ 缺 ${missing.join(' / ') || '无'}`)
  check(!/rounded-lg[^"]*border border-border[^"]*shadow/.test(notif),
    'S3 面板本体不再有圆角＋描边＋阴影（对标那块是平铺栏面，不是卡片）')
  check(/aria-label="关闭通知"/.test(notif) && /aria-label="通知设置"/.test(notif),
    'S4 标题行右缘两枚都在：齿轮（通知设置）＋ ✕（关闭）。对标那枚齿轮指向它自己的通知设置页，我们没那一页 ⇒ 齿轮就地开设置卡，不放假链接')
  check(/data-notification-settings/.test(notif) && /role="switch"/.test(notif) && /admin_notification_kinds/.test(notif),
    'S4·b 设置卡是真开关：两枚 role="switch" ＋ 落 localStorage（admin_notification_kinds），不是摆着好看的图标')
  check(/kinds\[entry\.type\]/.test(notif) && s0(notif),
    'S4·c 静音那一类真的整类退场：列表、未读数与桌面通知都不算它（不是只灰掉文字）')
  check(/全部标记为已读/.test(notif) && /未读/.test(notif) && /全部/.test(notif),
    'S5 标签行：左「全部／未读」两枚筛选，右「全部标记为已读」')
  const toggleBody = notif.slice(notif.indexOf('const toggle'), notif.indexOf('const toggle') + 400)
  check(notif.indexOf('const toggle') > 0 && !/markAll|writeSeenAt/.test(toggleBody),
    'S6 点开面板不再自动清未读（现在 setOpen(true) 紧跟着 markAllSeen＝替用户按了那颗按钮）',
    `→ toggle 里 ${/markAll|writeSeenAt/.test(toggleBody) ? '还在清未读' : '不碰水位'}`)
  check(/暂无更新/.test(notif) && /您的账户活动将在此显示/.test(notif),
    'S7 空态两句照对标原文')
  check(/type: 'reply'/.test(notif) && /type: 'announcement'/.test(notif) && /sort\(/.test(notif),
    'S8 两拨数据合成一条按时间排的混合列表（类别退成每行的标记，不再两枚标签各占一屏）')
  check(/key === 'Escape'/.test(notif), 'S9 Esc 关得掉面板')
  check(/getDesktopBridge/.test(notif) && /desktop\.notify/.test(notif),
    'S10 桌面端那条系统通知链还在（改造面板不许顺手把 09-30 接的桌面通知删掉）')
  check(/data-rail-panel="notifications"/.test(notif),
    'S11 面板留了一枚可量的锚（几何判据靠它，不靠类名猜）')

  check(/\/studio\/search/.test(search) || /\/studio\/search/.test(rail),
    'S12 窄栏放大镜改成进整页 /studio/search')
  check(!/absolute left-full/.test(search) && !/\bw-80\b/.test(search),
    'S13 搜索那枚小卡整个退场（left-full＋w-80 不再出现）',
    `→ 还留着 left-full:${/absolute left-full/.test(search)} w-80:${/\bw-80\b/.test(search)}`)
  check(existsSync(SEARCH_PAGE), `S14 搜索整页的路由文件存在（${SEARCH_PAGE}）`)
  check(existsSync(SEARCH_API), `S15 全局搜索接口存在（${SEARCH_API}）`)
  check(/projectAccessWhere/.test(api) && /'READY'/.test(api) && /take/.test(api),
    'S16 接口按现成可见范围口径收口、素材只算 READY、有条数上限（受限项目与别的团队不许从搜索漏出来）')
  check(/location\.search/.test(page) && /history\.replaceState/.test(page) && !/useSearchParams\(/.test(page),
    'S17 关键字写进 URL（刷新、把链接发给别人都还在，对标 /search?query= 就是这个意思）；'
    + '这页是静态路由，用 useSearchParams 会被 next build 判成「整页不能静态渲染」，所以走 location 那一套',
    `→ location.search ${/location\.search/.test(page)} / replaceState ${/history\.replaceState/.test(page)} / useSearchParams ${/useSearchParams/.test(page)}`)
  check(/›/.test(page) && /项/.test(page),
    'S18 结果行带出处（项目 › 文件夹）与底部条数「N 项」')
  check(/aria-current/.test(search) && /text-foreground/.test(search) && !/bg-accent/.test(search),
    'S19 放大镜的选中态退成中性字色（他 10-18 点的：不再铺底色块），与「项目中心」那枚同一套语言')
  check(/addEventListener\('railSearchQuery'/.test(read('src/app/studio/projects/page.tsx')),
    'S19·b 窄栏→项目中心那条总线留着（列表页仍在听）：放大镜改整页，不等于把这条线拆掉')
  check(/hasThumbnail/.test(api) && /thumbnailPath/.test(api),
    'S19·c 接口只带「有没有封面」这一枚布尔；thumbnailPath 是存储侧路径，不许跟着搜索结果出到前端')
  check(/video-token/.test(page) && /onError/.test(page),
    'S19·d 搜索页的封面走现成的逐枚签发（和工作区网格同一套），并且签不到时有退回，不留裂图')
  const fb = read(FEEDBACK)
  check(!/absolute left-full/.test(fb) && !/\bw-96\b/.test(fb),
    'S20·a 反馈不再是贴在窄栏底部旁边的那张小卡（left-full＋w-96 整个退场）',
    `→ 还留着 left-full:${/absolute left-full/.test(fb)} w-96:${/\bw-96\b/.test(fb)}`)
  check(/from '@\/components\/ui\/dialog'/.test(fb) && /<DialogContent/.test(fb),
    'S20·b 反馈改用仓库现成的居中弹窗壳（Radix Dialog，和成员／设置那两扇窗同一套），不是自己再搓一层')
  check(/请提出您的意见/.test(fb) && /添加细节（必填）/.test(fb) && /aria-label="提交反馈"/.test(fb),
    'S20·c 弹窗三块都在：标题「提交反馈」＋那句引导＋「添加细节（必填）」（对标那三块一块不缺，✕ 由壳子自带）')
  const cats = read('src/lib/feedback-categories.ts')
  const catsCount = (cats.match(/key: '/g) || []).length
  check(/data-feedback-categories/.test(fb) && /aria-pressed/.test(fb) && catsCount === 6 && /FEEDBACK_CATEGORIES/.test(fb),
    'S20·d 那一排是六枚可点的类型胶囊（对标是一排 chips，不是下拉），选中态用 aria-pressed 说得清；'
    + '标签表只有一份（src/lib/feedback-categories.ts），界面画它、接口认它，不各写一遍',
    `→ 标签 ${catsCount} 枚，弹窗引用同一份：${/FEEDBACK_CATEGORIES/.test(fb)}`)
  check(/disabled=\{submitting \|\| !content\.trim\(\)\}/.test(fb) && /取消/.test(fb),
    'S20·e 没写字时「提交」是灰的、旁边有「取消」（对标那颗 disabled 的提交按钮）')
  check(/我的反馈/.test(fb) && /运营回复/.test(fb),
    'S20·f 历史与运营回复这块留着（对标弹窗里没有，但这是我们已有的功能，改形态不等于删功能）')
  const fbApi = read('src/app/api/feedback/route.ts')
  const schema = read('prisma/schema.prisma')
  const catMigration = existsSync('prisma/migrations/20261018162000_add_platform_feedback_category/migration.sql')
  check(/category\s+String\?/.test(schema) && catMigration
    && /isFeedbackCategory\(rawCategory\)/.test(fbApi) && /content, category \}/.test(fbApi)
    && /content: trimmed, category \}/.test(fb) && !/类型：/.test(fb),
    'S20·g 类型落在 PlatformFeedback.category 这一列：schema 有这列、迁移在档、接口按那六枚白名单收进列、'
    + '弹窗把类型当字段发——10-18 点单第 1 条，替掉之前「拼在正文第一行」那版',
    `→ schema:${/category\s+String\?/.test(schema)} 迁移:${catMigration} 接口收列:${/isFeedbackCategory\(rawCategory\)/.test(fbApi)} `
    + `前端字段:${/content: trimmed, category \}/.test(fb)} 前缀残留:${/类型：/.test(fb)}`)
  check(/category: f\.category/.test(read('src/app/api/platform/feedback/route.ts'))
    && /\{item\.category &&/.test(read('src/app/platform/messages/page.tsx')),
    'S20·i 运营后台读得到类型：收件箱接口把 category 带出来、名单里画成一枚标签——加一列不画出来等于没加')

  // 整棵 api 树都扫，不是只盯窄栏这四条：identifier 缺省 'general' 时，全仓所有漏名的调用共用同一枚键。
  const rlFiles: string[] = []
  const walkRoutes = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walkRoutes(p)
      else if (entry.name === 'route.ts') rlFiles.push(p)
    }
  }
  walkRoutes('src/app/api')
  let rlTotal = 0
  const rlUnnamed: string[] = []
  for (const file of rlFiles) {
    const s = read(file)
    // 按括号深度数每一枚调用的实参：第三个实参就是 identifier，只有两个实参＝用了缺省名。
    for (const m of s.matchAll(/(?<![\w.])rateLimit\(/g)) {
      let i = (m.index || 0) + m[0].length, depth = 1, args = 1, quote: string | null = null
      while (i < s.length && depth > 0) {
        const c = s[i]
        if (quote) { if (c === '\\') i++; else if (c === quote) quote = null }
        else if (c === '"' || c === "'" || c === '`') quote = c
        else if (c === '(' || c === '[' || c === '{') depth++
        else if (c === ')' || c === ']' || c === '}') depth--
        else if (c === ',' && depth === 1) args++
        i++
      }
      rlTotal++
      if (args < 3) rlUnnamed.push(`${file}:${s.slice(0, m.index).split('\n').length}`)
    }
  }
  check(rlTotal >= 100 && rlUnnamed.length === 0,
    'S20·h 全仓每一处限流都自带名字：rateLimit 的 identifier 缺省是 "general"，也就是共用同一枚 Redis 键——'
    + '反馈那条 5/10 分钟会把通知那两条 60/1 分钟挤爆（谁后调用谁定窗口和上限），实测一次提交后通知就 429',
    `→ ${rlTotal} 处调用${rlUnnamed.length ? `，漏名：${rlUnnamed.join('、')}` : '，全带名字'}`)

  check(/lg:w-\[56px\]/.test(rail) && /h-\[44px\] w-\[44px\]/.test(rail),
    'S21 护栏：窄栏宽度与 44px 命中区一字没动（A16/A17 钉的就是这两个数）')
  const railOrder = [rail.indexOf('<RailNotifications'), rail.indexOf('/studio/desktop'), rail.indexOf('label="团队管理"')]
  check(railOrder.every((n) => n >= 0) && railOrder[0] < railOrder[1] && railOrder[1] < railOrder[2] && !/href="\/dl"/.test(rail),
    'S22 窄栏在通知与团队管理中间那枚指 /studio/desktop（10-19 他先要直下、看完改成先要一页）；栏里不再直接出现 /dl——'
    + '直链留在页面里，版本号只在服务端现读，界面不写死',
    `→ 三者在源码里的位置 ${JSON.stringify(railOrder)}；栏里还有 /dl：${/href="\/dl"/.test(rail)}`)
  check(existsSync('src/app/dl/route.ts') && existsSync('src/lib/desktop-feed.ts')
    && /readDesktopRelease/.test(read('src/app/dl/route.ts')) && /readDesktopRelease/.test(read('src/app/studio/desktop/page.tsx')),
    'S22·b /dl 这条老链接还在（已发进聊天记录和文档，断不得），且它和下载页读同一份 src/lib/desktop-feed.ts，'
    + '不各写一遍解析清单的正则')

  // ══ fixtures ══════════════════════════════════════════════════════════
  for (const [index, key] of ['owner', 'clean', 'peer'].entries()) {
    const email = key === 'owner' ? ownerEmail : key === 'clean' ? cleanEmail : peerEmail
    const row = await prisma.user.create({
      data: { email, name: key === 'owner' ? '面板主账号' : key, password: await hashPassword(pw), phone: `138${short}${index}` },
    })
    ids[key] = row.id
  }
  const team = await prisma.team.create({
    data: {
      id: await allocateTeamId(prisma), name: `rp-${short}`, slug: `rp-${short}`, shareKey: `rp-${short}`,
      createdById: ids.owner, subscriptionPlan: 'BETA',
      members: { create: [
        { userId: ids.owner, role: 'OWNER', status: 'ACTIVE' },
        { userId: ids.peer, role: 'MEMBER', status: 'ACTIVE' },
      ] },
    },
  })
  teamIds.push(team.id)
  // 另一枚团队放一枚同名素材：搜索不许把它漏给上面那个人
  const otherTeam = await prisma.team.create({
    data: {
      id: await allocateTeamId(prisma), name: `rp2-${short}`, slug: `rp2-${short}`, shareKey: `rp2-${short}`,
      createdById: ids.clean, subscriptionPlan: 'BETA', members: { create: { userId: ids.clean, role: 'OWNER', status: 'ACTIVE' } },
    },
  })
  teamIds.push(otherTeam.id)
  const project = await prisma.project.create({
    data: { teamId: team.id, createdById: ids.owner, projectCode: `A${short}`, title: `面板试验项目${word}`, slug: `rpp-${short}`, shareSlug: `rpps-${short}`, hideFeedback: false },
  })
  projectIds.push(project.id)
  const otherProject = await prisma.project.create({
    data: { teamId: otherTeam.id, createdById: ids.clean, projectCode: `B${short}`, title: `别队的同名-${short}`, slug: `rpo-${short}`, shareSlug: `rpos-${short}` },
  })
  projectIds.push(otherProject.id)

  const videoBase = {
    version: 1, versionLabel: 'v1', originalFileName: 'x.mp4', originalStoragePath: `local/${short}.mp4`,
    duration: 61.5, width: 320, height: 240, fileType: 'video/mp4', uploadedBy: ids.owner,
    uploadedByName: '面板主账号', status: 'READY' as const, originalFileSize: BigInt(25_530_000),
  }
  const hit = await prisma.video.create({ data: { projectId: project.id, name: assetName, ...videoBase } })
  const stale = await prisma.video.create({ data: { projectId: project.id, name: `对标素材${word}-转码中.mp4`, ...videoBase, status: 'PROCESSING' as const } })
  const withThumb = await prisma.video.create({ data: { projectId: project.id, name: `有封面${word}.mp4`, ...videoBase, thumbnailPath: `local/does-not-exist-${short}.jpg` } })
  const leaked = await prisma.video.create({ data: { projectId: otherProject.id, name: assetName, ...videoBase, uploadedBy: ids.clean, uploadedByName: 'clean' } })

  // 一条我发的批注 ＋ 同事的回复 ＝ 一条「有人回复了你」
  const rootComment = await prisma.comment.create({
    data: { projectId: project.id, videoId: hit.id, userId: ids.owner, authorName: '面板主账号', authorEmail: ownerEmail, content: `我的批注-${short}`, timecode: '00:01' },
  })
  const reply = await prisma.comment.create({
    data: { projectId: project.id, videoId: hit.id, parentId: rootComment.id, userId: ids.peer, authorName: '同事甲', authorEmail: peerEmail, content: `回复你的-${short}`, timecode: '00:01' },
  })
  const announcement = await prisma.platformAnnouncement.create({
    data: { userId: ids.owner, title: `内测消息-${short}`, content: '混合列表里第二条该是它' },
  })

  const tokenRes = await call('POST', '/api/auth/login', '', { email: ownerEmail, password: pw })
  adminToken = tokenRes.json?.tokens?.accessToken as string
  if (!adminToken) throw new Error(`登录失败 → ${tokenRes.status} ${JSON.stringify(tokenRes.json)?.slice(0, 160)}`)

  // 预热：dev 冷路由要 20–35 秒，否则量到的是 webpack 编译不是产品
  const warm = async (path: string, token?: string) => {
    try { return String((await fetch(`${BASE}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {}, cache: 'no-store', redirect: 'manual' })).status) }
    catch (e) { return `预热失败 ${(e as Error).message}` }
  }
  for (const p of ['/login', '/studio/projects', '/studio/search', `/api/studio/search?q=${encodeURIComponent(word)}`, '/api/comments/for-me', '/api/announcements']) {
    console.log(`预热 ${p} → ${await warm(p, p.startsWith('/api/') ? adminToken : undefined)}`)
  }

  // ══ N 组：接口 ════════════════════════════════════════════════════════
  console.log('\n── N 组：接口 ──')
  const found = await call('GET', `/api/studio/search?q=${encodeURIComponent(word)}`, adminToken)
  const foundJson: any = found.json || {}
  check(found.status === 200 && Array.isArray(foundJson.assets) && Array.isArray(foundJson.projects),
    'N1 搜索接口回 { projects, assets, total }', `→ ${found.status} ${JSON.stringify(foundJson).slice(0, 140)}`)
  check((foundJson.assets || []).some((v: any) => v.id === hit.id),
    'N2 命中的素材在结果里', `→ ${(foundJson.assets || []).map((v: any) => v.id).join(',')}`)
  check(!(foundJson.assets || []).some((v: any) => v.id === stale.id),
    'N3 转码中的版本不进结果（点进去会是空面板）')
  check(!(foundJson.assets || []).some((v: any) => v.id === leaked.id),
    'N4 别队那枚同名素材搜不到（收口在 projectAccessWhere，不是靠前端过滤）')
  check((foundJson.projects || []).some((v: any) => v.id === project.id),
    'N5 项目命中也在结果里（同一个词既能命中素材名也能命中项目名）', `→ ${(foundJson.projects || []).map((v: any) => v.id).join(',')}`)
  check((foundJson.assets || []).some((v: any) => v.id === hit.id && v.hasThumbnail === false)
    && (foundJson.assets || []).some((v: any) => v.id === withThumb.id && v.hasThumbnail === true),
    'N4·b 有封面那枚 hasThumbnail=true、没封面那枚=false（前端就按这个决定要不要去签 token）',
    `→ ${(foundJson.assets || []).map((v: any) => `${v.id.slice(-4)}:${v.hasThumbnail}`).join(' ')}`)
  check(!JSON.stringify(foundJson).includes('does-not-exist'), 'N4·c 返回体里没有存储路径')
  const emptyQ = await call('GET', '/api/studio/search?q=%20', adminToken)
  check(emptyQ.status !== 500, 'N6 空关键字不报 500', `→ ${emptyQ.status}`)
  const anon = await fetch(`${BASE}/api/studio/search?q=${encodeURIComponent(word)}`)
  check(anon.status === 401, 'N7 没登录搜不到任何东西', `→ ${anon.status}`)
  const scoped = await call('GET', `/api/studio/search?q=${encodeURIComponent(word)}&type=projects`, adminToken)
  check((scoped.json?.assets || []).length === 0 && (scoped.json?.projects || []).length > 0,
    'N8 type=projects 时素材这一路不查（筛选真的落到查询上，不是拿回来再藏）',
    `→ assets ${(scoped.json?.assets || []).length} / projects ${(scoped.json?.projects || []).length}`)

  // 运营端读得到这一列才算「加了字段」：单独造一枚平台管理员，别动 owner 的标记——
  // 窄栏会因他多出一个图标，B 组量的几何就不是原来那块了。
  const opsEmail = `ops-${short}@rail-panel.test`
  const opsUser = await prisma.user.create({ data: { email: opsEmail, name: '运营探针', password: await hashPassword(pw), isPlatformAdmin: true } })
  // 挂进 ids：中途任何一句抛了，收尾那段 finally 也认得这枚账号（PlatformFeedback 挂在 user 上是 Cascade）。
  ids.ops = opsUser.id
  const opsRow = await prisma.platformFeedback.create({ data: { userId: opsUser.id, content: `运营侧读类型-${short}`, category: '卡顿缓慢' } })
  // 平台后台那一路吃的是另一枚令牌（type: 'platform_access'，只有 /api/platform/auth/login 发），
  // 普通登录给的 accessToken 在 requirePlatformAuth 那里就是 401。
  const opsLogin = await call('POST', '/api/platform/auth/login', '', { identifier: opsEmail, password: pw })
  const opsToken = opsLogin.json?.tokens?.accessToken as string
  const inbox = await call('GET', '/api/platform/feedback', opsToken)
  const seen = (inbox.json?.items || []).find((row: any) => row.id === opsRow.id)
  const inboxProbe = JSON.stringify(seen ?? (inbox.json?.items || []).slice(0, 1))
  check(opsLogin.status === 200 && inbox.status === 200 && seen?.category === '卡顿缓慢' && seen?.content === `运营侧读类型-${short}`,
    'N9 运营端收件箱把类型作为独立字段交出来（不是让人从正文第一行拆），正文里不含那一行前缀',
    `→ 平台登录 ${opsLogin.status}／收件箱 ${inbox.status} ${inboxProbe.slice(0, 180)}`)
  await prisma.platformFeedback.delete({ where: { id: opsRow.id } }).catch(() => null)

  void reply; void announcement; void leaked; void stale

  if (!WITH_BROWSER) {
    console.log('\n（B 组浏览器实测没跑：加 --browser 才跑；它要一站跑着的 next dev，站点由 SHARE_CHECK_BASE 定，默认 :3000）')
  } else {
    console.log('\n── B 组：浏览器实测 ──')
    chrome = await connectChrome()
    const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then(r => r.json())
    await attachSocket(webSocketDebuggerUrl)

    const page1 = await openPage()
    await page1.s('Network.enable')
    console.log(`  登录（主账号）→ ${await loginInBrowser(page1, ownerEmail)}`)
    await page1.s('Page.navigate', { url: `${BASE}/studio/projects` })
    check(await waitFor(page1, `document.querySelector('aside')`, 120_000), 'B1 窄栏画得出来（页面活着）')
    check(await waitFor(page1, `[...document.querySelectorAll('aside button')].some(b => (b.getAttribute('aria-label') || '').includes('通知'))`, 30_000),
      'B2 窄栏里有那枚铃铛')
    await evalJs(page1, `[...document.querySelectorAll('aside button')].find(b => (b.getAttribute('aria-label') || '').includes('通知')).click()`)
    check(await waitFor(page1, `document.querySelector('[data-rail-panel="notifications"]')`, 20_000), 'B3 点铃铛能开面板')
    // 面板先画空壳、数据随后到（打开时各打一次端点），所以先等自己那条夹具进来再量。
    check(await waitFor(page1, `document.querySelector('[data-rail-panel="notifications"]').innerText.includes('回复你的-')`, 20_000),
      'B2·b 面板里的数据真的到了（不是只画了空壳）', `→ /api/comments/for-me 回包 ${JSON.stringify(networkLog) || '（一条没记到）'}`)
    // 两拨数据是两条独立请求：只等其中一条就量，会量到「另一条还没到」那一帧（B9 10-19 就这么红过一次）。
    check(await waitFor(page1, `document.querySelectorAll('[data-rail-panel="notifications"] [data-notification-row]').length >= 2`, 20_000),
      'B2·c 两拨数据都进了 DOM（批注回复＋平台消息），后面的几何、文案与截图才是拿整张表量的')
    await shot(page1, 'a-通知面板')
    const f: any = JSON.parse(String(await evalJs(page1, PANEL_FACTS)))
    check(!f.missing, 'B3·b 面板取证取到了内容', `→ ${JSON.stringify(f).slice(0, 140)}`)
    check(Math.abs(f.left - 56) <= 1 && f.top <= 1 && Math.abs(f.bottom - f.innerH) <= 1 && Math.abs(f.width - 288) <= 1,
      `B4 面板几何＝整高栏面：左缘 ${f.left}（窄栏右缘 56）、上 ${f.top}、下 ${f.bottom}／视口 ${f.innerH}、宽 ${f.width}`,
      `→ 视口 ${f.innerW}×${f.innerH}`)
    check(f.bg === f.popoverBg && f.bg !== 'rgba(0, 0, 0, 0)',
      'B5 面板底色就是本站栏面那一档（bg-popover 实算，不是卡片底也不是画布）',
      `→ 面板 ${f.bg} / bg-popover 探针 ${f.popoverBg}`)
    check(parseFloat(f.radius) === 0 && (f.shadow === 'none' || /rgba\(0, 0, 0, 0\)/.test(f.shadow)),
      'B6 面板本体无圆角无阴影（对标那块是平铺栏面）', `→ radius ${f.radius} / shadow ${String(f.shadow).slice(0, 46)}`)
    check(f.rules.length === 1,
      'B7 整块面板只有一条分隔线（标题行与标签行之间），别把旧小卡那三条带进来', `→ ${JSON.stringify(f.rules)}`)
    check(/全部标记为已读/.test(f.text),
      'B8 标签行那枚显式按钮真的画出来了', `→ ${JSON.stringify(String(f.text).slice(0, 60))}`)
    check(f.text.includes(`回复你的-${short}`) && f.text.includes(`内测消息-${short}`),
      'B9 混合列表：批注回复与平台消息同屏按时间排（两拨数据各出一条）', `→ ${JSON.stringify(String(f.text).slice(0, 160))}`)
    const bellLabel = String(await evalJs(page1, `[...document.querySelectorAll('aside button')].map(b => b.getAttribute('aria-label')).filter(a => a && a.includes('通知')).join(' | ')`))
    check(/条未读通知/.test(bellLabel),
      'B10 面板开着的时候红点还在（点开不等于读完）', `→ ${bellLabel}`)
    const dlGeo = String(await evalJs(page1, `(() => {
      const mid = (el) => el ? Math.round(el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2) : -1
      const bell = [...document.querySelectorAll('aside button')].find(b => (b.getAttribute('aria-label') || '').includes('通知'))
      const dl = document.querySelector('aside a[href="/studio/desktop"]')
      const team = [...document.querySelectorAll('aside a')].find(a => a.title === '团队管理')
      const box = dl?.getBoundingClientRect()
      return JSON.stringify({ bell: mid(bell), dl: mid(dl), team: mid(team), href: dl?.getAttribute('href') || null, target: dl?.getAttribute('target') || null, size: box ? [Math.round(box.width), Math.round(box.height)] : null })
    })()`))
    const g = JSON.parse(dlGeo)
    check(g.href === '/studio/desktop' && g.target === null && g.dl > g.bell && g.dl < g.team && g.size?.[0] === 44 && g.size?.[1] === 44,
      'B10·b 桌面客户端这枚真的落在通知与团队管理中间、命中区和其他图标同为 44px、是站内链接（不是新标签、也不是直链）', `→ ${dlGeo}`)
    const NB = `[...document.querySelectorAll('[data-rail-panel="notifications"] button')]`
    const ROWS = `[data-rail-panel="notifications"] [data-notification-row]`
    const allRows = Number(await evalJs(page1, `document.querySelectorAll('${ROWS}').length`))
    const allMarked = Number(await evalJs(page1, `[...document.querySelectorAll('${ROWS}')].filter(r => /未读/.test(r.innerText)).length`))
    check(await waitFor(page1, `${NB}.some(b => b.textContent.trim().startsWith('未读'))`, 10_000),
      'B11 「未读」这枚筛选在')
    await evalJs(page1, `${NB}.find(b => b.textContent.trim().startsWith('未读')).click()`)
    await sleep(700)
    const unreadRows = Number(await evalJs(page1, `document.querySelectorAll('${ROWS}').length`))
    check(allMarked > 0 && unreadRows === allMarked,
      `B12 「未读」只留带未读标记的那几行（全部 ${allRows} 行里 ${allMarked} 行带标记，筛后 ${unreadRows} 行）`)
    await evalJs(page1, `${NB}.find(b => b.textContent.trim() === '全部').click()`)
    await sleep(500)
    await evalJs(page1, `${NB}.find(b => b.textContent.includes('全部标记为已读')).click()`)
    await evalJs(page1, `${NB}.find(b => b.textContent.trim().startsWith('未读')).click()`)
    // 「全部标记为已读」往服务端发一笔（平台消息的水位；批注回复的水位写在本地），面板几秒后会重拉一次：
    // dev 冷编译能把那一笔拖到十几秒，重拉就赶在它前面 ⇒ 定长 sleep 掷硬币（10-18 在一份新起的实例上
    // 红过一次：3 行只清了 1 行）。等真状态，不等时间。
    const cleared = await waitFor(page1,
      `document.querySelectorAll('${ROWS}').length === 0 && !/条未读通知/.test([...document.querySelectorAll('aside button')].map(b => b.getAttribute('aria-label') || '').join('|'))`, 90_000)
    const afterMark = String(await evalJs(page1, `JSON.stringify({ rows: document.querySelectorAll('${ROWS}').length, label: [...document.querySelectorAll('aside button')].find(b => (b.getAttribute('aria-label') || '').includes('通知'))?.getAttribute('aria-label') })`))
    check(cleared && JSON.parse(afterMark).rows === 0 && !/条未读通知/.test(String(JSON.parse(afterMark).label)),
      'B13 按下「全部标记为已读」才清：未读筛出来 0 行、红点没了', `→ 两笔都落地 ${cleared}；${afterMark}`)
    // 上面停在「未读」那一屏（刚清完是 0 行），这里先切回全部，静音前后才有可比的两行/三行。
    await evalJs(page1, `${NB}.find(b => b.textContent.trim() === '全部').click()`)
    await sleep(600)
    await evalJs(page1, `${NB}.find(b => b.getAttribute('aria-label') === '通知设置').click()`)
    check(await waitFor(page1, `document.querySelector('[data-notification-settings]')`, 10_000), 'B14 齿轮点开设置卡')
    await shot(page1, 'd-设置卡')
    const beforeMute = Number(await evalJs(page1, `document.querySelectorAll('[data-rail-panel="notifications"] [data-notification-row]').length`))
    await evalJs(page1, `[...document.querySelectorAll('[data-notification-settings] [role="switch"]')].find(b => b.textContent.includes('批注回复')).click()`)
    await sleep(700)
    const afterMute: any = JSON.parse(String(await evalJs(page1, `JSON.stringify({
      rows: document.querySelectorAll('[data-rail-panel="notifications"] [data-notification-row]').length,
      stillThere: document.querySelector('[data-rail-panel="notifications"]').innerText.includes('回复你的-'),
      stored: localStorage.getItem('admin_notification_kinds'),
    })`)))
    check(afterMute.rows === beforeMute - 1 && !afterMute.stillThere && /"reply":false/.test(String(afterMute.stored)),
      `B15 关掉「批注回复提醒」：那条立刻从列表与红点里退掉，并写进 localStorage（${beforeMute}→${afterMute.rows} 行）`, `→ ${JSON.stringify(afterMute)}`)
    await page1.s('Page.navigate', { url: `${BASE}/studio/projects` })
    await waitFor(page1, `document.querySelector('aside')`, 60_000)
    await evalJs(page1, `[...document.querySelectorAll('aside button')].find(b => (b.getAttribute('aria-label') || '').includes('通知')).click()`)
    await waitFor(page1, `document.querySelector('[data-rail-panel="notifications"]')`, 20_000)
    check(!(await evalJs(page1, `document.querySelector('[data-rail-panel="notifications"]').innerText.includes('回复你的-')`)),
      'B16 刷新之后仍是关的（设置真的持久，不是只改了这一次渲染）')
    await page1.s('Runtime.evaluate', { expression: `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))` })
    await sleep(600)
    check(await evalJs(page1, `!document.querySelector('[data-rail-panel="notifications"]')`), 'B17 Esc 关得掉面板')
    await closePage(page1)

    // 空态：一枚干净的账号（没有任何回复与消息）
    const page2 = await openPage()
    console.log(`  登录（干净账号）→ ${await loginInBrowser(page2, cleanEmail)}`)
    await page2.s('Page.navigate', { url: `${BASE}/studio/projects` })
    await waitFor(page2, `document.querySelector('aside')`, 120_000)
    await evalJs(page2, `[...document.querySelectorAll('aside button')].find(b => (b.getAttribute('aria-label') || '').includes('通知')).click()`)
    await waitFor(page2, `document.querySelector('[data-rail-panel="notifications"]')`, 20_000)
    // 干净账号也有一条全员广播，所以空态要先把能标的都标掉、再切到「未读」才落得进去。
    const NB2 = `[...document.querySelectorAll('[data-rail-panel="notifications"] button')]`
    await evalJs(page2, `(() => { const b = ${NB2}.find(x => x.textContent.includes('全部标记为已读')); if (b && !b.disabled) b.click(); return true })()`)
    await sleep(1500)
    await evalJs(page2, `${NB2}.find(x => x.textContent.trim().startsWith('未读')).click()`)
    await sleep(700)
    const emptyState: any = JSON.parse(String(await evalJs(page2, `(() => {
      const p = document.querySelector('[data-rail-panel="notifications"]')
      const g = p.querySelector('[data-empty-bell]')
      if (!g) return JSON.stringify({ missing: true, text: p.innerText.slice(0, 120) })
      const b = g.getBoundingClientRect(); const pb = p.getBoundingClientRect()
      return JSON.stringify({ text: p.innerText, bellCenter: Math.round(b.top + b.height / 2), panelCenter: Math.round(pb.top + pb.height / 2), panelH: Math.round(pb.height) })
    })()`)))
    await shot(page2, 'b-空态')
    check(!emptyState.missing, 'B18·a 未读筛到 0 行时空态画得出来', `→ ${JSON.stringify(emptyState.text || '')}`)
    check(/暂无更新/.test(emptyState.text) && /您的账户活动将在此显示/.test(emptyState.text),
      'B18 空态两句照对标原文', `→ ${JSON.stringify(String(emptyState.text).slice(0, 70))}`)
    check(Math.abs(emptyState.bellCenter - emptyState.panelCenter) <= emptyState.panelH * 0.08,
      `B19 空态整块垂直居中（铃铛中心 ${emptyState.bellCenter}／面板中心 ${emptyState.panelCenter}，容差 ${(emptyState.panelH * 0.08).toFixed(0)}px）`)
    await closePage(page2)

    // 搜索整页
    const page3 = await openPage()
    console.log(`  登录（主账号）→ ${await loginInBrowser(page3, ownerEmail)}`)
    await page3.s('Page.navigate', { url: `${BASE}/studio/projects` })
    await waitFor(page3, `document.querySelector('aside')`, 120_000)
    const linkFacts = String(await evalJs(page3, `document.querySelector('aside a[href="/studio/search"]') ? '有' : '没有'`))
    check(linkFacts === '有', 'B20 窄栏放大镜改成一条链接（不是按钮＋浮层）')
    await evalJs(page3, `document.querySelector('aside a[href="/studio/search"]').click()`)
    check(await waitFor(page3, `location.pathname === '/studio/search'`, 120_000), 'B21 点放大镜真的进 /studio/search')
    const activeState: any = JSON.parse(String(await evalJs(page3, `(() => {
      const link = document.querySelector('aside a[href="/studio/search"]')
      const cs = getComputedStyle(link)
      const probe = document.createElement('div'); probe.className = 'text-foreground'; link.parentElement.appendChild(probe)
      const fg = getComputedStyle(probe).color; probe.remove()
      return JSON.stringify({ current: link.getAttribute('aria-current'), color: cs.color, fg, bg: cs.backgroundColor })
    })()`)))
    check(activeState.current === 'page' && activeState.color === activeState.fg && /rgba\(0, 0, 0, 0\)|transparent/.test(activeState.bg),
      'B22 选中态＝中性字色、不铺底色（和 text-foreground 量出来同一个色）',
      `→ aria-current ${activeState.current} / color ${activeState.color} / text-foreground ${activeState.fg} / bg ${activeState.bg}`)
    check(await waitFor(page3, `document.querySelector('input[type="search"]')`, 60_000), 'B23 搜索页顶部有输入框')
    const inputBox: any = JSON.parse(String(await evalJs(page3, `(() => {
      const i = document.querySelector('input[type="search"]')
      const b = i.getBoundingClientRect()
      return JSON.stringify({ cx: Math.round(b.left + b.width / 2), w: Math.round(b.width), innerW: window.innerWidth })
    })()`)))
    // 内容区是窄栏右缘到视口右缘那一条，中线＝(56＋视口宽)/2，不是「56 再加半个视口」。
    const midline = (56 + inputBox.innerW) / 2
    check(Math.abs(inputBox.cx - midline) <= 24,
      `B24 输入框在内容区里水平居中（中心 ${inputBox.cx}／内容区中线 ${midline.toFixed(0)}，宽 ${inputBox.w}）`)
    await evalJs(page3, `(() => {
      const i = document.querySelector('input[type="search"]')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(i, ${JSON.stringify(word)})
      i.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    check(await waitFor(page3, `document.body.innerText.includes(${JSON.stringify(assetName)})`, 30_000),
      'B25 打字即搜：结果里画出了那枚素材名')
    check(await waitFor(page3, `location.search.length > 3`, 10_000),
      'B26 关键字写进 URL', `→ ${await evalJs(page3, 'location.search')}`)
    const rows: any = JSON.parse(String(await evalJs(page3, `(() => {
      const list = [...document.querySelectorAll('[data-search-row]')]
      return JSON.stringify({ count: list.length, text: list.map(r => r.innerText).join(' ⏎ ').slice(0, 300) })
    })()`)))
    check(rows.count === 3 && rows.text.includes(assetName) && !rows.text.includes('别队的同名'),
      `B27 三行：自己队的项目＋两枚素材，别队那枚同名素材没漏进来（实得 ${rows.count} 行）`, `→ ${rows.text.slice(0, 160)}`)
    // 签发是和渲染同时起跑的：先等那条 resource 计时落地，别拿采样早晚当产品坏没坏。
    await waitFor(page3, `performance.getEntriesByType('resource').some(e => e.name.includes('/api/studio/video-token'))`, 20_000)
    const tokenCalls = Number(await evalJs(page3, `performance.getEntriesByType('resource').filter(e => e.name.includes('/api/studio/video-token')).length`))
    // 签发到手 ≠ 图真出得来（夹具那枚指向一个不存在的文件）：等这一行落定——要么图真在，要么退回首字。
    const thumbSettled = await waitFor(page3, `(() => {
      const row = [...document.querySelectorAll('[data-search-row]')].find(r => r.innerText.includes('有封面'))
      const img = row && row.querySelector('img')
      return !img || (img.complete && img.naturalWidth > 0)
    })()`, 15_000)
    const thumbRow = String(await evalJs(page3, `(() => {
      const row = [...document.querySelectorAll('[data-search-row]')].find(r => r.innerText.includes('有封面'))
      const img = row && row.querySelector('img')
      return JSON.stringify({ found: !!row, brokenImg: !!img && img.complete && img.naturalWidth === 0, initials: row ? /[一-龥]/.test(row.querySelector('span').innerText) : false })
    })()`))
    check(thumbSettled && tokenCalls >= 1 && JSON.parse(thumbRow).found && JSON.parse(thumbRow).initials && !JSON.parse(thumbRow).brokenImg,
      `B27·b 有封面的行真的去签了 token（实发 ${tokenCalls} 次），签不到就退回名称首字那块灰片、不留裂图`, `→ ${thumbRow}`)
    check(/›/.test(rows.text) && /1:01/.test(rows.text),
      'B28 结果行带出处与时长（项目 › …，右侧时长角标）', `→ ${rows.text.slice(0, 180)}`)
    await shot(page3, 'c-搜索结果')
    const counter = String(await evalJs(page3, `document.body.innerText.match(/[0-9]+[^\\n]{0,3}项/)?.[0] || ''`))
    const apiSame = await call('GET', `/api/studio/search?q=${encodeURIComponent(word)}`, adminToken)
    const apiTotal = Number(apiSame.json?.total ?? -1)
    check(/\d+/.test(counter) && Number(counter.match(/\d+/)?.[0]) === apiTotal,
      `B29 界面那句「N 项」就是服务端总数（界面 ${counter}／接口 total ${apiTotal}）`)
    // 点一行结果 → 落进那枚素材所在的项目工作区，并把审阅面板拉开（?asset= 那条深链）
    await evalJs(page3, `[...document.querySelectorAll('[data-search-row]')].find(r => r.innerText.includes(${JSON.stringify(assetName)})).click()`)
    check(await waitFor(page3, `location.pathname === ${JSON.stringify('/studio/projects/' + project.id)} && location.search.includes('asset=')`, 120_000),
      'B30 点结果行真的跳进那个项目并带上 ?asset=', `→ ${await evalJs(page3, 'location.pathname + location.search')}`)
    check(await waitFor(page3, `document.body.innerText.includes(${JSON.stringify(assetName)})`, 120_000),
      'B31 落地那一屏真的把这枚素材摆出来了（工作区认了 ?asset=，不是只换了个 URL）')
    await closePage(page3)

    // 反馈：对标的形态是居中弹窗（遮罩盖整屏），不是贴在窄栏边上的小卡
    const page4 = await openPage()
    console.log(`  登录（主账号）→ ${await loginInBrowser(page4, ownerEmail)}`)
    await page4.s('Page.navigate', { url: `${BASE}/studio/projects` })
    await waitFor(page4, `document.querySelector('aside')`, 120_000)
    await evalJs(page4, `[...document.querySelectorAll('aside button')].find(b => b.getAttribute('aria-label') === '提交反馈').click()`)
    check(await waitFor(page4, `document.querySelector('[data-feedback-categories]')`, 120_000), 'C1 点灯泡开的是弹窗（不是贴在栏边的小卡）')
    await sleep(600)
    check(await evalJs(page4, `document.activeElement?.id === 'rail-feedback-content'`),
      'C1·b 一打开光标就在正文里（对标也是这样：打开就能打字，不是先落在第一枚类型胶囊上）',
      `→ 焦点在 ${await evalJs(page4, `document.activeElement?.id || document.activeElement?.tagName`)}`)
    await shot(page4, 'e-反馈弹窗')
    const dlg: any = JSON.parse(String(await evalJs(page4, `(() => {
      const p = document.querySelector('[role="dialog"][aria-label="提交反馈"]')
      const b = p.getBoundingClientRect()
      const overlay = document.querySelector('div[data-radix-overlay], .fixed.inset-0')
      const rail = document.querySelector('aside').getBoundingClientRect()
      const hit = document.elementFromPoint(rail.left + rail.width / 2, rail.top + 40)
      return JSON.stringify({
        left: Math.round(b.left), top: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height),
        innerW: window.innerWidth, innerH: window.innerHeight,
        cx: Math.round(b.left + b.width / 2), cy: Math.round(b.top + b.height / 2),
        overlay: overlay ? getComputedStyle(overlay).position : 'none',
        railCovered: !!hit && hit.closest('[role="dialog"]') === null && hit.className.toString().includes('inset-0'),
        chips: [...document.querySelectorAll('[data-feedback-categories] button')].map(x => x.textContent.trim()),
        submitDisabled: [...p.querySelectorAll('button')].some(x => x.textContent.trim() === '提交' && x.disabled),
        text: p.innerText,
      })
    })()`)))
    check(Math.abs(dlg.cx - dlg.innerW / 2) <= 2 && Math.abs(dlg.cy - dlg.innerH / 2) <= 4,
      `C2 弹窗在屏幕正中（中心 ${dlg.cx},${dlg.cy}／视口中线 ${(dlg.innerW / 2).toFixed(0)},${(dlg.innerH / 2).toFixed(0)}）`, `→ ${dlg.width}×${dlg.height}`)
    check(dlg.overlay === 'fixed', 'C3 遮罩是 fixed inset-0，盖整屏', `→ ${dlg.overlay}`)
    check(dlg.railCovered === true, 'C3·b 弹窗开着时窄栏那一点落在遮罩上（遮罩真的在事件路径里，不是只画了一层色）')
    check(dlg.chips.length === 6 && /请提出您的意见/.test(dlg.text) && /添加细节（必填）/.test(dlg.text),
      'C4 标题、那句引导、六枚类型胶囊都画出来了', `→ ${JSON.stringify(dlg.chips)}`)
    check(dlg.submitDisabled === true, 'C5 一个字没写时「提交」是 disabled（对标那颗也是灰的）')
    await evalJs(page4, `document.querySelector('[data-feedback-categories] button').click()`)
    await sleep(400)
    check(await evalJs(page4, `document.querySelector('[data-feedback-categories] button').getAttribute('aria-pressed') === 'true'`),
      'C6 类型胶囊点得动、选中态标得出来')
    await evalJs(page4, `(() => {
      const box = document.querySelector('#rail-feedback-content')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(box, '判据自检：这行提交完就删掉')
      box.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    await sleep(400)
    check(await evalJs(page4, `[...document.querySelectorAll('[role="dialog"] button')].some(x => x.textContent.trim() === '提交' && !x.disabled)`),
      'C7 写了字，「提交」就亮')
    await evalJs(page4, `[...document.querySelectorAll('[role="dialog"] button')].find(x => x.textContent.trim() === '提交').click()`)
    // dev 冷编译能把一次 POST 拖到十几秒（刚改过 API 文件尤其明显），所以等到界面给出结果为止。
    const landed = await waitFor(page4, `/已提交，感谢你的反馈/.test(document.body.innerText) || /提交失败|过于频繁/.test(document.body.innerText)`, 60_000)
    const sent = landed ? await prisma.platformFeedback.findFirst({ where: { userId: ids.owner, content: { contains: '判据自检' } }, select: { id: true, content: true, category: true } }) : null
    check(Boolean(sent) && sent?.category === '功能建议' && !/^类型：/.test(String(sent?.content)),
      'C8 真落库：类型进了 category 这一列，正文里没有「类型：」那一行（这条自己把这行删干净）',
      `→ 等到结果 ${landed}；库里 category=${JSON.stringify(sent?.category)}，正文开头 ${JSON.stringify(String(sent?.content).slice(0, 24))}`)
    // 提交成功后组件会重拉一次「我的反馈」，所以这枚标签要等，不能一次 evalJs 掷硬币。
    const pillLanded = await waitFor(page4, `[...document.querySelectorAll('[data-feedback-row]')].some(r => r.innerText.includes('功能建议'))`, 30_000)
    check(pillLanded,
      'C8·b 「我的反馈」那一列把类型画出来了：前缀删掉之后不画出来，用户就看不见自己选过什么',
      `→ 弹窗说：${JSON.stringify(String(await evalJs(page4, `document.querySelector('[role="dialog"]')?.innerText.slice(0, 120) || '（弹窗已经没了）'`)))}`)
    if (sent) await prisma.platformFeedback.delete({ where: { id: sent.id } }).catch(() => null)
    await evalJs(page4, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await sleep(700)
    check(!(await evalJs(page4, `document.querySelector('[data-feedback-categories]')`)), 'C9 Esc 关得掉弹窗')
    await closePage(page4)

    // 桌面客户端那一页：页面上几个数（版本／大小）必须和更新源逐字对得上，所以判据自己另读一遍
    // latest.yml，不复用应用里那份解析——两边同一份代码错了会一起绿。
    const page5 = await openPage()
    console.log(`  登录（主账号）→ ${await loginInBrowser(page5, ownerEmail)}`)
    await page5.s('Page.navigate', { url: `${BASE}/studio/projects` })
    await waitFor(page5, `document.querySelector('aside a[href="/studio/desktop"]')`, 120_000)
    await evalJs(page5, `document.querySelector('aside a[href="/studio/desktop"]').click()`)
    check(await waitFor(page5, `location.pathname === '/studio/desktop'`, 120_000),
      'D1 点窄栏那枚真的进 /studio/desktop', `→ ${await evalJs(page5, 'location.pathname')}`)
    check(await waitFor(page5, `document.querySelector('aside') && document.body.innerText.includes('桌面客户端')`, 60_000),
      'D2 这页吃的是站内壳子（窄栏还在、标题画出来了），不是掉进一个独立落地页')
    const feed = await fetch('https://dl.vidx.cn/desktop/latest.yml', { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : '')).catch(() => '')
    const wantVersion = feed.match(/^version:\s*([\d.]+)\s*$/m)?.[1] ?? null
    const wantBytes = feed.match(/^\s+size:\s*(\d+)\s*$/m)?.[1] ?? null
    const pageText = String(await evalJs(page5, `document.body.innerText`))
    const wantMb = wantBytes ? (Number(wantBytes) / 1024 / 1024).toFixed(1) : null
    if (wantVersion) {
      check(pageText.includes(`版本 ${wantVersion}`) && (!wantMb || pageText.includes(wantMb)),
        'D3 页面上的版本号与安装包大小和更新源逐字对得上（源是好的，页面就不许装死，也不许留一个旧号）',
        `→ 源里 ${wantVersion}${wantMb ? ` / ${wantMb} MB` : ''}；页面开头 ${JSON.stringify(pageText.slice(0, 150))}`)
    } else {
      check(/版本 \d/.test(pageText) || /暂时读不到客户端版本信息/.test(pageText),
        'D3 判据自己也没读到源（网络/CDN 问题），这一条只验页面二选一：要么有版本号、要么那句实话，不许空白',
        `→ 源读回来 ${feed.length} 字节；页面 ${JSON.stringify(pageText.slice(0, 150))}`)
    }
    // 「只发 Windows」这句在 10-19 那版没了：这条事实改由「选择平台」那三行承担（macOS 行灰掉＋
    // 「暂无发布计划」），归 D4·b 管。这里不再钉那句字面量，否则就是重复覆盖还挡重构。
    check(/下载 Windows 客户端/.test(pageText) && /没有代码签名/.test(pageText) && /SmartScreen/.test(pageText),
      'D4 主按钮那句、以及「安装包没有代码签名 → SmartScreen 会拦」这句实话都在——藏着的那句会让用户以为中了毒',
      `→ 页面 ${JSON.stringify(pageText.slice(0, 120))}`)
    check(['Windows', 'macOS', '网页版'].every((name) => pageText.includes(name)) && /暂无发布计划/.test(pageText),
      'D4·b 「选择平台」那三行都画出来了，且 macOS 行是灰的、写着「暂无发布计划」（不是留一行空白让人以为坏了）')
    check(await evalJs(page5, `document.querySelector('a[href="/dl"]')?.textContent?.includes('下载 Windows 客户端') === true`),
      'D5 直下入口是页面里那颗按钮指 /dl（页面本身不自动跳转，也不写死带版本号的直链）')
    const railColors = String(await evalJs(page5, `(() => {
      const on = document.querySelector('aside a[href="/studio/desktop"]')
      const off = document.querySelector('aside a[href="/studio/team"]')
      if (!on || !off) return '{"on":null,"off":null}'
      return JSON.stringify({ on: getComputedStyle(on).color, off: getComputedStyle(off).color })
    })()`))
    const cc = JSON.parse(railColors)
    check(Boolean(cc.on) && Boolean(cc.off) && cc.on !== cc.off,
      'D6 进了这页，窄栏那枚的选中态换的是字色（和这一列其他图标同一套语言，不铺底色块）', `→ ${railColors}`)
    await shot(page5, 'f-客户端页')
    // 他是深色用户，而「一个页面两颜色」这种问题只有两个主题都拍一张才看得见（10-19 那条深色展示带
    // 就是这么露馅的）。判据不能只量根容器：第一版探到的是外壳那层 bg-background，量错了对象。
    // 现在按内容块逐块往上找「垫在它底下的那一层颜色」，六块必须全是站内栏面 bg-popover。
    const surfaces = String(await evalJs(page5, `(() => {
      const probe = document.createElement('div')
      probe.className = 'bg-popover'
      document.body.appendChild(probe)
      const popover = getComputedStyle(probe).backgroundColor
      probe.remove()
      const main = document.querySelector('main')
      const behind = (el) => {
        for (let n = el; n && n !== main.parentElement; n = n.parentElement) {
          const c = getComputedStyle(n).backgroundColor
          if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c
        }
        return 'none'
      }
      const findByText = (sel, want) => [...document.querySelectorAll(sel)]
        .find((el) => (el.textContent || '').includes(want))
      const anchors = {
        标题: document.querySelector('main h1'),
        说明句: findByText('main p', '和浏览器里打开的是同一个站点'),
        平台行: findByText('main h2', '选择平台'),
        截图: document.querySelector('main figure img'),
        装完之后: findByText('main h2', '装完之后'),
        校验和: findByText('main p', 'SHA-512'),
      }
      // 主按钮不在这份名单里：它是栏面上的一枚控件（bg-primary 蓝），不是页面垫着的那一层——
      // 上一版把它算进来，量出来 rgb(0,123,255) 判成「第二条色带」，那是判据把控件当版面。
      const got = {}
      for (const [k, el] of Object.entries(anchors)) got[k] = el ? behind(el) : null
      return JSON.stringify({ popover, got, rootDiv: main && main.firstElementChild
        ? main.firstElementChild.tagName + '.' + [...main.firstElementChild.classList].join('.') : null })
    })()`))
    const sf = JSON.parse(surfaces)
    const offSurface = Object.entries(sf.got).filter(([, v]) => v !== sf.popover)
    check(Boolean(sf.popover) && Object.values(sf.got).every(Boolean) && offSurface.length === 0,
      'D7 整页只有一层栏面：六块内容（标题／说明句／平台行／截图／装完之后／校验和）垫着的底色全是 bg-popover，不再横插一条别的底色带',
      `→ ${offSurface.length ? `不在栏面上的：${JSON.stringify(Object.fromEntries(offSurface))}` : '六块同一层'} ｜ 整页 ${surfaces.slice(0, 220)}`)
    await evalJs(page5, `localStorage.setItem('theme', 'dark'); true`)
    await page5.s('Page.navigate', { url: `${BASE}/studio/desktop` })
    await waitFor(page5, `document.body.innerText.includes('逐帧审阅桌面客户端')`, 60_000)
    await shot(page5, 'g-客户端页-深色')

    // ── H 组：窄栏「?」＝帮助面板（帮助文档 + 联系客服二维码）────────────────
    const HELP = `document.querySelector('aside button[aria-label="帮助"]')`
    const HELP_PANEL = `document.querySelector('[data-rail-panel="help"]')`
    const urlBefore = String(await evalJs(page5, 'location.href'))
    check(await waitFor(page5, HELP, 20_000), 'H1 窄栏底部那枚「?」是按钮（以前是外链，点了把人带走）')
    await evalJs(page5, `${HELP}.click(); true`)
    check(await waitFor(page5, HELP_PANEL, 20_000), 'H2 点它开的是栏面，不是新开一个网页')
    check(String(await evalJs(page5, 'location.href')) === urlBefore,
      'H2·b 打开面板页面没跳走（旧实现直接跳飞书 wiki）',
      `→ ${urlBefore} → ${await evalJs(page5, 'location.href')}`)

    const helpGeo = String(await evalJs(page5, `(() => {
      const p = ${HELP_PANEL}
      if (!p) return 'null'
      const b = p.getBoundingClientRect()
      return JSON.stringify({ left: b.left, top: b.top, width: b.width, height: b.height, vh: innerHeight })
    })()`))
    const hg = JSON.parse(helpGeo) as { left: number; top: number; width: number; height: number; vh: number } | null
    check(Boolean(hg) && Math.abs((hg as any).width - 288) < 1.5 && (hg as any).top === 0
      && Math.abs((hg as any).height - (hg as any).vh) < 1.5
      && [52.5, 56].some((x) => Math.abs((hg as any).left - x) < 0.75),
      'H3 面板贴着窄栏、288px 整高（和通知面板同一条边，不压在窄栏上）', `→ ${helpGeo}`)

    // 图片是面板打开后才开始下载的：上一版在 DOM 刚一出现就量 naturalWidth，读到 0 是抢跑，
    // 不是裂图（同一时刻的截图里二维码画得好好的）。这里等它真的解码完。
    await waitFor(page5, `(() => {
      const img = ${HELP_PANEL}?.querySelector('[data-rail-help-support] img')
      return !!img && img.complete && img.naturalWidth > 0
    })()`, 20_000)
    const helpFacts = String(await evalJs(page5, `(() => {
      const p = ${HELP_PANEL}
      if (!p) return 'null'
      const doc = p.querySelector('[data-rail-help-doc]')
      const support = p.querySelector('[data-rail-help-support]')
      const img = support ? support.querySelector('img') : null
      return JSON.stringify({
        title: (p.querySelector('p')?.textContent || '').trim(),
        docText: doc ? (doc.textContent || '').trim() : null,
        docHref: doc ? doc.getAttribute('href') : null,
        docTarget: doc ? doc.getAttribute('target') : null,
        docRel: doc ? doc.getAttribute('rel') : null,
        supportText: support ? (support.textContent || '').trim() : null,
        qrSrc: img ? img.getAttribute('src') : null,
        qrNatural: img ? img.naturalWidth : 0,
      })
    })()`))
    const hf = JSON.parse(helpFacts) as Record<string, any> | null
    check(Boolean(hf) && hf!.title === '帮助' && /帮助文档/.test(hf!.docText || '') && /联系客服/.test(hf!.supportText || ''),
      'H4 面板里就两块：帮助文档、联系客服（标题写「帮助」，不再是一枚直接跳走的图标）',
      `→ ${JSON.stringify({ title: hf?.title, docText: hf?.docText?.slice(0, 40), supportText: hf?.supportText?.slice(0, 40) })}`)
    check(Boolean(hf) && /^https:\/\/scnqe74t5owc\.feishu\.cn\/wiki\//.test(hf!.docHref || '')
      && hf!.docTarget === '_blank' && /noopener/.test(hf!.docRel || ''),
      'H5 帮助文档那行仍指向原来那份飞书 wiki，新标签打开且带 noopener',
      `→ ${JSON.stringify({ href: hf?.docHref, target: hf?.docTarget, rel: hf?.docRel })}`)
    check(Boolean(hf) && hf!.qrSrc === '/support/wechat-support.jpg' && Number(hf!.qrNatural) > 0,
      'H6 客服二维码真的加载出来了（文件在 public/support 下，不是一枚裂图）',
      `→ ${JSON.stringify({ src: hf?.qrSrc, naturalWidth: hf?.qrNatural })}`)
    await shot(page5, 'h-帮助面板')

    await page5.s('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await page5.s('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await sleep(250)
    check(String(await evalJs(page5, `!${HELP_PANEL} && document.activeElement === ${HELP}`)) === 'true',
      'H7 Esc 关得掉，且焦点交回那枚「?」')

    await evalJs(page5, `${HELP}.click(); true`)
    await waitFor(page5, HELP_PANEL, 20_000)
    await evalJs(page5, `document.querySelector('main')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); true`)
    await sleep(250)
    check(String(await evalJs(page5, `!${HELP_PANEL}`)) === 'true', 'H8 点面板外面关得掉（和通知面板同一套）')

    // ── I 组：头像菜单（账号卡 + 两行正经菜单）────────────────────────────
    const AVATAR_BTN = `document.querySelector('aside button[aria-haspopup="menu"]')`
    const USER_MENU = `document.querySelector('aside [role="menu"]')`
    check(await waitFor(page5, AVATAR_BTN, 20_000), 'I1 窄栏底部那枚头像按钮在，且声明了 aria-haspopup=menu')
    await evalJs(page5, `${AVATAR_BTN}.click(); true`)
    check(await waitFor(page5, USER_MENU, 20_000), 'I2 点头像开菜单')
    check(String(await evalJs(page5, `${AVATAR_BTN}.getAttribute('aria-expanded')`)) === 'true',
      'I2·b 打开后 aria-expanded 跟着变 true（读屏知道它开没开）')

    const menuFacts = String(await evalJs(page5, `(() => {
      const m = ${USER_MENU}
      if (!m) return 'null'
      const header = m.firstElementChild
      const chip = header ? header.firstElementChild : null
      const rows = [...m.querySelectorAll('[role="menuitem"]')]
      const divider = m.querySelector('.border-t')
      const mb = m.getBoundingClientRect()
      return JSON.stringify({
        width: mb.width,
        left: mb.left,
        inside: mb.left >= 0 && mb.right <= innerWidth && mb.top >= 0 && mb.bottom <= innerHeight,
        headerText: header ? (header.textContent || '').trim() : null,
        headerBorder: header ? getComputedStyle(header).borderBottomWidth : null,
        chip: chip ? { w: chip.getBoundingClientRect().width, h: chip.getBoundingClientRect().height } : null,
        rows: rows.map((r) => ({
          text: (r.textContent || '').trim(),
          href: r.getAttribute('href'),
          h: r.getBoundingClientRect().height,
          hasIcon: !!r.querySelector('svg'),
        })),
        divider: divider ? getComputedStyle(divider).borderTopWidth : null,
        // 别按 16px 根字号算：这套壳的根字号是 15px（w-60 落在 225），h-9 还被紧凑档压到 31.875。
        // 所以量「和同档控件是不是一样」——挂一枚同类的探针比写死数字稳。
        stepWidth: (() => {
          const probe = document.createElement('div')
          probe.className = 'w-60'
          document.body.appendChild(probe)
          const w = probe.getBoundingClientRect().width
          probe.remove()
          return w
        })(),
        stepRow: (() => {
          const probe = document.createElement('div')
          probe.className = 'h-9'
          document.body.appendChild(probe)
          const h = probe.getBoundingClientRect().height
          probe.remove()
          return h
        })(),
      })
    })()`))
    const mf = JSON.parse(menuFacts) as Record<string, any> | null
    check(Boolean(mf) && Math.abs(mf!.width - mf!.stepWidth) < 0.6 && mf!.width > 210 && mf!.inside,
      'I3 菜单宽度就是 w-60 那一档（比原来的 w-56 宽 15px），且完整落在视口里',
      `→ ${JSON.stringify({ width: mf?.width, w60: mf?.stepWidth, left: mf?.left, inside: mf?.inside })}`)
    check(Boolean(mf) && /面板主账号/.test(mf!.headerText || '') && /创建人/.test(mf!.headerText || '')
      && mf!.chip && Math.abs(mf!.chip.w - 36) < 0.6 && Math.abs(mf!.chip.h - 36) < 0.6 && mf!.headerBorder === '1px',
      'I4 顶部是一张账号卡：36px 头像 + 名字 + 角色，下面一条分隔线（不再只有两行裸字）',
      `→ ${JSON.stringify({ header: mf?.headerText, chip: mf?.chip, border: mf?.headerBorder })}`)
    check(Boolean(mf) && mf!.rows.length === 2
      && mf!.rows[0].href === '/profile' && /个人中心/.test(mf!.rows[0].text) && mf!.rows[0].hasIcon
      && /退出登录/.test(mf!.rows[1].text) && mf!.rows[1].hasIcon
      && mf!.rows.every((r: any) => Math.abs(r.h - mf!.stepRow) < 0.6) && mf!.stepRow > 30,
      'I5 两行都吃 h-9 那一档（和全站控件同一步）、各有图标；「个人中心」仍指 /profile',
      `→ ${JSON.stringify(mf?.rows)}`)
    check(Boolean(mf) && mf!.divider === '1px',
      'I6 退出登录单独隔开（和上面一行之间有一条 1px 细线）', `→ ${JSON.stringify({ divider: mf?.divider })}`)
    await shot(page5, 'i-头像菜单')

    await evalJs(page5, `${AVATAR_BTN}.click(); true`)
    await sleep(250)
    check(String(await evalJs(page5, `!${USER_MENU}`)) === 'true', 'I7 再点一次头像关得掉（开关正常）')

    await closePage(page5)
  }

  console.log(`\n合计 ${failures.length === 0 ? '全 PASS' : failures.length + ' FAIL'}`)
  if (failures.length) failures.forEach(x => console.log('  ✗ ' + x))
} finally {
  chrome?.kill()
  rmSync(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 })
  if (projectIds.length) {
    await prisma.comment.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => null)
    await prisma.video.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => null)
    await prisma.shareLink.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => null)
  }
  await prisma.platformAnnouncement.deleteMany({ where: { userId: { in: Object.values(ids) } } }).catch(() => null)
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } }).catch(() => null)
  await prisma.teamMember.deleteMany({ where: { teamId: { in: teamIds } } }).catch(() => null)
  if ((prisma as any).teamQuota) await (prisma as any).teamQuota.deleteMany({ where: { teamId: { in: teamIds } } }).catch(() => null)
  await prisma.team.deleteMany({ where: { id: { in: teamIds } } }).catch(() => null)
  await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } }).catch(() => null)
  await prisma.$disconnect()
}

process.exit(failures.length ? 1 : 0)
