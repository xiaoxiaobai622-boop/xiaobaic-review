import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  check(/lg:w-\[56px\]/.test(rail) && /h-\[44px\] w-\[44px\]/.test(rail),
    'S20 护栏：窄栏宽度与 44px 命中区一字没动（A16/A17 钉的就是这两个数）')

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

  void reply; void announcement; void leaked; void stale

  if (!WITH_BROWSER) {
    console.log('\n（B 组浏览器实测没跑：加 --browser 才跑，它要你自己的 next dev 在 :3000 上活着）')
  } else {
    console.log('\n── B 组：浏览器实测 ──')
    chrome = await connectChrome()
    const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then(r => r.json())
    await attachSocket(webSocketDebuggerUrl)

    const page1 = await openPage()
    console.log(`  登录（主账号）→ ${await loginInBrowser(page1, ownerEmail)}`)
    await page1.s('Page.navigate', { url: `${BASE}/studio/projects` })
    check(await waitFor(page1, `document.querySelector('aside')`, 120_000), 'B1 窄栏画得出来（页面活着）')
    check(await waitFor(page1, `[...document.querySelectorAll('aside button')].some(b => (b.getAttribute('aria-label') || '').includes('通知'))`, 30_000),
      'B2 窄栏里有那枚铃铛')
    await evalJs(page1, `[...document.querySelectorAll('aside button')].find(b => (b.getAttribute('aria-label') || '').includes('通知')).click()`)
    check(await waitFor(page1, `document.querySelector('[data-rail-panel="notifications"]')`, 20_000), 'B3 点铃铛能开面板')
    // 面板先画空壳、数据随后到（打开时各打一次端点），所以先等自己那条夹具进来再量。
    check(await waitFor(page1, `document.querySelector('[data-rail-panel="notifications"]').innerText.includes('回复你的-')`, 20_000),
      'B2·b 面板里的数据真的到了（不是只画了空壳）')
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
    await sleep(1500)
    await evalJs(page1, `${NB}.find(b => b.textContent.trim().startsWith('未读')).click()`)
    await sleep(600)
    const afterMark = String(await evalJs(page1, `JSON.stringify({ rows: document.querySelectorAll('${ROWS}').length, label: [...document.querySelectorAll('aside button')].find(b => (b.getAttribute('aria-label') || '').includes('通知'))?.getAttribute('aria-label') })`))
    check(JSON.parse(afterMark).rows === 0 && !/条未读通知/.test(String(JSON.parse(afterMark).label)),
      'B13 按下「全部标记为已读」才清：未读筛出来 0 行、红点没了', `→ ${afterMark}`)
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
    const tokenCalls = Number(await evalJs(page3, `performance.getEntriesByType('resource').filter(e => e.name.includes('/api/studio/video-token')).length`))
    const thumbRow = String(await evalJs(page3, `(() => {
      const row = [...document.querySelectorAll('[data-search-row]')].find(r => r.innerText.includes('有封面'))
      const img = row && row.querySelector('img')
      return JSON.stringify({ found: !!row, imgOk: img ? img.complete && img.naturalWidth > 0 : null, initials: row ? /[一-龥]/.test(row.querySelector('span').innerText) : false })
    })()`))
    check(tokenCalls >= 1 && JSON.parse(thumbRow).found && JSON.parse(thumbRow).initials,
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
