import { spawn, type ChildProcess } from 'node:child_process'
import { rmSync } from 'node:fs'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/encryption'

/**
 * 他 10-02 点单的两处界面改动的判据：
 *  A 组 窄栏最下方那枚账户按钮换成真实头像圆片（有照片→圆图，没照片→名字坐粉色片，
 *    照片加载失败→同样回落到名字片）；那条粉色渐变归窄栏背景，不归头像（他 10-02 拿对标截图更正）；
 *    44px 命中区与窄栏那一列宽度一寸不动、灰色小人不再出现；
 *    照片的来路也包括「User 表没头像但微信身份有」这一支，否则线上他自己还是灰小人。
 *  B 组 项目信息里「分享审阅链接」与「查看数据统计」中间多一枚「复制收录链接」：
 *    点一下把该项目的收录短链写进剪贴板、按钮变「已复制」再自己变回去；一条 ACTIVE 收录链接
 *    都没有时点它开现成的创建窗；项目没开收录时这枚按钮不出现。
 * 登录只在浏览器里做（会话指纹绑设备头＋UA，Node 侧令牌在浏览器一刷就烧掉整枚会话）。
 * CDP 用 Node 内置 WebSocket，零依赖。
 */
const BASE = process.env.SHARE_CHECK_BASE || 'http://localhost:3000'
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const prisma = new PrismaClient()
const stamp = Date.now()
const failures: string[] = []
const teamSlug = `avatar-copy-${stamp}`
const pw = `avatar-copy-${stamp}`
const cdpPort = 9300 + (stamp % 600)
const userDataDir = join(tmpdir(), `avatar-copy-${stamp}`)
const tokens: string[] = []
let chrome: ChildProcess | undefined

/** 一张真实可加载的图：data URL 够用，且不在仓库里留文件。 */
const photo = (hex: string) => 'data:image/svg+xml;base64,' + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${hex}"/></svg>`,
).toString('base64')

const USERS = [
  { key: 'photo', name: 'Owner Case', email: `photo-${stamp}@example.invalid`, avatar: photo('#2563eb'), wechat: null as string | null },
  { key: 'initial', name: 'Milo Chen', email: `initial-${stamp}@example.invalid`, avatar: null as string | null, wechat: null as string | null },
  { key: 'wechat', name: 'Wei Xin', email: `wechat-${stamp}@example.invalid`, avatar: null as string | null, wechat: photo('#ea580c') },
  { key: 'broken', name: 'Broken Case', email: `broken-${stamp}@example.invalid`, avatar: `${BASE}/api/no-such-image-${stamp}`, wechat: null as string | null },
]

function check(ok: boolean, label: string, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` ${detail}` : ''}`)
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** WCAG 相对亮度与对比度：渐变两端的白字对比都算出来，别拿眼睛判断。 */
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
function gradientStops(bg: string): number[][] {
  return [...bg.matchAll(/rgba?\([^)]*\)/g)].map(m => rgbOf(m[0])).filter((v): v is number[] => Boolean(v))
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
  // 剪贴板权限不带 browserContextId 时只给默认上下文，我们每枚页面都活在独立上下文里，
  // 于是 writeText 直接 NotAllowedError——量到的是浏览器策略而不是产品。
  await send('Browser.grantPermissions', { permissions: ['clipboardReadWrite'], origin: BASE, browserContextId })
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

/** 每枚页面独立登录：设备 id 必须在建会话前种进上下文。 */
async function loginInBrowser(page: Page, email: string) {
  const deviceId = `rail-${stamp}-${email.slice(0, 6)}`
  await page.s('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.setItem('vitransfer_device_id', ${JSON.stringify(deviceId)})`,
  })
  await run(page, '/login')
  // 只借这枚同源页面发登录请求：/login 的 SSR 首屏是微信扫码那面（没有密码输入框），
  // 等产品自己的接口换会话即可，不必先等表单画出来。
  if (!await waitFor(page, `document.body && document.body.children.length > 0`, 90_000)) return 'no-page'
  const out = String(await evalJs(page, `(async () => {
    const r = await fetch('/api/auth/login', { method: 'POST', cache: 'no-store',
      headers: { 'content-type': 'application/json', 'X-ViTransfer-Device-ID': ${JSON.stringify(deviceId)} },
      body: JSON.stringify({ email: ${JSON.stringify(email)}, password: ${JSON.stringify(pw)} }) })
    const j = await r.json().catch(() => null)
    if (j?.tokens?.refreshToken) localStorage.setItem('vitransfer_refresh_token', j.tokens.refreshToken)
    return r.status + ' ' + (j?.tokens?.refreshToken ? 'session' : JSON.stringify(j?.error ?? '').slice(0, 90))
  })()`))
  return out
}

/** 窄栏那枚账户按钮的实际绘制事实：几何、有没有图、画了哪些渐变、字色。 */
async function railFacts(page: Page, displayName: string) {
  return JSON.parse(String(await evalJs(page, `(() => {
    const aside = document.querySelector('aside')
    const btn = aside && [...aside.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(displayName)})
    if (!btn) return JSON.stringify({ missing: true, aside: Boolean(aside) })
    const box = btn.getBoundingClientRect()
    const imgs = [...btn.querySelectorAll('img')].filter(i => i.offsetParent !== null && i.getBoundingClientRect().width > 0)
    const img = imgs[0]
    const disc = img ? img.parentElement : btn.firstElementChild
    const dbox = disc ? disc.getBoundingClientRect() : null
    const svgs = [...btn.querySelectorAll('svg')].filter(s => s.offsetParent !== null && s.getBoundingClientRect().width > 0)
    // 头像本体的涂色（不含窄栏那条：那条单独量在 railBg）
    const painted = [disc, btn].filter(Boolean).map(el => getComputedStyle(el).backgroundImage).filter(v => v && v !== 'none')
    return JSON.stringify({
      hit: { w: Math.round(box.width), h: Math.round(box.height) },
      railW: Math.round(aside.getBoundingClientRect().width),
      railH: Math.round(aside.getBoundingClientRect().height),
      railRight: Math.round(aside.getBoundingClientRect().right),
      nextLeft: aside.nextElementSibling ? Math.round(aside.nextElementSibling.getBoundingClientRect().left) : null,
      avatarCx: Math.round(box.left + box.width / 2),
      // 洗该吃多高不由我按像素凑：量「栏底到头像上缘」，两枚（头像＋它上面那枚）就是这条洗的上界。
      avatarBottomGap: Math.round(aside.getBoundingClientRect().bottom - box.bottom),
      avatarTopGap: Math.round(aside.getBoundingClientRect().bottom - box.top),
      railCls: Array.from(aside.classList).filter(c => /^(w-|lg:w-|lg:pl-|lg:pr-|lg:mr-)/.test(c)).join(' '),
      railBg: getComputedStyle(aside).backgroundImage,
      railBase: getComputedStyle(aside).backgroundColor,
      discW: dbox ? Math.round(dbox.width) : null,
      discH: dbox ? Math.round(dbox.height) : null,
      discRadius: disc ? getComputedStyle(disc).borderRadius : null,
      btnRadius: getComputedStyle(btn).borderRadius,
      // 主题切换那枚是 <label>（里面藏着 select），它自己带底色和描边＝窄栏上那块方框
      themeBox: (() => {
        const lab = aside.querySelector('label:has(select)')
        if (!lab) return null
        const cs = getComputedStyle(lab)
        return { bg: cs.backgroundColor, border: cs.borderTopWidth, w: Math.round(lab.getBoundingClientRect().width) }
      })(),
      imgVisible: Boolean(img),
      imgNatural: img ? img.naturalWidth : null,
      imgSrc: img ? String(img.currentSrc).slice(0, 24) : null,
      svgVisible: svgs.length,
      text: btn.innerText.trim(),
      color: getComputedStyle(disc ?? btn).color,
      gradients: painted.filter(v => v.includes('linear-gradient')),
    })
  })()`)))
}

const SENTINEL = `sentinel-${stamp}`

try {
  // ── fixtures：一枚团队 + 四个账号（各自的头像态）+ 三枚项目 ─────────────
  const rows: Record<string, string> = {}
  for (const [index, u] of USERS.entries()) {
    const row = await prisma.user.create({
      data: { email: u.email, name: u.name, password: await hashPassword(pw), avatarUrl: u.avatar, phone: `139${String(stamp).slice(-7)}${index}` },
    })
    rows[u.key] = row.id
  }
  const team = await prisma.team.create({
    data: {
      name: teamSlug, slug: teamSlug, shareKey: teamSlug, createdById: rows.photo, subscriptionPlan: 'BETA',
      members: { create: USERS.map(u => ({ userId: rows[u.key], role: u.key === 'photo' ? 'OWNER' : 'MEMBER', status: 'ACTIVE' })) },
    },
  })
  if (USERS[2].wechat) {
    await prisma.wechatIdentity.create({
      data: { userId: rows.wechat, openId: `wx-${stamp}`, platform: 'WEB', nickname: USERS[2].name, avatarUrl: USERS[2].wechat },
    })
  }
  const project = await prisma.project.create({
    data: { teamId: team.id, createdById: rows.photo, projectCode: `AC${String(stamp).slice(-6)}`, title: `收录复制-${stamp}`, slug: `acp-${stamp}`, shareSlug: `acs-${stamp}`, allowReverseShare: true },
  })
  const noCollect = await prisma.project.create({
    data: { teamId: team.id, createdById: rows.photo, projectCode: `NB${String(stamp).slice(-6)}`, title: `只剩已取消-${stamp}`, slug: `acn-${stamp}`, shareSlug: `acn-s-${stamp}`, allowReverseShare: true },
  })
  const noLinks = await prisma.project.create({
    data: { teamId: team.id, createdById: rows.photo, projectCode: `NL${String(stamp).slice(-6)}`, title: `尚无收录-${stamp}`, slug: `acl-${stamp}`, shareSlug: `acl-s-${stamp}`, allowReverseShare: true },
  })
  const closed = await prisma.project.create({
    data: { teamId: team.id, createdById: rows.photo, projectCode: `CL${String(stamp).slice(-6)}`, title: `未开收录-${stamp}`, slug: `acc-${stamp}`, shareSlug: `acc-s-${stamp}`, allowReverseShare: false },
  })
  const login = await call('POST', '/api/auth/login', '', { email: USERS[0].email, password: pw })
  const adminToken = login.json?.tokens?.accessToken as string | undefined
  if (!adminToken) throw new Error(`登录失败 → ${login.status}`)
  tokens.push(adminToken)

  const created = await call('POST', `/api/projects/${project.id}/share-links`, adminToken, {
    name: '收录复制试验', type: 'COLLECT', scopeType: 'PROJECT', scopeId: '', authMode: 'NONE', permissions: ['upload'],
  })
  const collectUrl = created.json?.shareLink?.url as string | undefined
  if (!collectUrl) throw new Error(`建收录链接失败 → ${created.status} ${JSON.stringify(created.json)?.slice(0, 160)}`)
  // 只留「已取消」的那一条：这种情况等价于「没有」，不该把死链复制给人家。
  const revoked = await call('POST', `/api/projects/${noCollect.id}/share-links`, adminToken, {
    name: '已取消的收录链接', type: 'COLLECT', scopeType: 'PROJECT', scopeId: '', authMode: 'NONE', permissions: ['upload'],
  })
  const revokedId = revoked.json?.shareLink?.id as string | undefined
  if (revokedId) await prisma.shareLink.update({ where: { id: revokedId }, data: { status: 'REVOKED' } })

  // dev 冷路由要 20–35 秒：先焐热，否则量到的是 webpack 编译不是产品。
  const warm = async (path: string, headers?: Record<string, string>) => {
    try { return String((await fetch(`${BASE}${path}`, { headers, cache: 'no-store', redirect: 'manual' })).status) }
    catch (e) { return `预热失败 ${(e as Error).message}` }
  }
  for (const p of ['/login', '/studio/projects', ...[project, noCollect, noLinks, closed].map(x => `/studio/projects/${x.id}`),
    `/api/projects/${project.id}`, `/api/projects/${project.id}/share-links`, '/api/team-center', '/api/announcements', '/api/comments/for-me',
    `/api/projects/${project.id}/photo-albums`, `/api/projects/${project.id}/recycle-bin`, `/api/projects/${project.id}/project-uploads`]) {
    console.log(`预热 ${p} → ${await warm(p, p.startsWith('/api/') ? { authorization: `Bearer ${adminToken}` } : undefined)}`)
  }

  chrome = await connectChrome()
  const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then(r => r.json())
  await attachSocket(webSocketDebuggerUrl)

  // ── A 组：窄栏头像 ─────────────────────────────────────────────────────
  const facts: Record<string, any> = {}
  for (const u of USERS) {
    const page = await openPage()
    const res = await loginInBrowser(page, u.email)
    check(/^200 session$/.test(res), `A0 ${u.key}：浏览器内登录拿到会话`, `→ ${JSON.stringify(res)}`)
    await run(page, '/studio/projects')
    const up = await waitFor(page, `document.querySelector('aside')`, 90_000)
    check(up, `A0b ${u.key}：窄栏画出来了`)
    facts[u.key] = await railFacts(page, u.name)
    if (u.key === 'broken' && facts[u.key].imgVisible) {
      // 挂掉的地址要真跑到 onError 才算数：dev 回 404 慢，采样早了量到的是「还在加载」。
      await waitFor(page, `(() => {
        const aside = document.querySelector('aside')
        const btn = aside && [...aside.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Broken Case')
        if (!btn) return false
        return ![...btn.querySelectorAll('img')].some(i => i.offsetParent !== null) && btn.innerText.trim() === 'B'
      })()`, 25_000)
      facts[u.key] = await railFacts(page, u.name)
    }
    console.log(`  ${u.key} → ${JSON.stringify(facts[u.key])}`)
    if (u.key === 'photo') {
      // 深色主题下这条渐变必须退回 none：浅粉面压浅色图标是读不出的对比度。
      // 只在页面上临时加一次 .dark，量完立刻还原。
      facts[u.key].railBgDark = String(await evalJs(page, `(() => {
        const el = document.querySelector('aside')
        const root = document.documentElement
        const had = root.classList.contains('dark')
        root.classList.add('dark')
        const v = getComputedStyle(el).backgroundImage
        if (!had) root.classList.remove('dark')
        return v
      })()`))
      console.log(`  railBg(dark) → ${JSON.stringify(facts[u.key].railBgDark)}`)
    }
    if (['photo', 'initial', 'broken'].includes(u.key)) {
      // 几何判据证不了「看着对不对」：把窄栏底部那 150px 存成图，我自己在眼里过一遍。
      const box = JSON.parse(String(await evalJs(page, `(() => { const r = document.querySelector('aside').getBoundingClientRect(); return JSON.stringify({ y: r.bottom, h: Math.round(r.height) }) })()`)))
      const { data } = await page.s('Page.captureScreenshot', { clip: { x: 0, y: Math.max(0, box.y - 150), width: 260, height: 150, scale: 3 } })
      writeFileSync(`/tmp/rail-avatar-${u.key}.png`, Buffer.from(data, 'base64'))
      if (u.key === 'initial') {
        // 「洗只占底部一小段」是像素级的事，几何判据证不到：整条栏存一张，再拿 PIL 逐行取样。
        const full = await page.s('Page.captureScreenshot', { clip: { x: 0, y: 0, width: 110, height: box.h, scale: 2 } })
        writeFileSync('/tmp/rail-full.png', Buffer.from(full.data, 'base64'))
      }
    }
    await closePage(page)
  }

  const discIs = (f: any, lo: number, hi: number) => f.discW !== null && Math.abs(f.discW - f.discH) <= 1 && f.discW >= lo && f.discW <= hi
  const isCircle = (f: any) => {
    const m = /(\d+(?:\.\d+)?)px/.exec(String(f.discRadius))
    return m ? Number(m[1]) >= (f.discW ?? 0) / 2 - 1 : /50%|9999/.test(String(f.discRadius))
  }
  const f1 = facts.photo
  check(Boolean(f1.imgVisible) && Number(f1.imgNatural) > 0, 'A1 有照片：按钮里画的是真的图（加载成功，不是破图）', `→ ${JSON.stringify({ v: f1.imgVisible, n: f1.imgNatural })}`)
  check(discIs(f1, 30, 34), 'A2 有照片：那枚圆盘是 32px 上下（坐在 44px 命中区里，不再铺满整枚按钮）', `→ disc ${f1.discW}×${f1.discH}`)
  check(Array.isArray(f1.gradients) && f1.gradients.length === 0,
    'A4 有照片时头像本体不涂渐变（粉色渐变归窄栏背景，不归头像）', `→ 头像上量到 ${JSON.stringify(f1.gradients)}`)

  const f2 = facts.initial
  check(f2.imgVisible === false && f2.text === 'M' && f2.svgVisible === 0,
    'A5 没照片：画的是名字首字，灰色小人图标不再出现，也没有破图占位', `→ ${JSON.stringify({ img: f2.imgVisible, text: f2.text, svg: f2.svgVisible })}`)
  check(discIs(f1, 30, 34) && isCircle(f1),
    'A3 有照片那态还是 32px 正圆（他这次只点单名字片改方角，照片没让动）', `→ photo ${f1.discW}×${f1.discH}/${f1.discRadius}`)
  // 他截图那颗方片：按「圆角 ÷ 片宽」量（免掉截图缩放）≈ 0.22~0.25 ⇒ 32px 片上约 7~9px。
  // 取窄栏这一列本来就在用的那一档（44px 按钮的 rounded-lg），不新造字面量。
  const chipR = Number(/(\d+(?:\.\d+)?)px/.exec(String(f2.discRadius))?.[1] ?? NaN)
  const btnR = Number(/(\d+(?:\.\d+)?)px/.exec(String(f2.btnRadius))?.[1] ?? NaN)
  check(discIs(f2, 30, 34) && Number.isFinite(chipR) && Math.abs(chipR - btnR) < 0.5 && chipR < (f2.discW ?? 0) / 2 - 1,
    'A15 没照片那颗名字片＝圆角方块：圆角跟窄栏其他控件同一档、且明显小于半径（不再是正圆）',
    `→ 片 ${f2.discW}×${f2.discH} 圆角 ${f2.discRadius}｜同栏按钮圆角 ${f2.btnRadius}｜片宽一半 ${(f2.discW ?? 0) / 2}`)
  const nameChip = String(f2.gradients?.[0] ?? '')
  const chipStops = gradientStops(nameChip)
  // Chrome 把默认的 180deg 直接省掉，所以方向只能按「两端色的先后」断：第一端必须是截图顶部那端。
  const chipOrdered = chipStops.map(s => s.join(',')).join('|')
  check(chipOrdered === '255,126,249|251,92,247',
    'A6 没照片：名字片是他截图里那条上浅下艳的竖向粉渐变（两端色按取样值实配，不是我猜的 hex）', `→ ${JSON.stringify(f2.gradients).slice(0, 200)}`)
  const ratios = chipStops.map(s => contrast([33, 33, 33], s).toFixed(2))
  check(rgbOf(String(f2.color))?.join(',') === '33,33,33' && chipStops.length >= 2 && chipStops.every(s => contrast([33, 33, 33], s) >= 4.5),
    'A7 深色字压粉片：两端对比度都够 4.5:1（由 getComputedStyle 反查实算，不是我看色）', `→ 字色 ${f2.color}，两端 ${ratios.join(' / ')}`)

  const f3 = facts.wechat
  check(Boolean(f3.imgVisible) && Number(f3.imgNatural) > 0,
    'A8 User 表没头像但微信身份有照片：会话把这枚照片带下来，画的不是首字', `→ ${JSON.stringify({ img: f3.imgVisible, src: f3.imgSrc, text: f3.text })}`)
  check(f3.text !== 'W', 'A9 该支不再退回首字', `→ text ${JSON.stringify(f3.text)}`)

  const f4 = facts.broken
  check(f4.imgVisible === false && f4.text === 'B' && Array.isArray(f4.gradients) && f4.gradients.length >= 1,
    'A10 照片地址挂了：回落到首字＋渐变，不留下破图（线上头像域名换掉时不该白屏一块）', `→ ${JSON.stringify({ img: f4.imgVisible, text: f4.text, svg: f4.svgVisible })}`)

  const hits = USERS.map(u => facts[u.key]?.hit)
  const rails = USERS.map(u => facts[u.key]?.railW)
  // 栏宽不由我按像素凑：`w-14` 在 :root{font-size:15px}（globals.css:10）下是 52.5px，
  // lg 那档的 71.25 ＝ 52.5 ＋ 并进栏面的那条 18.75 空带（原来挂在 lg:mr-5 上）。
  // 这里断的是「四个账号量到同一个数 ＋ 类一字没动」，真正钉住位置的是下面的 A16/A17。
  const hitOk = hits.every(h => h?.w === 44 && h?.h === 44)
    && new Set(rails).size === 1
    && ['w-14', 'lg:w-[71.25px]', 'lg:pl-5', 'lg:pr-5'].every(c => String(facts.photo?.railCls).split(' ').includes(c))
  check(hitOk, 'A11 四个账号一致：命中区还是 44×44、四个账号量到同一个栏宽（栏宽是类给的，不是我按像素凑的）',
    `→ ${USERS.map(u => `${u.key}:${JSON.stringify(facts[u.key]?.hit)}@${facts[u.key]?.railW}`).join(' ')} 类 ${facts.photo?.railCls}`)

  // 「右边那条空白填掉」不许变成「把内容挤走」，也不许挪图标：图标位置与内容区左缘都是他先前调过的。
  const nextLefts = USERS.map(u => Number(facts[u.key]?.nextLeft))
  check(nextLefts.every(v => v === 71), 'A16 内容区左缘没动：窄栏这条足迹仍是 0→71px（52.5 栏宽 ＋ 18.75 空带，改的是涂装范围不是列宽）',
    `→ ${USERS.map((u, i) => `${u.key}:${nextLefts[i]}`).join(' ')}`)
  const cxs = USERS.map(u => Number(facts[u.key]?.avatarCx))
  check(cxs.every(v => Math.abs(v - 36) <= 1), 'A17 图标绝对位置一寸没挪：头像中心 x=36（他调过的水平居中参照物）',
    `→ ${USERS.map((u, i) => `${u.key}:${cxs[i]}`).join(' ')}`)
  check(USERS.every(u => Number(facts[u.key]?.railRight) >= Number(facts[u.key]?.nextLeft) - 2),
    'A18 窄栏画到边：栏面右缘顶到内容区，中间不再留那条 20px 空带',
    `→ ${USERS.map(u => `${u.key}: 栏右 ${facts[u.key]?.railRight} ／ 内容左 ${facts[u.key]?.nextLeft}`).join(' ')}`)
  const tbs = USERS.map(u => facts[u.key]?.themeBox)
  check(tbs.every(b => b && b.bg === 'rgba(0, 0, 0, 0)' && b.border === '0px'),
    'A19 主题切换那枚的背景与描边都去掉（窄栏里它不该是一块自己的方框）', `→ ${JSON.stringify(tbs)}`)

  const railCss = String(facts.photo?.railBg)
  const railStops = gradientStops(railCss).map(s => s.join(','))
  const railBase = String(rgbOf(String(facts.photo?.railBase))?.join(','))
  // 这条洗的高度被否过两次：0%→100% 铺满整条 100vh ⇒「这啥玩意啊」；收成底部 260px（4~5 枚图标高）
  // ⇒「粉色渐变太多了」。现在按他否到底的锚点断：只吃最底两枚图标那一段（上界见 A14，由栏内几何算）。
  // 所以这里既断两端色，也断「向上一段固定长度就收尾、而且收进栏自己的底色」（底色按主题走，不写死）。
  check(railStops[0] === '243,193,245' && /to top/.test(railCss) && railStops.at(-1) === railBase,
    'A12 粉色洗归窄栏底部：底边 #f3c1f5 起、向上收进这一栏自己的底色（浅色实配取样值，底色跟着主题不写死）',
    `→ 底端 ${railStops[0]}，收进 ${railStops.at(-1)}＝底色 ${railBase}｜${railCss.slice(0, 120)}`)
  const washPx = Number([...railCss.matchAll(/(\d+(?:\.\d+)?)px/g)].map(m => Number(m[1])).pop())
  const railH = Number(facts.photo?.railH)
  // 130 是他看完 110 之后直接点的数（不是我算的）⇒ 判据钉这个值，同时把栏内几何打出来供人核对：
  // 最底两枚图标（头像＋它上面那枚）的上缘在 twoSlots 那一线，130 再往上多吃进第三枚那一排。
  const PINNED_WASH_PX = 130
  const twoSlots = Number(facts.photo?.avatarTopGap) + Number(facts.photo?.avatarBottomGap) + Number(facts.photo?.hit.h)
  check(washPx === PINNED_WASH_PX,
    `A14 这条洗按他点单收在 ${PINNED_WASH_PX}px（栏高 ${railH}px ＝ ${(washPx / railH * 100).toFixed(0)}%；最底两枚图标上缘＝${twoSlots}px，再往上多吃 ${washPx - twoSlots}px）`, `→ ${railCss.slice(0, 190)}`)
  check(facts.photo?.railBgDark === 'none',
    'A13 深色主题下这条渐变退回 none（浅粉面压浅色图标读不出对比度）', `→ ${JSON.stringify(facts.photo?.railBgDark)}`)

  // ── B 组：复制收录链接 ─────────────────────────────────────────────────
  const findBtn = (label: string) => `[...document.querySelectorAll('button')].filter(b => b.offsetParent !== null && b.textContent.includes(${JSON.stringify(label)}))`
  // 只认「看得见的第一个」：这枚组件在项目页挂了两次（侧栏 bare 与卡片），按文本找会挑到另一实例。
  const collectBtn = `[...document.querySelectorAll('[data-tutorial="copy-collect-link"]')].filter(b => b.offsetParent !== null)[0]`
  // 顺序按「分享审阅链接」所在的那一层兄弟节点量，跨实例不作数。
  const threeOrder = `(() => {
    const review = ${findBtn('分享审阅链接')}[0];
    const parent = review && review.parentElement;
    const texts = parent ? [...parent.querySelectorAll(':scope > button')].map(b => b.textContent.trim()) : [];
    const idx = n => texts.findIndex(t => t.includes(n));
    return JSON.stringify({ review: idx('分享审阅链接'), copy: idx('复制收录链接'), analytics: idx('查看数据统计'), siblings: texts.length });
  })()`

  const pb = await openPage()
  check(/^200 session$/.test(await loginInBrowser(pb, USERS[0].email)), 'B0 浏览器内登录（收录复制这趟）')
  await run(pb, `/studio/projects/${project.id}`)
  const reviewBtn = await waitFor(pb, `${findBtn('分享审阅链接')}.length`, 120_000)
  check(reviewBtn, 'B1 项目信息面板画出来了（「分享审阅链接」在）', reviewBtn ? '' : '→ 没等到')
  const order = JSON.parse(String(await evalJs(pb, threeOrder)))
  check(order.copy >= 0, 'B2 两枚中间多了一枚「复制收录链接」', `→ ${JSON.stringify(order)}`)
  check(order.review === 0 && order.copy === 1 && order.analytics === 2,
    'B3 同一层里顺序就是「审阅 → 收录 → 统计」（不是并排到别处）', `→ ${JSON.stringify(order)}`)

  await pb.s('Page.bringToFront')
  await evalJs(pb, `navigator.clipboard.writeText(${JSON.stringify(SENTINEL)})`)
  const countBefore = await prisma.shareLink.count({ where: { projectId: project.id } })
  await evalJs(pb, `(() => { const b = ${collectBtn}; if (b) b.click(); return Boolean(b) })()`)
  await pb.s('Page.bringToFront')
  const readBack = async () => String(await evalJs(pb, `navigator.clipboard.readText()`))
  let clip = await readBack()
  for (let i = 0; i < 20 && clip !== collectUrl; i++) { await sleep(400); clip = await readBack() }
  check(clip === collectUrl, 'B4 点一下把该项目最新的收录短链写进剪贴板', `→ 期望 ${collectUrl} 实得 ${JSON.stringify(clip).slice(0, 140)}`)
  const copied = await waitFor(pb, `${collectBtn} && /已复制/.test(${collectBtn}.textContent)`, 5_000)
  check(copied, 'B5 按钮自己说「已复制」（点了没反馈会被当成没生效，多半又点一次）')
  await sleep(2_600)
  const reverted = String(await evalJs(pb, `(() => { const b = ${collectBtn}; return b ? b.textContent : '' })()`))
  check(/复制收录链接/.test(reverted) && !/已复制/.test(reverted), 'B6 「已复制」是自己收回的临时态，不是永久改掉标签', `→ ${JSON.stringify(reverted)}`)
  const countAfter = await prisma.shareLink.count({ where: { projectId: project.id } })
  check(countAfter === countBefore, 'B7 已有收录链接时点它一条都不新造（复制是读，不是写）', `→ 前 ${countBefore} 行，后 ${countAfter} 行`)
  await closePage(pb)

  // 一条 ACTIVE 都没有：点它该开现成的创建窗，而不是复制死链或复制哨兵串。
  for (const [label, pid, note] of [['B8 一条收录链接都没有的项目', noLinks.id, '没有'], ['B9 只剩已取消收录链接的项目', noCollect.id, '已取消＝没有']] as const) {
    const pc = await openPage()
    await loginInBrowser(pc, USERS[0].email)
    await run(pc, `/studio/projects/${pid}`)
    const has = await waitFor(pc, `${collectBtn}`, 120_000)
    check(has, `${label}：按钮在（入口不该因为还没有链接就消失）`, has ? '' : '→ 没等到')
    await pc.s('Page.bringToFront')
    await evalJs(pc, `navigator.clipboard.writeText(${JSON.stringify(SENTINEL)})`)
    await evalJs(pc, `(() => { const b = ${collectBtn}; if (b) b.click(); return Boolean(b) })()`)
    const dlg = await waitFor(pc, `document.querySelector('[role="dialog"]')`, 20_000)
    const title = dlg ? String(await evalJs(pc, `document.querySelector('[role="dialog"] h2')?.textContent ?? ''`)) : ''
    check(Boolean(dlg) && title.includes('创建收录分享'), `${label}：点它弹「创建收录分享」窗（走现成的创建流）`, `→ ${JSON.stringify(title)}`)
    await pc.s('Page.bringToFront')
    const stillSentinel = (await evalJs(pc, `navigator.clipboard.readText()`)) === SENTINEL
    check(stillSentinel, `${label}（${note}）：剪贴板没被动过（不复制过期/已取消的地址）`)
    await closePage(pc)
  }

  // 项目没开收录：上传接口一律 403，所以这枚入口照分享记录面板的现成规矩不显示。
  const pd = await openPage()
  await loginInBrowser(pd, USERS[0].email)
  await run(pd, `/studio/projects/${closed.id}`)
  check(await waitFor(pd, `${findBtn('分享审阅链接')}.length`, 120_000), 'B10 未开收录的项目：面板照常画出来（另两枚在）')
  await sleep(1_500)
  const closedHas = await evalJs(pd, `document.querySelectorAll('[data-tutorial="copy-collect-link"]').length`)
  check(Number(closedHas) === 0, 'B11 未开收录时「复制收录链接」不出现（点了也只会拿到 403）', `→ ${String(closedHas)} 枚`)
  await closePage(pd)

  // 四语言都要有这句：界面只跑得出一种，漏一种就是那门语言里没标签。
  const locales = ['zh', 'en', 'de', 'nl']
  const missing = locales.filter(l => !readFileSync(`src/locales/${l}.json`, 'utf8').includes('"copyCollectLink"'))
  check(missing.length === 0, 'B12 四语言都补了这句标签', missing.length ? `→ 缺 ${missing.join('/')}` : '')

  await send('Browser.close').catch(() => null)
} finally {
  chrome?.kill()
  rmSync(userDataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 })
  try { ws?.close() } catch { /* already closed */ }
  for (const t of tokens) await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${t}` } }).catch(() => null)
  const teamRow = await prisma.team.findFirst({ where: { slug: teamSlug }, select: { id: true } })
  if (teamRow) {
    const ids = (await prisma.project.findMany({ where: { teamId: teamRow.id }, select: { id: true } })).map(p => p.id)
    for (const pid of ids) {
      await prisma.shareLink.deleteMany({ where: { projectId: pid } })
      await prisma.sharePageAccess.deleteMany({ where: { projectId: pid } })
    }
    await prisma.project.deleteMany({ where: { teamId: teamRow.id } })
    await prisma.teamMember.deleteMany({ where: { teamId: teamRow.id } })
    await prisma.team.deleteMany({ where: { id: teamRow.id } })
  }
  await prisma.wechatIdentity.deleteMany({ where: { openId: `wx-${stamp}` } })
  await prisma.user.deleteMany({ where: { email: { in: USERS.map(u => u.email) } } })
  const left = {
    teams: await prisma.team.count({ where: { slug: teamSlug } }),
    users: await prisma.user.count({ where: { email: { in: USERS.map(u => u.email) } } }),
    links: await prisma.shareLink.count({ where: { name: { in: ['收录复制试验', '已取消的收录链接'] } } }),
    wechat: await prisma.wechatIdentity.count({ where: { openId: `wx-${stamp}` } }),
  }
  check(Object.values(left).every(n => n === 0), 'Z1 fixture 全部清干净', `→ 剩 ${JSON.stringify(left)}`)
  await prisma.$disconnect()
}

if (failures.length) {
  console.log(`\n${failures.length} 条未过：`)
  for (const f of failures) console.log(` - ${f}`)
  process.exit(1)
}
console.log('\n全部通过')
