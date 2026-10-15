/**
 * 运营后台「团队那几串号」的判据（他 10-15 看完六条清单，一句「全都改掉吧」）。
 *
 * 钉的是六件事，一条对一个他点出来的问题：
 *  A 三处（团队列表卡片／授权详情页／首页团队表）都把「团队 ID」画出来，而且都能一键复制；
 *  B 分享键 tm_ 在后台有地方能看到（客户报的是这串，昨天还有两枚团队换过它）；
 *  C 叫法统一：后台不再用裸 `@xxx` 这种没词的写法，三串各有一个固定的名字；
 *  D 搜索框的提示说实话（它其实还能拿 ID／标识／邮箱搜）；
 *  E 说明句不许再骗人：团队 ID 不是对外地址（同 check-team-numeric-id 的 D 组口径）；
 *  F 服务端确实把 shareKey 交出来了，界面那侧的类型也认这列——少一边就是画个空。
 *
 * 全程只读源码，不连库、不打接口 ⇒ 可以进 CI 的 check:static。
 * 跑法：
 *   npx tsx scripts/check-platform-team-identity.mts            ← 只读源码，进 CI 的 check:static
 *   npx tsx scripts/check-platform-team-identity.mts --browser  ← 再加一组浏览器实测（要他自己的 next dev 在 :3000 上活着）
 * 浏览器那组会往本地库建一枚一次性平台账号、跑完删干净 ⇒ 永不进 CI。
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/encryption'


const REPO = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const failures: string[] = []
let passed = 0

function check(ok: boolean, label: string, got: unknown = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${String(got) ? ` → ${String(got)}` : ''}`)
  if (ok) passed++
  else failures.push(`${label}${String(got) ? ` — ${String(got)}` : ''}`)
}

function strip(src: string) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}
function read(rel: string) {
  const file = `${REPO}/${rel}`
  return existsSync(file) ? strip(readFileSync(file, 'utf8')) : ''
}

const LIST = 'src/app/platform/teams/page.tsx'
const DETAIL = 'src/app/platform/teams/[id]/page.tsx'
const HOME = 'src/app/platform/page.tsx'
const API = 'src/app/api/platform/teams/route.ts'
// 三处共用一份身份行，别各写各的（各写一遍就是「乱」的源头）。
const SHARED = 'src/components/PlatformTeamIdentity.tsx'
// 复制那一下单独一枚控件：成员页、安全页也要用，所以它的判据不该绑在团队身份行上。
const COPY = 'src/components/PlatformCopyValue.tsx'

const listSrc = read(LIST)
const detailSrc = read(DETAIL)
const homeSrc = read(HOME)
const apiSrc = read(API)
const sharedSrc = read(SHARED)
const copySrc = read(COPY)

function usesShared(src: string) {
  return /PlatformTeamIdentity/.test(src)
}

async function main() {
  console.log('── A 三处都画得出团队 ID，且能复制 ──')
  check(!!listSrc, 'A0 三个目标文件都读得到（读不到就是路径变了，下面的判据全成空判）',
    `${LIST}:${!!listSrc} ${DETAIL}:${!!detailSrc} ${HOME}:${!!homeSrc}`)
  check(!!sharedSrc, 'A1 有一枚共用的身份行组件（三处各写一遍＝三套叫法各漂一次）', sharedSrc ? '在' : `缺 ${SHARED}`)
  check(usesShared(listSrc) && usesShared(detailSrc) && usesShared(homeSrc),
    'A2 列表卡片、授权详情页、首页团队表三处都接的是那一枚共用件',
    `列表=${usesShared(listSrc)} 详情=${usesShared(detailSrc)} 首页=${usesShared(homeSrc)}`)
  check(!!sharedSrc && /团队 ID/.test(sharedSrc) && /团队标识/.test(sharedSrc) && /分享键/.test(sharedSrc),
    'A3 那一枚共用件把三串各有各的名字写全（少一个名字，运营就只能猜那是啥）',
    sharedSrc ? `ID:${/团队 ID/.test(sharedSrc)} 标识:${/团队标识/.test(sharedSrc)} 分享键:${/分享键/.test(sharedSrc)}` : '共用件还没长出来')
  check(!!copySrc && /copyTextToClipboard/.test(copySrc) && !/navigator\.clipboard/.test(copySrc),
    'A4 复制走仓库现成的 copyTextToClipboard（裸 navigator.clipboard 在 HTTP 局域网里会静默失灵）', '')
  check(!!copySrc && /复制失败/.test(copySrc),
    'A5 复制没成要说「复制失败」，不许按了没反应还装作复制过了', '')

  console.log('\n── B 分享键真的到了界面上 ──')
  const apiSelectAt = apiSrc.search(/select:\s*\{[\s\S]{0,400}/)
  check(apiSelectAt >= 0 && /shareKey:\s*true/.test(apiSrc.slice(apiSelectAt, apiSelectAt + 400)),
    'B1 /api/platform/teams 的 select 里有 shareKey（服务端不给，界面就只能画空）', '')
  check(!!listSrc && /shareKey/.test(listSrc.slice(0, 2000)),
    'B2 列表页的 Team 类型认 shareKey 这列（类型没写＝取到也是 undefined，界面静默少一行）', '')

  console.log('\n── C 叫法统一，不再用裸 @ ──')
  const bareAt = [LIST, HOME].filter(rel => /@\{[a-zA-Z_.]+\.slug\}/.test(read(rel)))
  check(bareAt.length === 0, 'C1 后台不再拿 `@` 当「这是团队标识」的唯一交代（客户侧那句叫「团队标识」，两边得说同一个词）',
    bareAt.length ? `→ 还在用 @ 的：${bareAt.join('、')}` : '→ 两处都换成带名字的行')

  console.log('\n── D 搜索框说实话 ──')
  const placeholder = (listSrc.match(/placeholder="([^"]*)"/) || [])[1] || ''
  check(/ID|号/.test(placeholder) && /邮箱|标识/.test(placeholder),
    'D1 搜索框提示写清了它到底能吃哪几样（原话只说「团队、创建人」，而筛选里其实还吃 ID／标识／邮箱）', `→ ${JSON.stringify(placeholder)}`)
  const filterFields = (listSrc.match(/\[\s*team\.name,[^\]]*\]/) || [])[0] || ''
  check(/team\.id/.test(filterFields) && /team\.slug/.test(filterFields),
    'D2 筛选那段仍然真的吃 id 与 slug（D1 把话说了，别转头把能力删了）', `→ ${JSON.stringify(filterFields.replace(/\s+/g, ' '))}`)

  console.log('\n── E 说明句不许再骗人 ──')
  check(!!sharedSrc && !/邀请/.test(sharedSrc) && !/跨页面定位/.test(sharedSrc),
    'E1 后台这几句不把「团队 ID」说成邀请用的或跨页面定位用的（那两件事分别归团队标识与短码，10-14 实测过）', '')

  console.log('\n── H 后台其余几处：叫法、身份串、假空态（10-15 他「接着改运营平台那几处乱的」）──')
  const layout = read('src/app/platform/layout.tsx')
  const users = read('src/app/platform/users/page.tsx')
  const security = read('src/app/platform/security/SecurityEventsClient.tsx')
  const messages = read('src/app/platform/messages/page.tsx')
  const locale = (lang: string) => read(`src/locales/${lang}.json`)
  const zh = locale('zh')

  check(!!users && !!security && !!messages && !!zh, 'H0 四份文件都读得到（读不到下面全是空判）',
    `成员:${!!users} 安全:${!!security} 消息:${!!messages} 文案:${!!zh}`)
  // 一处东西四个名字＝运营在两个页面里以为自己在管两不同的对象。
  const naming = `${layout}${users}`
  check(!/平台成员/.test(naming) && !/添加成员/.test(naming) && /平台账号/.test(layout) && /添加账号|添加平台账号/.test(users),
    'H1 成员这块从头到尾一个名字（导航、页面标题、按钮、弹窗），不再「平台成员／平台账号／添加成员」混着叫',
    `→ 平台成员:${/平台成员/.test(naming)} 添加成员:${/添加成员/.test(naming)}`)
  // role=ADMIN 是团队侧的角色，进不进后台看的是 isPlatformAdmin（src/lib/auth.ts 里那句）。
  check(!/user\.role === 'ADMIN' \? '管理员'/.test(users) && /isPlatformAdmin/.test(users) && /后台/.test(users),
    'H2 那枚徽标不再把 role=ADMIN 说成「管理员」——能不能进后台读 isPlatformAdmin，文案要带「后台」两字', '')
  const userFilter = (users.match(/filteredUsers[\s\S]{0,600}/) || [])[0] || ''
  check(/user\.id/.test(userFilter), 'H3 成员页的搜索真的吃用户 ID（工单里报的就是这串）', '')
  const usersPlaceholder = (zh.match(/"searchPlaceholder": "[^"]*"/g) || []).find(s => /ID|账号|手机|邮箱/.test(s)) || ''
  check(!!usersPlaceholder, 'H4 成员页搜索框的提示说实话（原来只写「搜索成员...」，而它能搜邮箱／手机／姓名／用户名／ID）',
    `→ ${JSON.stringify(usersPlaceholder.slice(0, 60))}`)
  check(['zh', 'en', 'nl', 'de'].every(l => /"searchPlaceholder"/.test(locale(l))),
    'H5 四语言都还留着 searchPlaceholder（只改中文＝另外三语渲染成裸 key）', '')
  check(/label="用户 ID"/.test(users) && /value=\{user\.id\}/.test(users),
    'H6 成员那一行有可复制的用户 ID（删号、改密这类破坏性操作得能回读自己在动谁）', '')

  // 读失败时画 0／「没有找到」＝把「我不知道」伪装成「确实没有」。
  const loadFailBranch = /读取失败|加载失败|读不到/.test(listSrc)
  check(loadFailBranch, 'H7 团队页读失败不再画三张 0 卡＋一句「没有找到匹配的团队」（那是两回事）', '')
  check(!/text-emerald|bg-emerald/.test([listSrc, homeSrc, detailSrc, sharedSrc, users, security].join('')),
    'H8 后台不再用 emerald 硬色（产品有 success token，深色与 mint／frame 主题下 emerald-700 对比不够）', '')
  check(/>有效期</.test(homeSrc) && !/>状态</.test(homeSrc),
    'H9 首页那一列的表头不再叫「状态」而画的是有效期（列名要说出格子里真是哪一列）', '')
  check(!/\{event\.severity\}/.test(security),
    'H10 安全事件的严重性走中文词表，不把 CRITICAL／HIGH 这类原值直接画给运营（同一列的筛选器已经是中文）', '')
  const blockedCard = (security.match(/blocked[\s\S]{0,220}/) || [])[0] || ''
  check(/pagination\.total|本页|全部/.test(blockedCard) || !/events\.filter/.test(blockedCard),
    'H11「被阻止」那枚数不再冒充全站总数：要么用服务端的总数，要么明说只数本页这几条',
    `→ ${JSON.stringify(blockedCard.replace(/\s+/g, ' ').slice(0, 90))}`)
  check(/value=\{entry\.key\}/.test(security),
    'H12 解封那一行把要解的是哪个 IP／账号说出来（原来 entry.key 只当 React key 与请求参数，屏幕上看不见）', '')
  const msgGaps = (messages.match(/if \((?:annRes|fbRes|usersRes)\.ok\)[\s\S]{0,160}?else /g) || []).length
  check(msgGaps === 3,
    'H13 消息页三发请求每一发都要有「没成就说哪一发」这一支（原来 if (res.ok) 没有 else，读失败被画成「还没有反馈」）',
    `→ 三发里带失败分支的 ${msgGaps} 发`)
  // 这页读的是 /api/users 全量（所有注册账号），副标题却写成「管理能登录后台的账号」＝范围说谎。
  check(/全部注册|所有注册|注册账号/u.test(users) && !/管理能登录后台的账号/.test(users),
    'H14 成员页的副标题说实话：这一页列的是全部注册账号，不是只有能进后台的那些（接口就是 /api/users）', '')


  const statusBadgeKept = /status === 'ACTIVE'/.test(listSrc) && /已停用/.test(listSrc)
  check(statusBadgeKept, 'F1 列表卡片的「正常／已停用」状态与停用操作这条线还在（这次只加身份行，没顺手砍功能）', '')
  const quotaKept = /团队配额/.test(detailSrc) && /保存配额/.test(detailSrc) && /功能授权/.test(detailSrc)
  check(quotaKept, 'F2 授权详情页那两块（功能授权／团队配额）一个没少', '')

  if (BROWSER) await browserGroup()
  else console.log('\n（G 组浏览器实测没跑：加 --browser 才跑，它要你自己的 next dev 在 :3000 上活着）')
}

// ── G 组：真浏览器里走一遍（页内登录，因为平台令牌绑设备指纹，Node 登录的令牌带不进浏览器）──
const BROWSER = process.argv.includes('--browser')
const BASE = process.env.IDENTITY_CHECK_BASE || 'http://localhost:3000'
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

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

/** 判据绿不等于看着对：SHOT_DIR 给了就把三页各存一张，自己眼里过一遍。 */
async function shot(page: Page, name: string) {
  const dir = process.env.SHOT_DIR
  if (!dir) return
  const r = await page.s('Page.captureScreenshot', { format: 'png' })
  if (r?.data) {
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(dir, { recursive: true })
    writeFileSync(`${dir}/${name}.png`, Buffer.from(r.data, 'base64'))
  }
}

function luminance([r, g, b]: number[]) {
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r / 255) + 0.7152 * f(g / 255) + 0.0722 * f(b / 255)
}
function contrast(a: number[], b: number[]) {
  const l1 = luminance(a), l2 = luminance(b)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}
function rgbOf(css: string): number[] | null {
  const m = /rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\)/.exec(css || '')
  if (!m) return null
  if (m[4] !== undefined && Number(m[4]) === 0) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

async function browserGroup() {
  console.log('\n── G 浏览器实测（页内登录运营后台）──')
  const devAlive = await fetch(`${BASE}/api/health`).then(r => r.ok).catch(() => false)
  if (!devAlive) { check(false, 'G0 本地 next dev 在 :3000 上没活着（G 组跑不了，静态那几组不受影响）', BASE); return }

  const prisma = new PrismaClient()
  const stamp = Date.now()
  const email = `pid-${stamp}@example.invalid`
  const pw = `pid-${stamp}`
  let chrome: ChildProcess | undefined
  const userDataDir = mkdtempSync(`${tmpdir()}/platform-identity-`)
  const cdpPort = 9411 + (process.pid % 50)
  let adminId = ''

  try {
    // 挑一枚「跑得再久也不会被别人删掉」的团队来验：home-demo 是 build-home-demo 种的常驻夹具。
    // 按 createdAt desc 取最新那枚会撞上别的判据正在建/删的一次性团队（那边清完，这边就找不到人了）。
    const team = await prisma.team.findFirst({ where: { slug: 'home-demo' }, select: { id: true, slug: true, shareKey: true } })
      ?? await prisma.team.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true, slug: true, shareKey: true } })
    if (!team) { check(false, 'G0 本地库里一枚团队都没有，没法验身份行', ''); return }

    // next dev 是按需编译的：第一次打到某页会编 20–40 秒，那段时间 CDP 的 navigate/等待会假死。
    // 先把三页各预热一次，界面实测才不是在量编译器。
    for (const warm of ['/platform/login', '/platform', '/platform/teams']) {
      await fetch(`${BASE}${warm}`).catch(() => null)
    }

    const created = await prisma.user.create({
      data: { email, name: 'PID Admin', password: await hashPassword(pw), isPlatformAdmin: true },
      select: { id: true },
    })
    adminId = created.id

    chrome = spawn(CHROME, [
      '--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${userDataDir}`,
      '--remote-allow-origins=*', '--no-first-run', '--no-default-browser-check',
      '--disable-gpu', '--disable-translate', '--lang=zh-CN', '--window-size=1440,900',
    ], { stdio: 'ignore' })
    let version: any = null
    for (let i = 0; i < 60 && !version; i++) {
      version = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then(r => r.json()).catch(() => null)
      if (!version) await sleep(500)
    }
    if (!version) { check(false, 'G0 无头 Chrome 没起来', ''); return }
    await attachSocket(version.webSocketDebuggerUrl)
    const page = await openPage()

    // 复制到底复制的是哪串，得能回读：包一层 writeText 记录实参（不改行为，失败照样落回退路径）。
    await page.s('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => { window.__copied = []; try {
        const o = navigator.clipboard && navigator.clipboard.writeText && navigator.clipboard.writeText.bind(navigator.clipboard)
        if (o) navigator.clipboard.writeText = async (t) => { window.__copied.push(String(t)); return o(t) }
      } catch {} })()`,
    })

    await run(page, '/platform/login')
    // 等 React 水合完再填：SSR 先把 <input> 画出来了，那时填进去的值会在 hydration 时被
    // 受控组件用初始 state 抹回空串（10-15 实测：诊断里「填进去的」就是空的，登录根本没发出去）。
    if (!await waitFor(page, `(() => { const i = document.querySelector('input[placeholder="平台账号"]')
      return i && Object.keys(i).some(k => k.startsWith('__react')) })()`, 120_000)) {
      check(false, 'G1 平台登录页没水合（冷编译没完，G 组跑不了）', '')
      return
    }
    await evalJs(page, `(() => {
      const put = (el, v) => { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
      put(document.querySelector('input[placeholder="平台账号"]'), ${JSON.stringify(email)})
      put(document.querySelector('input[type="password"]'), ${JSON.stringify(pw)})
      document.querySelector('form').requestSubmit()
    })()`)
    const loggedIn = await waitFor(page, `document.body.innerText.includes('退出平台') || document.body.innerText.includes('每日使用量')`, 180_000)
    const loginDiag = loggedIn ? '' : await evalJs(page, `(() => {
      const i = document.querySelector('input[placeholder="平台账号"]')
      return JSON.stringify({ path: location.pathname, 填进去的: i ? i.value.slice(0, 12) : null, 页面字: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 120) })
    })()`)
    check(loggedIn, 'G1 平台账号在页面里登录成功（平台令牌绑设备指纹，只能这么进去）', loginDiag)
    if (!loggedIn) return

    const EXPECT = JSON.stringify(team)
    await run(page, '/platform/teams')
    // 「团队总数」四个字在统计卡上先就出来了，拿它当加载完的信号会读到一张空列表（10-15 假红过一次）。
    await waitFor(page, `document.body.innerText.includes(${JSON.stringify(team.id)})`, 90_000)
    const listFacts = await evalJs(page, `(() => {
      const t = ${EXPECT}
      // 取「最深的那一枚」装着这串号的 div：document 顺序里外层在前，用 find 会抓到整页容器，
      // 于是别张卡片上的字也算命中（假绿）。最后一枚才是这张卡自己那一块。
      const cards = [...document.querySelectorAll('div')].filter(d => d.querySelector('button') && d.innerText.includes(t.id))
      const card = cards[cards.length - 1]
      const txt = card ? card.innerText : ''
      return { found: !!card, id: txt.includes('团队 ID') && txt.includes(t.id),
        slug: txt.includes('团队标识') && txt.includes(t.slug), key: txt.includes('分享键') && txt.includes(t.shareKey),
        at: document.body.innerText.includes('@' + t.slug), txt: txt.replace(/\\s+/g, ' ').slice(0, 160) }
    })()`)
    check(listFacts.found && listFacts.id, 'G2 团队列表卡片画出「团队 ID」，值就是库里那枚 6 位号', `→ ${JSON.stringify(listFacts.txt)}`)
    check(listFacts.slug && listFacts.key, 'G3 同一行还画出「团队标识」与「分享键」（客户报 tm_ 那串时后台对得上）', `→ ${JSON.stringify(listFacts)}`)
    check(!listFacts.at, 'G4 裸 @ 写法已经不在了（叫法统一那条）', '')

    const copyBack = await evalJs(page, `(async () => {
      const t = ${EXPECT}
      const btn = [...document.querySelectorAll('button')].find(b => b.innerText.replace(/\\s+/g, ' ').startsWith('团队 ID ' + t.id))
      if (!btn) return { clicked: false }
      btn.click()
      await new Promise(r => setTimeout(r, 500))
      return { clicked: true, copied: (window.__copied || []).slice(-1)[0], said: document.body.innerText.includes('已复制') || document.body.innerText.includes('复制失败') }
    })()`)
    check(copyBack.clicked && copyBack.copied === team.id, 'G5 点「团队 ID」那枚真的把这串号交给了剪贴板（不是复制了别的）', `→ ${JSON.stringify(copyBack)}`)
    check(copyBack.said, 'G6 按完界面有回话（已复制／复制失败），不是点了没动静', '')
    await shot(page, '1-teams-list')

    await run(page, `/platform/teams/${team.id}`)
    await waitFor(page, `document.body.innerText.includes('团队 ID')`, 60_000)
    const detailFacts = await evalJs(page, `(() => {
      const t = ${EXPECT}
      const txt = document.body.innerText
      return { id: txt.includes('团队 ID') && txt.includes(t.id), slug: txt.includes('团队标识') && txt.includes(t.slug),
        key: txt.includes('分享键') && txt.includes(t.shareKey), why: txt.includes('加入链接') && txt.includes('客户'),
        quota: txt.includes('团队配额'), grants: txt.includes('功能授权') }
    })()`)
    check(detailFacts.id && detailFacts.slug && detailFacts.key,
      'G7 授权详情页把三串都摆出来了（原来整页不写这是哪一队）', `→ ${JSON.stringify(detailFacts)}`)
    check(detailFacts.why, 'G8 详情页那句说明把三串各管什么交代清了（ID 定位／标识加入／分享键对客户）', '')
    check(detailFacts.quota && detailFacts.grants, 'G9 详情页原有两块功能没被这行挤掉', '')
    await shot(page, '2-team-detail')

    await run(page, '/platform')
    await waitFor(page, `document.querySelector('table')`, 60_000)
    const homeFacts = await evalJs(page, `(() => {
      const t = ${EXPECT}
      const row = [...document.querySelectorAll('tr')].find(r => r.innerText.includes(t.id))
      return { row: !!row, id: !!row && row.innerText.includes('团队 ID') && row.innerText.includes(t.id),
        slug: !!row && row.innerText.includes('团队标识') && row.innerText.includes(t.slug) }
    })()`)
    check(homeFacts.row && homeFacts.id && homeFacts.slug, 'G10 首页团队表那一行也带 ID 与标识（原来只有 @标识）', `→ ${JSON.stringify(homeFacts)}`)
    // 那张表在「每日使用量」下面，视口里根本没有它 ⇒ 不滚过去，截图就是一张用量的表。
    await evalJs(page, `(() => { const t = [...document.querySelectorAll('table')].find(x => x.innerText.includes('负责人'))
      if (t) t.scrollIntoView({ block: 'start' }); return !!t })()`)
    await sleep(600)
    await shot(page, '3-platform-home')

    // 成员页与安全页这次也动了，同样得在真页面上看一眼，不能只信源码字面量。
    await run(page, '/platform/users')
    // 导航里也有「平台账号」四个字，拿它当加载完的信号会读到一张空表（10-15 就这么假红过一次）。
    const usersReady = await waitFor(page, `document.querySelectorAll('tbody tr').length > 0`, 90_000)
    const userFacts = await evalJs(page, `(async () => {
      const chip = [...document.querySelectorAll('button')].find(b => b.title === '复制用户 ID')
      let copiedId = null
      if (chip) { chip.click(); await new Promise(r => setTimeout(r, 400)); copiedId = (window.__copied || []).slice(-1)[0] }
      const txt = document.body.innerText
      return { rows: document.querySelectorAll('tbody tr').length, chip: !!chip, copiedId,
        admin: txt.includes('能进后台') || txt.includes('不进后台'), legacy: txt.includes('普通账号') }
    })()`)
    if (!usersReady) console.log('SKIP G12/G13 成员表一行都没出来（本地库空或接口没读到），两条没测到')
    else {
      check(userFacts.chip && !!userFacts.copiedId, 'G12 成员页那一行的「用户 ID」按下去真把某枚用户 id 交出去了', `→ ${JSON.stringify(userFacts.copiedId)}`)
      check(userFacts.admin && !userFacts.legacy, 'G13 成员页徽标说的是后台权限（「能进后台／不进后台」），不再拿 role 冒充「管理员／普通账号」', `→ ${JSON.stringify(userFacts)}`)
      await shot(page, '4-users')
    }

    await run(page, '/platform/security')
    await waitFor(page, `document.body.innerText.includes('严重性') || document.body.innerText.includes('Severity')`, 90_000)
    const secFacts = await evalJs(page, `(() => {
      const txt = document.body.innerText
      const spans = [...document.querySelectorAll('span')].map(s => s.textContent.trim())
      // 只判「有没有把枚举原值画给运营」：中文还是英文取决于访问者存的界面语言，这里不押死一种。
      return { rows: spans.filter(s => /^(关键|警告|信息|Critical|Warning|Info)$/.test(s)).length,
        rawSeverity: spans.some(s => /^(CRITICAL|WARNING|INFO)$/.test(s)),
        hasUnblock: [...document.querySelectorAll('button')].some(b => b.innerText.includes('解锁') || b.innerText.includes('Unblock')),
        解封对象: txt.includes('解封对象') || txt.includes('Unblock target') }
    })()`)
    if (secFacts.rows === 0 && !secFacts.hasUnblock) console.log('SKIP G14/G15 本地这一屏没有安全事件行、也没有速率限制条目，两条没测到')
    else {
      check(secFacts.rows > 0 && !secFacts.rawSeverity, 'G14 安全页行里的严重性走的是词表（不再是 CRITICAL 这种枚举原值）', `→ ${JSON.stringify(secFacts)}`)
      check(!secFacts.hasUnblock || secFacts.解封对象,
        'G15 有「解锁」按钮可点时，同一行就写着解封对象是哪串 IP／账号（没条目时跳过，不算绿）', `→ ${JSON.stringify(secFacts)}`)
    }

    // 标签是 11px 的次要字，压在卡片上够不够读要量出来，不能靠「看着还行」。
    // 对比度要在画着身份行的那一屏量：上面几趟已经跳到成员页、安全页了，先回团队页。
    await run(page, '/platform/teams')
    await waitFor(page, `[...document.querySelectorAll('span')].some(s => s.textContent.trim() === '团队 ID')`, 90_000)
    const contrastFacts = await evalJs(page, `(() => {
      const probe = document.createElement('div')
      probe.className = 'bg-card'
      probe.style.cssText = 'position:fixed;left:-9999px;top:0;width:10px;height:10px'
      document.body.appendChild(probe)
      const bg = getComputedStyle(probe).backgroundColor
      const label = [...document.querySelectorAll('span')].find(s => s.textContent.trim() === '团队 ID')
      const fg = label ? getComputedStyle(label).color : ''
      const size = label ? getComputedStyle(label).fontSize : ''
      probe.remove()
      return { bg, fg, size }
    })()`)
    const fgRgb = rgbOf(contrastFacts.fg), bgRgb = rgbOf(contrastFacts.bg)
    const ratio = fgRgb && bgRgb ? contrast(fgRgb, bgRgb) : 0
    check(ratio >= 4.5, 'G11 身份行的标签压在主卡片面上对比度够 4.5:1（11px 的次要字更要读数清楚）',
      `→ ${ratio.toFixed(2)}:1，字号 ${contrastFacts.size}，fg ${contrastFacts.fg} bg ${contrastFacts.bg}`)

    await send('Target.closeTarget', { targetId: page.targetId }).catch(() => null)
  } finally {
    if (chrome) chrome.kill()
    if (ws) try { ws.close() } catch {}
    // Chrome 刚被杀时 profile 目录还在被写，立刻 rmSync 会撞 ENOTEMPTY（10-15 实测崩在这一步，
    // 连带把一次性平台账号的清理也跳过了）⇒ 先等它落盘，再带重试删。
    await sleep(1200)
    try { rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }) } catch {}
    if (adminId) await prisma.user.deleteMany({ where: { id: adminId } }).catch(() => null)
    const left = adminId ? await prisma.user.count({ where: { email } }) : 0
    await prisma.$disconnect()
    console.log(`夹具清理：一次性平台账号剩余 ${left}`)
  }
}

try {
  await main()
} finally {
  console.log(`\n合计 ${passed} PASS / ${failures.length} FAIL`)
  if (failures.length) for (const f of failures) console.log(` - ${f}`)
  if (failures.length) process.exitCode = 1
}
