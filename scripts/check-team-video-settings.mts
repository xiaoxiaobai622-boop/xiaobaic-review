import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/encryption'

/**
 * 他 10-14 报的「点击视频设置没有反应」。
 *
 * 侧栏那行是通的（TeamAdminShell 里 href=/studio/team/settings，路由也在），断的是页面自己的守卫：
 * 36d8338 把「非管理员才弹走」反写成「能编辑就弹走」，于是负责人和管理员一进 /studio/team/settings
 * 就被 router.replace 送回团队概览——看上去就是点不动。
 *
 * 口径：管理员（OWNER＋ADMIN）点进去要真的坐在表单里（V2/V3/V3b/V3c），普通成员拿不到表单（V4b/V4c）。
 * V5 是源码形状，不依赖跑着的服务：那条 replace 只许在 canEdit 为假时跑，且会话没落地之前不许弹人。
 *
 * 登录在浏览器里做（会话指纹绑设备头＋UA，Node 侧令牌在浏览器一刷就烧掉整枚会话）。
 * 页面里跑的代码不写反斜杠：模板字面量会吃掉它们。
 * 会往本地库建一次性团队与三个账号，跑完删干净 ⇒ 不进 CI。
 */
const BASE = process.env.TVS_CHECK_BASE || 'http://localhost:3000'
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const prisma = new PrismaClient()
const stamp = Date.now()
const teamSlug = `tvs-${stamp}`
const pw = `tvs-${stamp}`
const cdpPort = 9300 + (stamp % 600)
const userDataDir = join(tmpdir(), `tvs-${stamp}`)
const emails = [
  `tvs-owner-${stamp}@example.invalid`,
  `tvs-admin-${stamp}@example.invalid`,
  `tvs-member-${stamp}@example.invalid`,
]
const failures: string[] = []
const tokens: string[] = []
let passed = 0
let chrome: ChildProcess | undefined
let teamId = ''

function check(ok: boolean, label: string, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` → ${detail}` : ''}`)
  if (ok) passed++
  else failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

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

/** requireApiUser 硬要绑过手机号，User.phone 又是唯一键 ⇒ 每人发一枚没被占用的号。 */
async function makeUser(email: string, name: string) {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      return await prisma.user.create({
        data: {
          email, name, password: await hashPassword(pw),
          phone: `19${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`,
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

/** 真鼠标：他点的就是侧栏那一行，el.click() 既绕不过 Next 的 Link 拦截，也不改 activeElement。 */
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

const SIDEBAR_LINK = `[...document.querySelectorAll('a[href="/studio/team/settings"]')].filter(a => a.offsetParent !== null)[0]`
const SAVE_BUTTON = `[...document.querySelectorAll('button')].filter(b => b.offsetParent !== null && b.textContent.includes('保存设置'))[0]`

/** 一帧的状态：落在哪条路、表单在不在、标题写的是什么。 */
async function frame(page: Page) {
  return JSON.parse(String(await evalJs(page, `JSON.stringify({
    path: location.pathname,
    form: Boolean(${SAVE_BUTTON}),
    heading: [...document.querySelectorAll('h1')].map(h => h.textContent.trim()).filter(Boolean)[0] || '',
  })`))) as { path: string; form: boolean; heading: string }
}

/** 点完连续采 12 秒：「表单画出来又被打回概览」这条路只有轨迹能看见，取一个时刻量不准。 */
async function trace(page: Page, ms = 12_000) {
  const seen: string[] = []
  const end = Date.now() + ms
  let last = ''
  let final = await frame(page)
  while (Date.now() < end) {
    final = await frame(page)
    const key = `${final.path}${final.form ? '+form' : ''}${final.heading ? `#${final.heading}` : ''}`
    if (key !== last) { seen.push(key); last = key }
    await sleep(250)
  }
  return { seen, final }
}

async function browserLogin(page: Page, email: string, deviceId: string, activeTeamId: string) {
  await page.s('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.setItem('vitransfer_device_id', ${JSON.stringify(deviceId)}); localStorage.setItem('vitransfer_active_team_id', ${JSON.stringify(activeTeamId)})`,
  })
  await run(page, '/login')
  if (!await waitFor(page, 'document.body && document.body.children.length > 0', 90_000)) return '登录页没画出来'
  return String(await evalJs(page, `(async () => {
    const r = await fetch('/api/auth/login', { method: 'POST', cache: 'no-store',
      headers: { 'content-type': 'application/json', 'X-ViTransfer-Device-ID': ${JSON.stringify(deviceId)} },
      body: JSON.stringify({ email: ${JSON.stringify(email)}, password: ${JSON.stringify(pw)} }) })
    const j = await r.json().catch(() => null)
    if (j?.tokens?.refreshToken) localStorage.setItem('vitransfer_refresh_token', j.tokens.refreshToken)
    localStorage.setItem('vitransfer_active_team_id', ${JSON.stringify(activeTeamId)})
    return r.status + ' ' + (j?.tokens?.refreshToken ? 'session' : 'no-session')
  })()`))
}

async function main() {
  // ── V5 源码形状（不需要跑着的服务，先把反写的守卫钉住）──────────────────
  const source = readFileSync(fileURLToPath(new URL('../src/app/studio/team/settings/page.tsx', import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const replaceAt = source.search(/router\.replace\(\s*['"]\/studio\/team['"]\s*\)/)
  const guard = replaceAt > 0 ? source.slice(Math.max(0, replaceAt - 320), replaceAt) : ''
  check(replaceAt > 0, 'V5a 页面里确实有那条弹回团队概览的 replace', `→ @${replaceAt}`)
  check(replaceAt > 0 && !/if\s*\(\s*!canEdit\s*\)\s*return/.test(guard),
    'V5b 那条 replace 不许由「能编辑就走」触发（36d8338 就是这么反写的）',
    `→ 前 320 字符里命中 !canEdit-return：${/if\s*\(\s*!canEdit\s*\)\s*return/.test(guard)}`)
  check(replaceAt > 0 && /if\s*\(\s*canEdit\s*\)\s*return/.test(guard),
    'V5c 守卫写成「能编辑就留下」', '')
  check(replaceAt > 0 && /if\s*\(\s*!user\s*\)\s*return/.test(guard),
    'V5d 会话还没落地之前不许弹人（user 为空的瞬间 canEdit 也是假，会误伤管理员）', '')

  // ── 夹具 ────────────────────────────────────────────────────────────────
  const owner = await makeUser(emails[0], 'TVS Owner')
  const admin = await makeUser(emails[1], 'TVS Admin')
  const member = await makeUser(emails[2], 'TVS Member')
  const team = await prisma.team.create({
    data: {
      name: teamSlug, slug: teamSlug, shareKey: teamSlug, createdById: owner.id, subscriptionPlan: 'BETA',
      members: { create: [
        { userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
        { userId: admin.id, role: 'ADMIN', status: 'ACTIVE' },
        { userId: member.id, role: 'MEMBER', status: 'ACTIVE' },
      ] },
    },
  })
  teamId = team.id

  // 接口层顺手一条：表单拿的是 /api/team-settings，成员读它不为错、写它得拒
  const memberToken = await login(member.email)
  const ownerToken = await login(owner.email)
  const readAsMember = await fetch(`${BASE}/api/team-settings`, { headers: { authorization: `Bearer ${memberToken}`, 'X-Team-Id': team.id }, cache: 'no-store' })
  const writeAsMember = await fetch(`${BASE}/api/team-settings`, {
    method: 'PATCH', cache: 'no-store',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${memberToken}`, 'X-Team-Id': team.id },
    body: JSON.stringify({ defaultApplyPreviewLut: false }),
  })
  check(readAsMember.ok && writeAsMember.status === 403,
    'V6 成员读得到团队默认值、但写不进去（界面挡住了，接口那层也得挡住）',
    `→ 读 ${readAsMember.status}，写 ${writeAsMember.status}`)
  const readAsOwner = await fetch(`${BASE}/api/team-settings`, { headers: { authorization: `Bearer ${ownerToken}`, 'X-Team-Id': team.id }, cache: 'no-store' })
  check(readAsOwner.ok, 'V6b 负责人读 /api/team-settings 是 200', `→ ${readAsOwner.status}`)

  for (const p of ['/login', '/studio/team', '/studio/team/settings']) {
    const status = await fetch(`${BASE}${p}`, { cache: 'no-store', redirect: 'manual' })
      .then(r => String(r.status)).catch(e => `预热失败 ${(e as Error).message}`)
    console.log(`预热 ${p} → ${status}`)
  }

  chrome = await connectChrome()
  const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then(r => r.json())
  await attachSocket(webSocketDebuggerUrl)

  // ── V2/V3：负责人与管理员点侧栏那一行，要坐在表单里 ─────────────────────
  for (const [role, user] of [['OWNER', owner], ['ADMIN', admin]] as const) {
    const page = await openPage()
    const out = await browserLogin(page, user.email, `tvs-${role}-${stamp}`, team.id)
    check(/^200 session$/.test(out), `V1-${role} 浏览器内登录`, `→ ${out}`)
    await run(page, '/studio/team')
    check(await waitFor(page, SIDEBAR_LINK, 120_000), `V1b-${role} 侧栏「视频设置」那行画出来了`)
    await sleep(1_500)
    console.log(`  ${role} 点侧栏 → ${await realClick(page, SIDEBAR_LINK)}`)
    const t = await trace(page)
    console.log(`  ${role} 轨迹 ${JSON.stringify(t.seen)}`)
    check(t.final.path === '/studio/team/settings',
      `V2-${role} 点完停在 /studio/team/settings（没被弹回团队概览）`,
      `→ 终点 ${t.final.path}，轨迹 ${JSON.stringify(t.seen)}`)
    check(t.final.form === true,
      `V3-${role} 表单真画出来了（有「保存设置」那枚按钮，不是加载壳）`,
      `→ heading ${JSON.stringify(t.final.heading)}`)

    // 直达同一地址也得是表单：只修点击不修直达就是半套。
    await run(page, '/studio/team/settings')
    check(await waitFor(page, `Boolean(${SAVE_BUTTON})`, 60_000), `V3b-${role} 直接输地址也坐在表单里`)
    const direct = await frame(page)
    check(direct.path === '/studio/team/settings', `V3c-${role} 直达之后地址没被换掉`, `→ ${direct.path}`)
    await send('Target.closeTarget', { targetId: page.targetId })
  }

  // ── V4：普通成员拿不到表单 ──────────────────────────────────────────────
  const page = await openPage()
  const memberLogin = await browserLogin(page, member.email, `tvs-MEMBER-${stamp}`, team.id)
  check(/^200 session$/.test(memberLogin), 'V4a 成员浏览器内登录', `→ ${memberLogin}`)
  await run(page, '/studio/team/settings')
  await sleep(3_000)
  const t = await trace(page)
  console.log(`  成员轨迹 ${JSON.stringify(t.seen)}`)
  check(t.final.form === false, 'V4b 成员最后看不到「保存设置」', `→ 终点 ${JSON.stringify(t.final)}`)
  check(!t.seen.some(s => s.includes('+form')),
    'V4c 成员这一路连一瞬间都没落到表单上', `→ 轨迹 ${JSON.stringify(t.seen)}`)

  console.log(`\n合计 ${passed} PASS / ${failures.length} FAIL`)
  if (failures.length) for (const f of failures) console.log(` - ${f}`)
  if (failures.length) process.exitCode = 1
}

main().catch((error) => {
  console.error('判据跑挂：', error)
  process.exitCode = 1
}).finally(async () => {
  for (const t of tokens) await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${t}` } }).catch(() => null)
  chrome?.kill()
  rmSync(userDataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 300 })
  if (teamId) {
    await prisma.teamSettings.deleteMany({ where: { teamId } }).catch(() => null)
    await prisma.project.deleteMany({ where: { teamId } }).catch(() => null)
    await prisma.team.delete({ where: { id: teamId } }).catch(() => null)
  }
  await prisma.user.deleteMany({ where: { email: { in: emails } } }).catch(() => null)
  const left = await prisma.user.count({ where: { email: { in: emails } } }).catch(() => -1)
  const teamLeft = await prisma.team.count({ where: { slug: teamSlug } }).catch(() => -1)
  await prisma.$disconnect()
  console.log(`夹具清理：剩余团队行 ${teamLeft}，剩余账号 ${left}`)
})
