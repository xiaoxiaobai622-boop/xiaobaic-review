import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/encryption'
import { getRedis } from '../src/lib/redis'

/**
 * 需求 §3「有效期／禁止-允许下载」的界面级判据：权限只在未登录访客真的看得见、
 * 点得动时才算存在。这里用无头 Chrome 打开根级短链（§1 的 /{shareCode}），四个 case：
 *  A 勾了 download 且有期限的链接 —— 顶栏出有效期、播放条也出、下载钮在、点它必须先
 *    mint quality=original 再打 /api/content/{t}?download=true；
 *  B 只勾 view/comment 的链接 —— 期限照出，下载钮不许出现，且一次 original 都不 mint；
 *  C 无期限无次数上限的链接 —— 不渲染任何免责声明（无限链接不需要）；
 *  D 登录后的「项目信息」—— 那条入口开的是「创建审阅分享」窗、范围整项目（他 10-02 点单）。
 * A–C 访客全程不带登录态；D 在浏览器页内走产品自己的登录（会话指纹绑设备头＋UA，
 * Node 侧登录的令牌在浏览器刷不出会话）。CDP 用 Node 内置 WebSocket，零依赖。
 */
const BASE = process.env.SHARE_CHECK_BASE || 'http://localhost:3000'
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const prisma = new PrismaClient()
const redis = getRedis()
const stamp = Date.now()
const failures: string[] = []
const teamSlug = `visitor-ui-${stamp}`
const ownerEmail = `visitor-ui-${stamp}@example.invalid`
const pw = `visitor-ui-${stamp}`
const cdpPort = 9300 + (stamp % 600)
const userDataDir = join(tmpdir(), `visitor-ui-${stamp}`)
const tokens: string[] = []
let chrome: ChildProcess | undefined

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

async function createLink(projectId: string, adminToken: string, name: string, permissions: string[], extra: Record<string, unknown> = {}) {
  const created = await call('POST', `/api/projects/${projectId}/share-links`, adminToken, {
    name, scopeType: 'PROJECT', authMode: 'NONE', permissions, ...extra,
  })
  const code = created.json?.shareLink?.token as string | undefined
  if (!code) throw new Error(`建链接失败 ${name} → ${created.status} ${JSON.stringify(created.json)}`)
  return code
}

// ── CDP 客户端（单条 browser 级连接，页面级消息带 sessionId）──────────────
let ws: WebSocket | undefined
let msgId = 0
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
const listeners = new Set<(method: string, params: any, eventSessionId?: string) => void>()

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
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${userDataDir}`,
    '--remote-allow-origins=*', '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--disable-translate', '--lang=zh-CN', '--window-size=1440,900',
  ], { stdio: 'ignore' })
  for (let i = 0; i < 60; i++) {
    const ok = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then(r => r.ok).catch(() => false)
    if (ok) return chrome
    await sleep(500)
  }
  chrome.kill()
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
      } else if (msg.method) {
        for (const l of listeners) l(msg.method, msg.params, msg.sessionId)
      }
    }
    ws.onerror = () => reject(new Error('CDP WebSocket 连接失败'))
    ws.onopen = () => resolve()
  })
}

/** 一个 case 的页面：自带请求流水，断言只看真实发出的 URL。每枚页面独占一个浏览器上下文，
 *  否则上一页的访客令牌存储会串到下一页（实测第二枚页面停在「正在加载...」）。 */
async function openPage() {
  const { browserContextId } = await send('Target.createBrowserContext', { disposeOnDetach: true })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const page = {
    browserContextId, targetId, sessionId,
    requests: [] as string[],
    responses: [] as { url: string; status: number }[],
    statuses: new Map<string, number>(),
    logs: [] as string[],
    downloads: [] as string[],
    s: (method: string, params: Record<string, unknown> = {}) => send(method, params, sessionId),
  }
  pages.set(sessionId, page)
  await page.s('Page.enable')
  await page.s('Runtime.enable')
  await page.s('Network.enable')
  return page
}

type Page = Awaited<ReturnType<typeof openPage>>

/** sessionId → 页面；下载事件有时会带不到页面级 sessionId（实测同一枚下载两次分别落在两个桶里），
 *  所以按会话查页面，查不到也不许把事件丢掉。 */
const pages = new Map<string, Page>()
const browserDownloads: string[] = []

const listener = (method: string, params: any, eventSessionId?: string) => {
  const page = pages.get(eventSessionId ?? '')
  if (method === 'Page.downloadWillBegin' && !page) browserDownloads.push(String(params.url ?? params.suggestedFilename ?? ''))
  if (!page) return
  if (method === 'Network.requestWillBeSent') page.requests.push(params.request.url)
  if (method === 'Network.responseReceived') {
    page.responses.push({ url: params.response.url, status: params.response.status })
    page.statuses.set(params.response.url, params.response.status)
  }
  if (method === 'Runtime.consoleAPICalled') {
    page.logs.push(`${params.type}: ${(params.args ?? []).map((a: any) => a.description ?? a.value ?? a.type).join(' ').slice(0, 220)}`)
  }
  if (method === 'Runtime.exceptionThrown') {
    page.logs.push(`未捕获异常: ${params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text}`.slice(0, 260))
  }
  if (method === 'Page.downloadWillBegin') page.downloads.push(String(params.url ?? params.suggestedFilename ?? ''))
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
    await sleep(400)
  }
  return false
}

/** 点完之后要等的是「浏览器真发出了这个请求」，看的是本地流水，不是页面 JS。 */
async function pollUntil<T>(fn: () => T | undefined, timeoutMs: number): Promise<T | undefined> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const value = fn()
    if (value) return value
    await sleep(300)
  }
  return undefined
}

async function run(page: Page, path: string) {
  await page.s('Page.navigate', { url: `${BASE}${path}` })
}

function hasUrl(page: Page, re: RegExp) {
  return page.requests.find(u => re.test(u))
}

/** 上下文连同存储一起丢：留着会让下一页继承上一页的访客令牌。 */
async function closePage(page: Page) {
  pages.delete(page.sessionId)
  await send('Target.closeTarget', { targetId: page.targetId }).catch(() => null)
  await send('Target.disposeBrowserContext', { browserContextId: page.browserContextId }).catch(() => null)
  await sleep(600)
}

try {
  // ── fixtures：一枚已批准的素材 + 三枚链接 ──────────────────────────────
  const owner = await prisma.user.create({
    data: { email: ownerEmail, name: 'visitor-ui', password: await hashPassword(pw), phone: `138${String(stamp).slice(-8)}` },
  })
  const team = await prisma.team.create({
    data: {
      name: teamSlug, slug: teamSlug, shareKey: teamSlug, createdById: owner.id, subscriptionPlan: 'BETA',
      members: { create: { userId: owner.id, role: 'OWNER', status: 'ACTIVE' } },
    },
  })
  const project = await prisma.project.create({
    data: { teamId: team.id, createdById: owner.id, projectCode: `V${stamp}`, title: `visitor-${stamp}`, slug: `vp-${stamp}`, shareSlug: `vs-${stamp}` },
  })
  await prisma.video.create({
    data: {
      projectId: project.id, name: 'reel', version: 1, versionLabel: 'v1',
      originalFileName: 'reel.mp4', originalFileSize: BigInt(1024), originalStoragePath: `tests/${stamp}/reel.mp4`,
      duration: 12, width: 1920, height: 1080, status: 'READY', approved: true,
    },
  })
  const login = await call('POST', '/api/auth/login', '', { email: ownerEmail, password: pw })
  const adminToken = login.json?.tokens?.accessToken as string | undefined
  if (!adminToken) throw new Error(`登录失败 → ${login.status}`)
  tokens.push(adminToken)

  const sevenDays = new Date(Date.now() + 7 * 86_400_000)
  const codeDl = await createLink(project.id, adminToken, '访客下载试验', ['view', 'download'], { expiresAt: sevenDays.toISOString(), maxViews: 50 })
  const codeView = await createLink(project.id, adminToken, '访客只读试验', ['view', 'comment'], { expiresAt: sevenDays.toISOString(), maxViews: 50 })
  const codeFree = await createLink(project.id, adminToken, '无期限试验', ['view', 'download'])

  // dev 服务器可能还没编译过这枚根级路由，登录后那趟页面要打的接口也一样：实测一枚冷路由要
  // 20–35 秒（photo-albums 33.4s），算进浏览器的等待里就会得出「按钮没出现」这种假故障。
  // 失败原因要报出来，别压成 0：这趟就撞上过 dev 因内存吃紧自我重启，那时预热全灭、
  // 浏览器量的又是冷编译，判据的 FAIL 得能被认出来是环境不是产品。
  const warm = async (path: string, headers?: Record<string, string>) => {
    try { return String((await fetch(`${BASE}${path}`, { headers, cache: 'no-store', redirect: 'manual' })).status) }
    catch (e) {
      await sleep(3_000)
      try { return String((await fetch(`${BASE}${path}`, { headers, cache: 'no-store', redirect: 'manual' })).status) }
      catch (retry) { return `预热失败 ${(retry as Error).message}` }
    }
  }
  for (const code of [codeDl, codeView, codeFree]) console.log(`预热 /${code} → ${await warm(`/${code}`)}`)
  for (const p of [`/api/projects/${project.id}`, `/api/share/url?projectId=${project.id}`, '/api/team-center', '/api/announcements', '/api/comments/for-me',
    `/api/projects/${project.id}/photo-albums`, `/api/projects/${project.id}/recycle-bin`, `/api/projects/${project.id}/project-uploads`, `/api/projects/${project.id}/share-links`,
    '/login', `/studio/projects/${project.id}`]) {
    console.log(`预热 ${p} → ${await warm(p, p.startsWith('/api/') ? { authorization: `Bearer ${adminToken}` } : undefined)}`)
  }

  chrome = await connectChrome()
  const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then(r => r.json())
  await attachSocket(webSocketDebuggerUrl)
  listeners.add(listener)

  const gridNote = `[data-tutorial="grid-actions"] p`
  // 无头 Chrome 默认不接管下载，锚点的请求压根不会发出去；不放开这条，U8 测的是浏览器不是产品。
  const downloadDir = join(userDataDir, 'dl')
  mkdirSync(downloadDir, { recursive: true })
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir })

  /** 判据落空时把页面真身打出来，别让人回去猜是没编译还是没渲染。 */
  const snapshot = async (page: Page) => String(await evalJs(page, `JSON.stringify({url: location.href, body: document.body.innerText.slice(0, 180)})`))
  /** 卡住时把这一页的请求流水、返回码、控制台、localStorage 一次打全，别再靠猜。
   *  返回码按每一次落账（同一枚 URL 打两次、一次 500 一次 200 时只留最后一次会骗人）。 */
  const dumpPage = async (page: Page, label: string, code: string) => {
    const ls = await evalJs(page, `JSON.stringify(Object.fromEntries(Object.entries(localStorage).map(([k, v]) => [k, String(v).slice(0, 28)])))`)
    const probe = await evalJs(page, `(async () => { const r = await fetch('/api/share/${code}', { cache: 'no-store' }); return r.status + ' ' + (await r.text()).slice(0, 300) })()`)
    console.log(`── ${label} 取证 ──`)
    console.log(`  localStorage: ${ls}`)
    console.log(`  console: ${JSON.stringify(page.logs.slice(-6))}`)
    console.log(`  现场再打一次 /api/share/${code} → ${probe}`)
    for (const r of page.responses.filter(r => r.url.includes('/api/'))) console.log(`  ${r.status} ${r.url.slice(0, 132)}`)
  }

  // 访客这趟要打的接口（播放令牌、原片令牌、素材内容）在 dev 上都是冷路由，一枚 20–35 秒；
  // 先用一趟不计结果的走查把它们焐热，否则 A 组量到的是 webpack 编译，不是产品。
  const warmDir = join(userDataDir, 'dl-warm')
  mkdirSync(warmDir, { recursive: true })
  const pw0 = await openPage()
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: warmDir, browserContextId: pw0.browserContextId })
  await run(pw0, `/${codeDl}`)
  if (await waitFor(pw0, `document.querySelector('[data-tutorial="video-grid"] button')`, 90_000)) {
    await evalJs(pw0, `(() => { const b = document.querySelector('[data-tutorial="video-grid"] button'); if (b) b.click(); return !!b })()`)
    await waitFor(pw0, `document.querySelector('[data-tutorial="download-btn"]')`, 90_000)
    await evalJs(pw0, `(() => { const b = document.querySelector('[data-tutorial="download-btn"]'); if (b) b.click(); return !!b })()`)
    await sleep(4_000)
  }
  console.log(`访客路径焐热 → 接口 ${pw0.responses.filter(r => r.url.includes('/api/')).length} 发`)
  await closePage(pw0)

  // ── A 可下载 + 有期限 ──────────────────────────────────────────────────
  const pa = await openPage()
  await run(pa, `/${codeDl}`)
  const loadedA = await waitFor(pa, `document.querySelector('${gridNote}')`, 45_000)
  if (!loadedA) await dumpPage(pa, 'A 顶栏期限句没出现', codeDl)
  check(loadedA, 'U1 未登录访客打开根级短链：顶栏画出有效期', loadedA ? '' : `→ ${(await snapshot(pa)).slice(0, 240)}`)
  const noteText = loadedA ? String(await evalJs(pa, `document.querySelector('${gridNote}').textContent`)) : ''
  check(/失效/.test(noteText) && /还能查看 \d+ 次/.test(noteText), 'U2 期限句同时给出「到什么时候」和「还能看几次」（两个限制都要看得见）', `→ 「${noteText}」`)

  await evalJs(pa, `(() => { const b = document.querySelector('[data-tutorial="video-grid"] button'); if (b) b.click(); return !!b })()`)
  const playerA = await waitFor(pa, `document.querySelector('[data-tutorial="video-player"]')`)
  check(playerA, 'U3 单击素材卡进入播放视图（下载钮所在的版本面板才存在）', playerA ? '' : '→ 没进播放器')
  const inReel = await waitFor(pa, `document.querySelector('[data-tutorial="download-btn"]')`)
  check(inReel, 'U4 勾了「允许下载」：未登录访客看得到下载原片按钮', inReel ? '' : '→ 按钮没出现')
  const reelNote = await evalJs(pa, `[...document.querySelectorAll('p')].filter(p => /失效/.test(p.textContent) && p.offsetParent !== null).length`)
  check(Number(reelNote) >= 1, 'U5 切进播放视图后期限仍然画得出来（不是只在网格顶栏有一次）', `→ 可见 ${reelNote} 处`)

  // §6 的家底清点：访客页画了哪些可点的东西与标题，一次打全（只记录不断言，先看清事实）。
  const census = await evalJs(pa, `(() => {
    const seen = new Set()
    for (const el of document.querySelectorAll('button, a, [role=button], h1, h2, h3, input, select')) {
      if (el.offsetParent === null) continue
      const label = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || el.placeholder || '').trim().replace(/\\s+/g, ' ').slice(0, 26)
      if (label) seen.add(el.tagName + ':' + label)
    }
    return [...seen].join(' | ')
  })()`)
  console.log(`  §6 访客页可见控件（只记录）→ ${census}`)

  await evalJs(pa, `(() => { const b = document.querySelector('[data-tutorial="download-btn"]'); if (b) b.click(); return !!b })()`)
  const mintUrl = await pollUntil(() => hasUrl(pa, /\/video-token\?.*quality=original/), 12_000)
  check(!!mintUrl, 'U6 点下载真的去 mint 原片令牌（quality=original，不是拿播放用的 720p 凑数）', mintUrl ?? '→ 没有这个请求')
  await pollUntil(() => (pa.statuses.get(mintUrl ?? '') ? true : undefined), 8_000)
  check(pa.statuses.get(mintUrl ?? '') === 200, 'U7 mint 回来是 200（访客的下载权限在服务端也认）', `→ ${String(pa.statuses.get(mintUrl ?? ''))}`)
  // 下载这一发由浏览器的下载管理器发出，页面级 Network 事件收不到（实测页面流水里只有播放用的
  // /api/content/{t}，无 ?download=true），所以判据读的是 Page.downloadWillBegin。
  // 这一发事件的 sessionId 不稳定（同一枚下载，两次运行分别落在页面桶和全局桶），两个桶都得读。
  const dlUrl = await pollUntil(() => [...pa.downloads, ...browserDownloads].find(u => /\/api\/content\/[^/?]+\?download=true/.test(u)), 20_000)
  check(!!dlUrl, 'U8 mint 成功后浏览器才去打 /api/content/{t}?download=true（下载的是原片那条，不是播放那条）',
    dlUrl ? `→ ${dlUrl.slice(0, 96)}`
      : `→ 浏览器认下的下载：${JSON.stringify([...pa.downloads, ...browserDownloads])}；页面 /api/content 流水：${JSON.stringify(pa.requests.filter(u => u.includes('/api/content')))}`)
  const dlFiles = readdirSync(downloadDir).map(f => `${f} ${statSync(join(downloadDir, f)).size}B`)
  console.log(`  落盘（只记录不断言：fixture 的 originalStoragePath 指向不存在的对象）→ ${JSON.stringify(dlFiles)}`)
  await closePage(pa)

  // ── B 只读链接 ─────────────────────────────────────────────────────────
  const pb = await openPage()
  await run(pb, `/${codeView}`)
  check(await waitFor(pb, `document.querySelector('${gridNote}')`), 'U9 没勾下载的链接同样显示有效期（期限与权限是两件事）')
  // 先等到素材卡真画出来再点：那一瞬点在水合前的空壳上，得出的「进不去播放视图」量的是时序不是产品。
  const cardB = await waitFor(pb, `document.querySelector('[data-tutorial="video-grid"] button')`)
  if (cardB) await evalJs(pb, `(() => { document.querySelector('[data-tutorial="video-grid"] button').click(); return true })()`)
  const playerB = await waitFor(pb, `document.querySelector('[data-tutorial="video-player"]')`, 60_000)
  if (!playerB) await dumpPage(pb, 'B 进不去播放视图', codeView)
  check(playerB, 'U10 只读链接也能进播放视图', playerB ? '' : `→ ${(await snapshot(pb)).slice(0, 240)}`)
  await sleep(3_000)
  const btnOnViewOnly = await evalJs(pb, `!!document.querySelector('[data-tutorial="download-btn"]')`)
  const mintOnViewOnly = hasUrl(pb, /quality=original/)
  // 「没有按钮」在空白页上也成立，所以必须连着「面板真的画出来了」一起断。
  check(btnOnViewOnly === false && playerB, 'U11 只勾 view/comment：未登录访客看不到下载按钮（且不是空页假过）', btnOnViewOnly ? '→ 出现了' : '')
  check(!mintOnViewOnly && playerB, 'U12 且一次都没 mint 原片令牌（按钮没画就不会有绕过路径）', mintOnViewOnly ? `→ ${mintOnViewOnly.slice(0, 96)}` : '')
  await closePage(pb)

  // ── C 无期限链接 ───────────────────────────────────────────────────────
  const pc = await openPage()
  await run(pc, `/${codeFree}`)
  const gridC = await waitFor(pc, `document.querySelector('[data-tutorial="video-grid"] button')`)
  if (!gridC) await dumpPage(pc, 'C 素材网格没出来', codeFree)
  check(gridC, 'U13 无期限链接照常出素材网格', gridC ? '' : `→ ${(await snapshot(pc)).slice(0, 240)}`)
  await sleep(1_200)
  const freeNote = await evalJs(pc, `document.querySelector('${gridNote}')`)
  const barC = await evalJs(pc, `!!document.querySelector('[data-tutorial="grid-actions"]')`)
  check(freeNote === null && barC, 'U14 既不到期也不限次：顶栏在，但一行免责声明都不画（无限链接不该吓访客）', freeNote ? `→ 「${String(freeNote).slice(0, 80)}」` : '')
  await closePage(pc)

  // ── D 登录后的「项目信息」入口 ─────────────────────────────────────────
  // 他 10-02 点单：那条按钮不再跳预览页，改成就地开「创建审阅分享」，范围是整项目。
  // 登录只能在浏览器里做：会话指纹是 sha256(设备头 + UA)（src/lib/studio-device.ts:6），
  // Node 侧登录的令牌换到浏览器手上对不上指纹，刷新会 401 并连带撤掉整枚会话（src/lib/auth.ts:285）。
  const deviceId = `visitor-device-${stamp}`
  const pd = await openPage()
  await pd.s('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.setItem('vitransfer_device_id', ${JSON.stringify(deviceId)})`,
  })
  await run(pd, '/login')
  // 只回状态与「有没有换到会话」，令牌本身一个字节都不许离开浏览器。
  const loginIn = String(await evalJs(pd, `(async () => {
    const r = await fetch('/api/auth/login', { method: 'POST', cache: 'no-store',
      headers: { 'content-type': 'application/json', 'X-ViTransfer-Device-ID': '${deviceId}' },
      body: JSON.stringify({ email: ${JSON.stringify(ownerEmail)}, password: ${JSON.stringify(pw)} }) })
    const j = await r.json().catch(() => null)
    if (j?.tokens?.refreshToken) localStorage.setItem('vitransfer_refresh_token', j.tokens.refreshToken)
    return r.status + ' ' + (j?.tokens?.refreshToken ? 'session' : JSON.stringify(j?.error ?? '').slice(0, 120))
  })()`))
  check(/^200 session$/.test(loginIn), 'U15 浏览器内登录拿到会话（产品自己的登录路，不是伪造的令牌）', `→ ${JSON.stringify(loginIn)}`)

  await run(pd, `/studio/projects/${project.id}`)
  const findBtn = `[...document.querySelectorAll('button')].find(b => b.textContent.includes('分享审阅链接'))`
  const btnThere = await waitFor(pd, findBtn, 90_000)
  const btnText = btnThere ? String(await evalJs(pd, `${findBtn}.textContent`)) : ''
  const staleLabel = await evalJs(pd, `document.body.innerText.includes('预览客户页面')`)
  check(btnThere && /分享审阅链接/.test(btnText), 'U16 项目信息里那条按钮画的是「分享审阅链接」', btnThere ? '' : `→ ${(await snapshot(pd)).slice(0, 240)}`)
  check(btnThere && staleLabel === false, 'U17 旧那句「预览客户页面」整页不再出现（是换掉，不是并排留着）', staleLabel ? '→ 还在' : '')

  // 基线在点击前一刻现取：进页面这一步本身就会把项目主链接落成一行（实测 3→4），写死数字会假败。
  const linksBefore = await prisma.shareLink.count({ where: { projectId: project.id } })
  await evalJs(pd, `(() => { const b = ${findBtn}; if (b) b.click(); return !!b })()`)
  const dialog = await waitFor(pd, `document.querySelector('[role="dialog"]')`, 20_000)
  const dialogTitle = dialog ? String(await evalJs(pd, `document.querySelector('[role="dialog"] h2')?.textContent ?? ''`)) : ''
  check(Boolean(dialog) && dialogTitle.includes('创建审阅分享'), 'U18 点它弹的就是「创建审阅分享」窗', `→ ${JSON.stringify(dialogTitle)}`)
  const nameValue = dialog ? String(await evalJs(pd, `document.querySelector('[role="dialog"] input').value`)) : ''
  check(dialog && nameValue === `${project.title}审阅`, 'U19 名称预填「<项目名>审阅」，带的是项目本身不是某条素材', `→ ${JSON.stringify(nameValue)}`)
  const hasScopeSelect = dialog ? Boolean(await evalJs(pd, `[...document.querySelectorAll('[role="dialog"] label')].some(l => l.textContent.includes('分享范围'))`)) : false
  check(dialog && !hasScopeSelect, 'U20 项目级不出现「分享范围」下拉（那是按素材/版本才有的选择）', hasScopeSelect ? '→ 出现了' : '')
  // 落库与否问库，不问请求流水：开窗本身允许读列表，读请求不该被判成写。
  const linksAfter = await prisma.shareLink.count({ where: { projectId: project.id } })
  check(dialog && linksAfter === linksBefore, 'U21 光是开窗一条链接都没落库（没按下分享钮不许写）', dialog ? `→ 点前 ${linksBefore} 行，点后 ${linksAfter} 行` : '→ 窗都没开，不作数')
  if (!dialog) await dumpPage(pd, 'D 弹窗没开', codeFree)
  await closePage(pd)

  await send('Browser.close').catch(() => null)
} finally {
  // 跑挂也不许留无头 Chrome 在后台，更不许留临时浏览器档。
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
        if (raw && (JSON.parse(raw).projectId === teamRow.id || String(JSON.parse(raw).sessionId).includes(teamSlug))) await redis.del(key)
      }
      await prisma.shareLink.deleteMany({ where: { projectId: pid } })
      await prisma.sharePageAccess.deleteMany({ where: { projectId: pid } })
      await prisma.securityEvent.deleteMany({ where: { projectId: pid } })
      await prisma.video.deleteMany({ where: { projectId: pid } })
    }
    await prisma.project.deleteMany({ where: { teamId: teamRow.id } })
    await prisma.team.deleteMany({ where: { id: teamRow.id } })
  }
  await prisma.user.deleteMany({ where: { email: ownerEmail } })
  const left = {
    links: await prisma.shareLink.count({ where: { project: { team: { slug: teamSlug } } } }),
    videos: await prisma.video.count({ where: { project: { team: { slug: teamSlug } } } }),
    teams: await prisma.team.count({ where: { slug: teamSlug } }),
    users: await prisma.user.count({ where: { email: ownerEmail } }),
  }
  console.log(`清场 → 剩 ${JSON.stringify(left)}`)
  check(Object.values(left).every(n => n === 0), 'U22 fixture 全部清干净（含浏览器 mint 出的令牌）')
  await prisma.$disconnect()
  await redis.quit().catch(() => null)
}

if (failures.length) {
  console.log(`\n${failures.length} 条未过：`)
  for (const f of failures) console.log(` - ${f}`)
  process.exit(1)
}
console.log('\n全部通过')
