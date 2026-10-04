import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { rmSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 他 10-03 点单「红色方框的删掉」——设置页四刀：
 *  ① 客户分享页面里的「使用预览进行批准的播放」一行
 *  ② 客户分享页面里的「评论时间显示」一块（标签＋下拉＋说明）
 *  ③ 整个「视频处理」节（跳过转码／预览分辨率／应用预览 LUT）
 *  ④ 整个「访问安全」节（验证方式／访客模式＋两枚子开关／客户页面密码）
 * 他一个字没圈的两行（允许客户审核、显示新手引导）必须原地不动。
 *
 * 判据分两面：
 *  A 组 界面——导航正好三项、两节的 label 集合逐字等于点单后剩下的那些行、
 *    保存链路（改名→重新处理窗→「无需重新处理即可保存」→库里真变了）还跑得通、
 *    PATCH 请求体里这十列一个都不许出现、保存前后库里十列逐字节没动、
 *    /api/share/[slug] 照旧吃 authMode 这一列（删的是入口，不是服务端那扇门）。
 *  B 组 源码与文案——设置页里十个字段名 0 命中；孤儿 key 按 git HEAD 那版用到的 key
 *    全集机械判定（引用 0 ⇒ 四语言里必须不存在；引用≥1 ⇒ 四语言里必须都在），
 *    不手写清单；schema／分享路由／项目接口一字未动；新建项目那面「访问需要验证」的链还在。
 *
 * 登录只在浏览器里做（会话指纹绑设备头＋UA，Node 侧令牌在浏览器一刷就烧掉整枚会话）。
 * CDP 用 Node 内置 WebSocket，零依赖。页面里跑的代码零反斜杠。
 * 口令与密钥只从 .env 读进 process.env，绝不落进任何文件与日志。
 */
const BASE = process.env.PRUNE_CHECK_BASE || 'http://localhost:3000'
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SETTINGS_FILE = 'src/app/studio/projects/[id]/settings/page.tsx'
const PANEL_FILE = 'src/components/ProjectSettingsPanel.tsx'

// 加密钥匙必须在 import encryption 之前进 process.env，否则它会退回开发用的兜底密钥，
// 解不出接口那头的密文。
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const i = line.indexOf('=')
  if (i > 0 && !line.startsWith('#')) {
    const k = line.slice(0, i).trim()
    if (k && !process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, '')
  }
}
const { PrismaClient } = await import('@prisma/client')
const { hashPassword, encrypt } = await import('../src/lib/encryption')
const prisma = new PrismaClient()

const stamp = Date.now()
const failures: string[] = []
const teamSlug = `prune-${stamp}`
const pw = `prune-${stamp}`
const cdpPort = 9400 + (stamp % 500)
const userDataDir = join(tmpdir(), `prune-${stamp}`)
const OWNER = { email: `prune-owner-${stamp}@example.invalid`, name: 'Prune Owner' }
let chrome: ChildProcess | undefined

// 这十列就是四刀砍掉的十列：界面不许再出现，请求体不许再带，库里一个字不许被动。
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

// ── CDP（与身份块那份判据同一套管路）────────────────────────────────────
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
async function shot(page: Page, name: string) {
  const dir = process.env.SHOT_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  const { data } = await page.s('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(dir, `${name}.png`), Buffer.from(data, 'base64'))
  console.log(`截图 → ${dir}/${name}.png`)
}

async function loginInBrowser(page: Page, email: string) {
  const deviceId = `prune-${stamp}`
  await page.s('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.setItem('vitransfer_device_id', ${JSON.stringify(deviceId)})`,
  })
  // 请求体探针：把页面自己发出的 PATCH/POST 原样记下来。A6 断的是「真发出去的字节里
  // 没有那十列」，不是我读源码觉得没有。
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

/** 导航那几项（桌面态那列 sticky <nav> 里的按钮；全局窄栏在 #main-content 外面，不参与）。 */
async function navLabels(page: Page) {
  return JSON.parse(String(await evalJs(page, `JSON.stringify(
    [...document.querySelectorAll('#main-content nav.sticky button')].filter(b => b.offsetParent !== null).map(b => b.innerText.trim())
  )`)))
}
/** 当前那节画出来的 <label> 文案集合——删没删干净、有没有删过头，都看这一串。 */
async function visibleLabels(page: Page) {
  return JSON.parse(String(await evalJs(page, `JSON.stringify(
    [...document.querySelectorAll('#main-content label')].filter(l => l.offsetParent !== null).map(l => l.innerText.trim()).filter(s => s.length > 0)
  )`)))
}
async function activateSection(page: Page, label: string) {
  const r = await click(page, `[...document.querySelectorAll('#main-content nav.sticky button')].filter(b => b.offsetParent !== null && b.innerText.trim() === ${JSON.stringify(label)})[0]`)
  await sleep(500)
  return r
}
/** 页面正文（只取 #main-content：窄栏那排搜索/通知的文案不许混进来当证人）。 */
async function pageText(page: Page) {
  return String(await evalJs(page, `(() => { const m = document.getElementById('main-content'); return (m || document.body).innerText })()`))
}
async function patchBodies(page: Page) {
  return JSON.parse(String(await evalJs(page, `JSON.stringify((window.__reqs || []).filter(x => x.m === 'PATCH' && x.u.indexOf('/api/projects/') > -1))`)))
}

/**
 * 孤儿 key 机械判定：基准＝砍那四刀之前那一版设置页（`09c4bd8^`：1067 行的表单原样、108 个 key），
 * 一条一条数引用，不手写清单。
 * 基准不能取 HEAD：那次砍完紧接着就提交了，HEAD 那版只剩 13 行的壳、一个 key 都不引用（实测 0 个），
 * 「孤儿」于是恒为 0——B2 那条 `shouldGone.length > 0` 就成了永远赢不了的空断言。
 */
const BASELINE_REF = '09c4bd8^'
function keysFromBaseline(): { ns: string, key: string }[] {
  const src = execFileSync('git', ['show', `${BASELINE_REF}:${SETTINGS_FILE}`], { encoding: 'utf8' })
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
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) { if (name !== 'locales' && name !== 'node_modules') sourceFiles(p, acc) }
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) acc.push(p)
  }
  return acc
}
function referenceCount(key: string, files: string[]) {
  const re = new RegExp(`\\b(?:t|tc)\\(\\s*'${key}'\\s*[,)]`)
  let n = 0
  for (const f of files) if (re.test(readFileSync(f, 'utf8'))) n++
  return n
}
function localeHas(ns: string, key: string) {
  const hits: string[] = []
  for (const l of ['zh', 'en', 'de', 'nl']) {
    const v = JSON.parse(readFileSync(`src/locales/${l}.json`, 'utf8'))?.[ns]?.[key]
    if (v !== undefined) hits.push(l)
  }
  return hits
}

let project = undefined as any

try {
  // fixture：十列全预置成「非默认值」——默认值下「没被动过」和「被重置成默认」看不出差别。
  const owner = await prisma.user.create({ data: { email: OWNER.email, name: OWNER.name, password: await hashPassword(pw), phone: `139${String(stamp).slice(-8)}` } })
  const team = await prisma.team.create({
    data: { name: teamSlug, slug: teamSlug, shareKey: teamSlug, createdById: owner.id, subscriptionPlan: 'BETA', members: { create: [{ userId: owner.id, role: 'OWNER', status: 'ACTIVE' }] } },
  })
  project = await prisma.project.create({
    data: {
      teamId: team.id, createdById: owner.id, projectCode: `PR${String(stamp).slice(-6)}`,
      title: `设置页删减-${stamp}`, slug: `prune-${stamp}`, shareSlug: `prune-s-${stamp}`,
      enableRevisions: false, hideFeedback: false,
      timestampDisplay: 'AUTO', previewResolution: '1080p', skipTranscoding: false, applyPreviewLut: false,
      usePreviewForApprovedPlayback: true, authMode: 'PASSWORD', sharePassword: encrypt('1234'),
      guestMode: true, guestLatestOnly: false, guestShowPhotos: true,
    },
  })

  const COLS = ['timestampDisplay', 'previewResolution', 'skipTranscoding', 'applyPreviewLut',
    'usePreviewForApprovedPlayback', 'sharePassword', 'authMode', 'guestMode', 'guestLatestOnly', 'guestShowPhotos'] as const
  const snapshot = async () => {
    const row = await prisma.project.findUnique({ where: { id: project.id }, select: { ...Object.fromEntries(COLS.map(c => [c, true])) } as any })
    return JSON.stringify(row)
  }
  const before = await snapshot()

  // A8 先跑：删掉界面前后这一发都必须是同一个结果，才能证明「删的是入口、门还在」。
  const shareHit = await fetch(`${BASE}/api/share/${project.slug}`, { cache: 'no-store' })
  const shareJson: any = await shareHit.json().catch(() => null)
  check(shareHit.status === 401 && shareJson?.requiresPassword === true && shareJson?.authMode === 'PASSWORD',
    'A8 未登录直取 /api/share/[slug] 仍是 401＋requiresPassword（口令这列服务端照旧在守门）',
    `→ ${shareHit.status} ${JSON.stringify(shareJson).slice(0, 120)}`)

  const warm = async (path: string) => {
    try { return String((await fetch(`${BASE}${path}`, { cache: 'no-store' })).status) } catch (e) { return `预热失败 ${(e as Error).message}` }
  }
  for (const p of ['/login', `/studio/projects/${project.id}`, `/studio/projects/${project.id}/settings`, '/studio/projects/new', '/studio/team/settings']) {
    console.log(`预热 ${p} → ${await warm(p)}`)
  }

  chrome = await connectChrome()
  const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then(r => r.json())
  await attachSocket(webSocketDebuggerUrl)
  const page = await openPage()
  check(/^200 session$/.test(await loginInBrowser(page, OWNER.email)), 'P0 浏览器内登录')

  // ── C1 内容还画得出来 ────────────────────────────────────────────────────
  // 10-04 搬家后身份块菜单不再换路由（改成项目页里浮一层），而这条判据的对象是「内容」不是「门牌」，
  // 所以直接走 /settings 直链取页内版；浮层那条路归 check-project-settings-panel.mts 的 A1/A9 管。
  await run(page, `/studio/projects/${project.id}/settings`)
  check(await waitFor(page, `document.querySelectorAll('#main-content nav.sticky button').length > 0`, 150_000),
    'C1 设置内容仍画得出来（四刀砍的是内容，不是门牌）', `→ ${String(await evalJs(page, 'location.pathname'))}`)
  await sleep(1_000)

  // ── A 组：界面 ─────────────────────────────────────────────────────────
  const nav = await navLabels(page)
  const EXPECT_NAV = [zh('projectDetails'), zh('clientInfoNotifications'), zh('clientSharePage')]
  check(JSON.stringify(nav) === JSON.stringify(EXPECT_NAV),
    'A1 导航正好三项（视频处理、访问安全两节整节没了）', `→ 实画 ${JSON.stringify(nav)}`)

  const navDetail = await visibleLabels(page)
  const EXPECT_DETAILS = [zh('titleLabel'), zh('descriptionLabel'), zh('enableRevisionTracking'), zh('dueDateLabel')]
  check(JSON.stringify(navDetail) === JSON.stringify(EXPECT_DETAILS),
    'A2 「项目详情」一节的 label 一字没多一字没少（他圈的四刀都不在这节，越界就是删过头）', `→ 实画 ${JSON.stringify(navDetail)}`)
  await shot(page, 'pruned-settings-1-project-details')

  console.log(`  切到「${zh('clientInfoNotifications')}」→ ${await activateSection(page, zh('clientInfoNotifications'))}`)
  const infoText = await pageText(page)
  check(infoText.includes(zh('companyBrandName')), 'A3 「客户信息与通知」这节还在正常画控件（别把第三节删成空壳）', `→ 前 80 字 ${JSON.stringify(infoText.slice(0, 80))}`)
  await shot(page, 'pruned-settings-2-client-info')

  console.log(`  切到「${zh('clientSharePage')}」→ ${await activateSection(page, zh('clientSharePage'))}`)
  const shareLabels = await visibleLabels(page)
  const EXPECT_SHARE = [zh('allowClientApproval'), zh('allowAssetDownloads'), zh('allowPhotoDownloads'),
    zh('allowClientFileAttachments'), zh('allowReverseShare'), zh('showClientTutorial'),
    zh('hideFeedbackSection'), zh('restrictCommentsLatest')]
  check(JSON.stringify(shareLabels) === JSON.stringify(EXPECT_SHARE),
    'A4 分享那节剩下的八行正好是这八行：①「使用预览进行批准的播放」②「评论时间显示」两刀落地，他没圈的两行（允许客户审核／显示新手引导）原地不动',
    `→ 实画 ${JSON.stringify(shareLabels)}`)

  const shareText = await pageText(page)
  const banned = ['视频处理', '访问安全', '跳过转码', '预览分辨率', '应用预览 LUT', '验证方式', '访客模式', '客户页面密码', '使用预览进行批准的播放', '评论时间显示', '仅展示最新版本', '向客人展示相册']
  const leaked = banned.filter(s => shareText.includes(s))
  check(leaked.length === 0, 'A5 整个可见页面上这十二串一句都不剩（含节名、行名与访客子开关）', `→ 还剩 ${JSON.stringify(leaked)}`)
  await shot(page, 'pruned-settings-3-client-share')

  // ── A6/A7 保存链路：改名走「重新处理」窗，请求体不带那十列，库里十列一字不动 ──
  console.log(`  切回「${zh('projectDetails')}」→ ${await activateSection(page, zh('projectDetails'))}`)
  const NEW_TITLE = `设置页删减改名-${stamp}`
  check(await evalJs(page, `(() => {
    const el = document.getElementById('title')
    if (!el) return false
    const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
    d.set.call(el, ${JSON.stringify(NEW_TITLE)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return el.value === ${JSON.stringify(NEW_TITLE)}
  })()`) === true, 'A6a 名称输入框改得动（React 受控值真的收到了）')

  console.log(`  点「${zhc('saveChanges')}」→ ${await click(page, `[...document.querySelectorAll('#main-content button')].filter(b => b.offsetParent !== null && b.innerText.trim() === ${JSON.stringify(zhc('saveChanges'))})[0]`)}`)
  const DLG = `[...document.querySelectorAll('[role="dialog"]')].filter(d => d.getBoundingClientRect().width > 0)`
  check(await waitFor(page, `${DLG}.length`, 30_000), 'A6b 改名照旧弹「重新处理」窗（标题这条触发留着，窗不该跟着四刀一起消失）')
  console.log(`  点「无需重新处理即可保存」→ ${await click(page, `${DLG}[0] ? [...${DLG}[0].querySelectorAll('button')].find(b => b.textContent.trim() === '无需重新处理即可保存') : null`)}`)
  // PATCH 是异步的：不等它落地就往下翻 authMode，会被这发迟到的写盖回去（10-03 就是这样假 FAIL 的）。
  const savedAt = Date.now()
  let saved: any = null
  while (Date.now() - savedAt < 40_000) {
    saved = await prisma.project.findUnique({ where: { id: project.id }, select: { title: true } })
    if (saved?.title === NEW_TITLE) break
    await sleep(500)
  }
  check(saved?.title === NEW_TITLE, 'A6 保存链路整条还跑得通：界面改名 → 确认窗 → 库里标题真变了', `→ 库里 ${JSON.stringify(saved?.title)}`)
  await sleep(2_000)

  const patches = await patchBodies(page)
  const patchBody = patches.length ? JSON.parse(patches[patches.length - 1].b) : null
  const carried = patchBody ? PRUNED.filter(k => Object.prototype.hasOwnProperty.call(patchBody, k)) : PRUNED
  check(patches.length === 1 && carried.length === 0,
    'A7 真发出去的 PATCH 请求体里，这十列一个都不许出现（界面删了、载荷也得跟着瘦）',
    `→ ${patches.length} 发 PATCH，仍带 ${JSON.stringify(carried)}`)

  const after = await snapshot()
  check(before === after, 'A7b 保存前后库里这十列逐字节没动（删的是入口，不许顺手把这十列重置成默认值）',
    `→ ${before === after ? '相同' : `前 ${before.slice(0, 200)} / 后 ${after.slice(0, 200)}`}`)

  // ── A8b 服务端那扇门还吃这一列：Prisma 翻 authMode，界面一个字没参与 ──────
  await prisma.project.update({ where: { id: project.id }, data: { authMode: 'NONE' } })
  const open = await fetch(`${BASE}/api/share/${project.slug}`, { cache: 'no-store' })
  const openJson: any = await open.json().catch(() => null)
  check(openJson?.requiresPassword === false && openJson?.authMode === 'NONE' && openJson?.guestMode === true,
    'A8b 把这列翻成 NONE，同一发直取立刻不再要密码（证明服务端读的是这列本身，不是写死的；访客模式仍独立把关）',
    `→ ${open.status} ${JSON.stringify(openJson).slice(0, 140)}`)
  await prisma.project.update({ where: { id: project.id }, data: { authMode: 'PASSWORD' } })

  // ── B3 新建项目那面的验证入口还完整（四刀砍不到它，key 也不能被当孤儿删掉）──
  await run(page, '/studio/projects/new')
  check(await waitFor(page, `document.body && document.body.innerText.indexOf(${JSON.stringify(zh('requireAuth'))}) > -1`, 150_000),
    'B3a 新建项目页仍画出「访问需要验证」', '→ 这页是删掉访问安全节后，唯一还能给项目设验证方式的地方')
  console.log(`  勾上「${zh('requireAuth')}」→ ${await click(page, 'document.getElementById(' + JSON.stringify('passwordProtected') + ')')}`)
  await sleep(700)
  const newText = await pageText(page)
  check([zh('passwordOnly'), zh('passwordDescriptionLong')].every(s => newText.includes(s)),
    'B3 新建项目的口令分支仍在（「仅密码」＋那句长说明）——那两条文案不是孤儿，删了就把这页挖空了',
    `→ 缺 ${JSON.stringify([zh('passwordOnly'), zh('passwordDescriptionLong')].filter(s => !newText.includes(s)))}`)

  await closePage(page)

  // ── B 组：源码 / 文案 / 别动的地方 ──────────────────────────────────────
  // 10-04 内容搬进 ProjectSettingsPanel 后，只读路由那层薄壳会放走「砍掉的字段跟着组件回来」，
  // 所以两份源码都得查：壳＝门牌，组件＝真正装着表单的那一份。
  const settingsSrc = [SETTINGS_FILE, PANEL_FILE].map(f => readFileSync(f, 'utf8')).join('\n')
  const stillNamed = PRUNED.filter(k => new RegExp(`\\b${k}\\b`).test(settingsSrc))
  check(stillNamed.length === 0, 'B1 设置页与设置组件源码里这十个字段名 0 命中（state、载荷、接口声明、JSX 一起清干净）', `→ 还剩 ${JSON.stringify(stillNamed)}`)
  check(!/\b(Video|Shield)\b/.test(settingsSrc), 'B1b 那两节的图标 import 也没搭着留在文件里', `→ ${JSON.stringify(['Video', 'Shield'].filter(n => new RegExp(`\\b${n}\\b`).test(settingsSrc)))}`)

  const files = sourceFiles('src')
  const headKeys = keysFromBaseline()
  const shouldGone = headKeys.filter(k => referenceCount(k.key, files) === 0)
  const shouldStay = headKeys.filter(k => referenceCount(k.key, files) > 0)
  const notCleaned = shouldGone.filter(k => localeHas(k.ns, k.key).length > 0)
  check(shouldGone.length > 0 && notCleaned.length === 0,
    `B2 孤儿 key 清零（基准＝砍四刀前那版 ${BASELINE_REF} 用到的 ${headKeys.length} 个 key，机械数引用得 ${shouldGone.length} 个孤儿）`,
    notCleaned.length ? `→ 四语言里还在：${notCleaned.slice(0, 12).map(k => `${k.ns}.${k.key}`).join(' ')}` : '→ 全部不在')
  const wronglyGone = shouldStay.filter(k => localeHas(k.ns, k.key).length < 4)
  check(wronglyGone.length === 0,
    `B2b 还有 ${shouldStay.length} 个 key 在别处被引用，一个都不许被当孤儿删掉`,
    wronglyGone.length ? `→ 缺语言：${wronglyGone.slice(0, 12).map(k => `${k.ns}.${k.key}(${localeHas(k.ns, k.key).join('') || '全无'})`).join(' ')}` : '→ 四语言齐')

  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  const missingCols = COLS.filter(c => !schema.includes(`  ${c} `))
  check(missingCols.length === 0, 'B4 库里这十列一列没删（这次只砍界面，schema 不动）', `→ 缺 ${JSON.stringify(missingCols)}`)

  const shareRoute = readFileSync('src/app/api/share/[token]/route.ts', 'utf8')
  const accessLib = readFileSync('src/lib/project-access.ts', 'utf8')
  const apiRoute = readFileSync('src/app/api/projects/[id]/route.ts', 'utf8')
  check(shareRoute.includes('resolvedProject.guestMode') && shareRoute.includes('policy.authMode || resolvedProject.authMode')
    && accessLib.includes('authMode') && apiRoute.includes('validatedBody.previewResolution'),
    'B4b 服务端与接口的读取者一字未动（/api/share、project-access、PATCH 都还在读这些列）',
    `→ ${JSON.stringify([shareRoute.includes('resolvedProject.guestMode'), accessLib.includes('authMode'), apiRoute.includes('validatedBody.previewResolution')])}`)

  const dirty = execFileSync('git', ['diff', '--numstat'], { encoding: 'utf8' }).split('\n').filter(Boolean)
    .map((line) => {
      const [added, deleted, file] = line.split('\t')
      return { file, added: Number(added), deleted: Number(deleted) }
    })
  const offLimits = ['src/app/studio/team/settings/page.tsx', 'src/app/studio/projects/new/page.tsx',
    'src/app/api/share/[token]/route.ts',
    'src/components/SharePasswordRequirements.tsx', 'src/lib/password-utils.ts']
  const hitchhikers = offLimits.filter(f => dirty.some(d => d.file === f))
  check(hitchhikers.length === 0, 'B5 点名的改动就那一块：这五份文件零 diff', hitchhikers.length ? `→ 被顺手改了 ${hitchhikers.join(' ')}` : '')
  // schema 也从「零 diff」名单里放出来：10-04 他自己点单做了「受限项目」，往上加了一列 restricted（实测 +2/-0）。
  // 这次删减的护栏没丢——砍列一定在 numstat 里留下 deleted>0，那十列一列都不许被顺手带走。
  const schemaDiff = dirty.find(d => d.file === 'prisma/schema.prisma')
  check(!schemaDiff || schemaDiff.deleted === 0,
    'B5c schema 只许多、不许删（这次删减一列都没砍；盘上那 2 行是他 10-04 加的 restricted）',
    schemaDiff ? `→ +${schemaDiff.added} / -${schemaDiff.deleted}` : '→ 本次没碰')
  // project-access 的护栏从「删掉的行必须是 0」换成「对外那九枚判定一个没少」。
  // 行数基线在这天活不过一轮：他加 restricted 的 OR、我修那枚 OR 顶掉 assignmentAccess 的越权
  // （check-project-member-count A9 实测 403 才修的），两次都要留下删除行。
  // 这轮删减真正不许干的是把读取逻辑整个摘掉——导出面少一个名字才是那件事。
  const exportedNames = (src: string) => [...src.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1])
  const beforeExports = exportedNames(execFileSync('git', ['show', 'HEAD:src/lib/project-access.ts'], { encoding: 'utf8' }))
  const afterExports = exportedNames(accessLib)
  const droppedExports = beforeExports.filter(n => !afterExports.includes(n))
  check(droppedExports.length === 0 && afterExports.length >= beforeExports.length,
    'B5b project-access 对外的判定一个没少（这轮删减没摘任何读取逻辑；只许多不许删名字）',
    droppedExports.length ? `→ 少了 ${droppedExports.join(' ')}` : `→ HEAD ${beforeExports.length} 枚，现在 ${afterExports.length} 枚`)
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
    projects: await prisma.project.count({ where: { slug: `prune-${stamp}` } }),
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
console.log('未证清单（这份判据证不到的，转浏览器批次或人工）：英文/德文/荷兰文界面下的标签宽度与换行、被删那两节在旧项目里留下的历史值是否还有别的入口能改、真鼠标在窄屏（移动叠层）下的滚动。')
