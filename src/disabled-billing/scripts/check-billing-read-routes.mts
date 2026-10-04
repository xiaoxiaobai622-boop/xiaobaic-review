/**
 * Task 7 gate：账单**读面**的三个接口 + Task 6 写侧边界的对照。
 *
 *   - `GET  /api/billing/orders`            列表（订单 + 可售套餐 + 当前权益）
 *   - `GET  /api/billing/orders/:id/intent` 对公转账说明（收款字段唯一出口）
 *   - `GET  /api/billing/transfer/qr`       团队侧收款码字节
 *
 * 两种传输层，同一份断言（与 `check-billing-orders-route.mts` 同形）：
 *   1. 同进程（默认）：`import { GET }` 真路由，自己造 NextRequest（真 bearer 令牌 + 真 x-team-id）。
 *   2. 真 HTTP（给 `BILLING_CHECK_BASE_URL`）：同样的矩阵打到他正在跑的 `next dev`。
 *
 *   npx tsx --env-file=.env src/disabled-billing/scripts/check-billing-read-routes.mts
 *   BILLING_CHECK_BASE_URL=http://localhost:3000 \
 *     npx tsx --env-file=.env src/disabled-billing/scripts/check-billing-read-routes.mts
 *
 * `--env-file=.env` 是必须的：tsx 不自动读 .env，而 `src/lib/auth.ts` 在模块加载时就取 JWT_SECRET。
 * 真 HTTP 模式只往**用户自己起的** dev server 发请求 —— 不启进程、不跑 build。
 *
 * ---------------------------------------------------------------------------
 * 覆盖面（brief Step 4 的五个子弹 + 任务书追加的六条）
 * ---------------------------------------------------------------------------
 * A 段用**当前的真实配置**跑：`Settings` 那五列全 NULL、库里没有收款码文件 —— 503 与「尚未上传收款码」
 * 404 这两条分支是免费的，而它们恰恰是本任务最容易写错的两条（fall through 成 500 / 忘了 fileExists）。
 * B 段要证明 200 那两条（intent 拿到账号、收款码拿到图），只能临时把收款配置填上：
 * 全程快照/还原 `Settings` 整行（含 `updatedAt`，走 `$executeRaw` 还原）与 `uploads/` 目录清单，
 * 还原后**读回逐字节比对**并打日志。写配置用的是脚本自造的临时身份，跑完连人带单一起删。
 * B 段前有一道**守卫**（不是断言）：跑前那五行已经是配置态 ⇒ 整段 SKIP 且不记失败（A1/I-1）；
 * `STORAGE_ROOT` 未设时 uploads 指纹与收款码文件同样诚实跳过（B4/M-7）。
 *
 * ---------------------------------------------------------------------------
 * 中断这一脚本的代价（跑之前读这段；Task 11 拿它做演示的人更要读）
 * ---------------------------------------------------------------------------
 * SIGINT / SIGTERM 是**协作式**的：处理器只置位，清场统一由 `main()` 的 finally 执行，所以按一次
 * Ctrl-C 不会立刻退出 —— A 段会跑完，B 段在每一次写入前逐点短路，最后以 130 退出并还原。
 * 这是有意的：在半途还原之后又写回假账号，正是这一版修掉的那个洞（A2/I-2）。
 *
 * 唯一能绕过这套 finally 的是 **SIGKILL**（`kill -9`）。它落在 B 段中间的后果现在**会自愈**：
 * 那一行 `Settings` 会暂时冻在脚本自造的假收款账户上（`transferAccountNo = '6222020200000123'`），
 * 而在这个窗口里任何真实团队的 `GET /api/billing/orders/:id/intent` 都会把假账号当收款目标发出去 ——
 * 所以下一轮跑动在**指纹与快照之前**先认一次「五列里有没有本脚本自己的那几枚字面量」，命中就把那
 * 五列一起置回 `NULL` 并打一行自愈日志，然后照常走 A1 守卫（`healStaleFakeSettings()`）。
 * **SIGKILL 仍然是禁用的**：自愈只管得了 `Settings` 这一行，一次性身份 / 测试套餐 / 测试订单 /
 * `uploads/` 里的测试收款码 / Redis 会话键都不在它的范围内，那些要靠 finally。
 *
 * 手工救法留作**兜底**（只在全新一跑没能自愈时才需要；本地 dev 库，`Settings` 是单行表，主键恒为 `'default'`）：把
 * `transferAccountName` / `transferAccountNo` / `transferBank` / `transferNote` / `transferQrPath`
 * 五列一起置 `NULL`（用你惯用的方式：`psql` 或一次性 tsx 脚本都行），
 * 然后**必须读回核对**：`prisma.settings.findUnique({ where: { id: 'default' } })` 里这五列全为 `null`。
 * 五列一起清的理由是恢复的是**跑前那个状态**，不是随便挑一个能骗过界面的子集：
 * `getTransferConfig()`（`src/lib/settings.ts`）的 `configured` 只看 `户名 && 账号` 两枚，
 * 少清一枚就还是「已配置」；而 A1 守卫还额外要求 `transferQrPath` 为 `null`，
 * 残留那个键会让下一轮继续 SKIP B 段。清完再跑本脚本，A1 会重新放行 B 段。
 *
 * 命名空间（Task 6 的脚本扫 `billing-orders-check-` 与 `BCHECK-HTTP`，本脚本换成另一套前缀，
 * 两边互删不着）：
 *   - User  邮箱 `billing-orders-list-check-*@example.invalid`
 *   - Team  slug 前缀 `billing-orders-list-check-`
 *   - Plan  `BCHECK-LIST` / `BCHECK-LIST9`（有价）、`BCHECK-LIST0`（0 价）、`BCHECK-LISTOFF`（active=false）
 *   - Order 只挂在上面这些团队/套餐下
 *   - 文件  `uploads/branding/bcheck-qr.{png,jpg}`（B 段自造自删）
 *
 * 足迹核对：跑前跑后各读一次指纹（库里七张表逐行逐字节 + Redis 五类键），既有行/既有会话要求
 * 一枚不少、一字节不变。口令是脚本自己造的随机值，跑完连账号一起删；不写文件、不打日志。
 */
import { createHash, randomUUID } from 'crypto'
import { mkdir, readdir, stat, unlink, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { PrismaClient } from '@prisma/client'
import { NextRequest } from 'next/server'
import { GET as GET_ORDERS, POST as POST_ORDERS } from '../app/api/billing/orders/route'
import { GET as GET_INTENT } from '../app/api/billing/orders/[id]/intent/route'
import { GET as GET_QR } from '../app/api/billing/transfer/qr/route'
import { issueAdminTokens, verifyCredentials } from '@/lib/auth'
import { prisma as appPrisma } from '@/lib/db'
import { getRedis } from '@/lib/redis'
import { revokeAdminSession } from '@/lib/studio-session-registry'
import { hashPassword } from '@/lib/encryption'
import { reportOrderPaid } from '@/disabled-billing/lib/billing'
import { getTransferConfig } from '@/lib/settings'

const PRICE_A = 19900
const PRICE_B = 59800
const PLAN_A = 'BCHECK-LIST'      // 有价、sort 20
const PLAN_B = 'BCHECK-LIST9'     // 有价、sort 10（用来证 sort 升序）
const PLAN_ZERO = 'BCHECK-LIST0'  // 0 价：必须不出现在套餐列表（下单侧 Task 6 已拒）
const PLAN_OFF = 'BCHECK-LISTOFF' // active=false：必须不出现
const PLAN_KEYS = [PLAN_A, PLAN_B, PLAN_ZERO, PLAN_OFF]

// 收款字段/令牌的**下发面**黑名单。注意 intent 的成功响应合法带着 `accountNo`/`bank`（那是它的职责），
// 但永远不该带 `transfer*` 前缀 —— 那一族名字只存在于 Settings 表里。列表接口的额外一份见 EXLEAK。
const UNSAFE_KEYS = ['transferAccountNo', 'transferAccountName', 'transferBank', 'transferQrPath', 'transferNote', 'accessToken']
// brief Step 4 第一条：列表响应体 `grep -i accountNo|transferAccount` 必须无命中。
const LIST_FORBIDDEN = ['accountNo', 'accountName', 'bank', 'qrPath']

const TEST_ACCOUNT_NO = '6222020200000123'
const TEST_ACCOUNT_NAME = 'BCHECK 测试收款户名'
const TEST_BANK = 'BCHECK 测试开户行'
const TEST_NOTE = '转账备注请填订单号'
const QR_PNG_KEY = 'branding/bcheck-qr.png'
const QR_JPG_KEY = 'branding/bcheck-qr.jpg'
const QR_MISSING_KEY = 'branding/bcheck-qr-deleted.png'

// B5（M-8）：脚本自己往 uploads/ 里写的那几枚键，指纹必须把它们排除掉 —— 跟 `dbState()`
// 排除自己的命名空间（下面的 SCRIPT_USER_EMAIL / SCRIPT_TEAM_SLUG / PLAN_KEYS）是同一个手法。
// 不排除的顺序是：上一轮被 Ctrl-C 打断 ⇒ 本轮 `uploadsBefore` 里带着那两枚残留 ⇒ 开头
// `sweepUploadFootprint()` 把它们删掉 ⇒ `既有 uploads/ 文件一枚没少` 红着冤枉本轮删了运营的文件。
const SCRIPT_UPLOAD_KEYS = new Set([QR_PNG_KEY, QR_JPG_KEY, QR_MISSING_KEY])

// 最小的真 PNG（IHDR+IDAT+IEND，8 字节签名开头）与真 JPEG（SOI + APP0 + EOI）：
// 收款码路由按**键后缀**给 Content-Type，这里只要字节是真的够浏览器认就行。
const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4'
  + '890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex')
const JPG_BYTES = Buffer.from('ffd8ffe000104a46494600010100000100010000ffdb004300ffffffffffffd9', 'hex')

// 临时身份命名空间：`.invalid` 是保留 TLD，真账号不可能长这样 ⇒ 删除语句在结构上就够不到既有管理员账号。
const USER_PREFIX = 'billing-orders-list-check-'
const USER_DOMAIN = '@example.invalid'
const TEAM_PREFIX = 'billing-orders-list-check-'
const STAMP = Date.now()
const OWNER_EMAIL = `${USER_PREFIX}owner-${STAMP}${USER_DOMAIN}`
const MEMBER_EMAIL = `${USER_PREFIX}member-${STAMP}${USER_DOMAIN}`
const OUTSIDER_EMAIL = `${USER_PREFIX}outsider-${STAMP}${USER_DOMAIN}`
const OWNER_PASSWORD = randomUUID()
const MEMBER_PASSWORD = randomUUID()
const OUTSIDER_PASSWORD = randomUUID()
const fpOf = (who: string) => createHash('sha256').update(`billing-orders-list-check-${who} ${STAMP}\nnode-tsx`).digest('base64url')

const BASE_URL = (process.env.BILLING_CHECK_BASE_URL || '').replace(/\/+$/, '')
const VIA_HTTP = BASE_URL.length > 0

const REDIS_PATTERNS = ['admin:sessions:*', 'admin:session:*', 'admin:device:*', 'blacklist:admin_session:*', 'token_fingerprint:*']
const REDIS_VALUE_PATTERNS = new Set(['admin:sessions:*', 'admin:session:*', 'admin:device:*', 'blacklist:admin_session:*'])

// B4（M-7）：`storage.ts:8` 在 STORAGE_ROOT 未设时兜的是 '/app/uploads'，这边过去兜 './uploads'
// ⇒ 两边不一致时 uploads 指纹量的是路由永远不会读的目录，而 B 段那两次 writeFile 也写去了另一边。
// 不猜存储根：未设 ⇒ uploads 指纹与 B 段的收款码文件整块诚实跳过（跟缺凭据的处置同形）。
const UPLOADS_ROOT = process.env.STORAGE_ROOT && process.env.STORAGE_ROOT !== '/' ? process.env.STORAGE_ROOT : null

const prisma = new PrismaClient()
let passed = 0
const failures: string[] = []
const scriptUserIds: string[] = []
const scriptKeyParts: string[] = []
let dbBefore: Record<string, Record<string, string>> | null = null
let redisBefore: Record<string, string> | null = null
let uploadsBefore: Record<string, string> | null = null
let settingsSnapshot: Record<string, unknown> | null = null
let finished: Promise<void> | null = null
// A2（I-2）：信号处理器**只置位**，清场由 main() 的 finally 负责 —— 但只置位不检查等于继续写完。
// 下面 B 段每一次写入（含第一次）之前都要回看这个位，否则顺序会变成「恢复 → 再写回假账号 → exit」。
let aborted = false
let lastSignal = 'SIGINT/SIGTERM'
// B6（M-9）：B 段是否真的往 Settings 落过写。没落过就不该执行还原 —— 那枚 `$executeRaw UPDATE`
// 语义上是 no-op，但它仍然是一次本可避免的、打在运营那一行上的真实写入。
let settingsDirty = false

function expect(name: string, actual: unknown, want: unknown) {
  const ok = typeof want === 'number' && typeof actual === 'number'
    ? Math.abs(actual - want) < 1e-9
    : JSON.stringify(actual) === JSON.stringify(want)
  if (ok) passed += 1
  else failures.push(`${name}\n      expected ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`)
}

function expectTrue(name: string, ok: boolean, detail = '') {
  if (ok) passed += 1
  else failures.push(`${name}\n      ${detail || 'expected true'}`)
}

/**
 * 泄漏扫描本身要能红：先在自造的脏串上验一遍，确认它真的抓得到 `accountNo` 与 `transferAccountNo`，
 * 下面每一发响应上的那条断言才不是永真句。
 */
function findLeaks(haystack: string, extra: string[] = []) {
  return [...UNSAFE_KEYS, ...extra].filter((key) => haystack.includes(key))
}
function selfTestLeakScanner() {
  const dirty = '{"accountNo":"1","transferAccountNo":"2","qrPath":"branding/x.png"}'
  expect('泄漏扫描器自测：抓到 transfer* 前缀', findLeaks(dirty, LIST_FORBIDDEN).includes('transferAccountNo'), true)
  expect('泄漏扫描器自测：抓到裸 accountNo', findLeaks(dirty, LIST_FORBIDDEN).includes('accountNo'), true)
  expect('泄漏扫描器自测：干净串不误报', findLeaks('{"id":"o1","status":"OPEN"}', LIST_FORBIDDEN).length, 0)
}

type Reply = { status: number; json: any; text: string; bytes: Buffer; headers: Headers }

async function reply(response: Response, label: string, extraForbidden: string[] = []): Promise<Reply> {
  const bytes = Buffer.from(await response.arrayBuffer())
  // latin1 逐字节映射：二进制响应（收款码）也在扫描范围内，不会因为解码成 utf8 而漏掉字节序列。
  const leaked = findLeaks(bytes.toString('latin1'), extraForbidden)
  expectTrue(`${label} 响应不含收款/令牌字段`, leaked.length === 0, `出现 ${leaked.join(', ')}`)
  const text = bytes.toString('utf8')
  let json: any = null
  try { json = JSON.parse(text) } catch { /* 非 JSON 响应由 text 断言兜住 */ }
  return { status: response.status, json, text, bytes, headers: response.headers }
}

async function call(
  method: 'GET' | 'POST',
  path: string,
  opts: { label: string; token?: string | null; teamId?: string | null; body?: unknown; extraForbidden?: string[] },
): Promise<Reply> {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (opts.token) headers.set('authorization', `Bearer ${opts.token}`)
  if (opts.teamId) headers.set('x-team-id', opts.teamId)
  const payload = opts.body === undefined ? undefined : (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body))
  const url = `${VIA_HTTP ? BASE_URL : 'http://localhost:3000'}${path}`
  if (VIA_HTTP) {
    return reply(await fetch(url, { method, headers, ...(payload === undefined ? {} : { body: payload }) }), opts.label, opts.extraForbidden)
  }
  const request = new NextRequest(url, { method, headers, ...(payload === undefined ? {} : { body: payload }) })
  if (path === '/api/billing/orders') {
    return reply(method === 'POST' ? await POST_ORDERS(request) : await GET_ORDERS(request), opts.label, opts.extraForbidden)
  }
  if (path === '/api/billing/transfer/qr') {
    return reply(await GET_QR(request), opts.label, opts.extraForbidden)
  }
  const match = /^\/api\/billing\/orders\/([^/]+)\/intent$/.exec(path)
  if (match) {
    return reply(await GET_INTENT(request, { params: Promise.resolve({ id: match[1] }) }), opts.label, opts.extraForbidden)
  }
  throw new Error(`脚本没派发这条路径：${method} ${path}`)
}

const L = (label: string) => ({ label })

// ---------- 状态指纹（只读） ----------

const SCRIPT_USER_EMAIL = { startsWith: USER_PREFIX, endsWith: USER_DOMAIN }
const SCRIPT_TEAM_SLUG = { startsWith: TEAM_PREFIX }
const SCRIPT_ORDER = { OR: [{ planKey: { in: PLAN_KEYS } }, { team: { slug: SCRIPT_TEAM_SLUG } }] }

type RowLike = { id?: string; key?: string }

function rowMap(rows: RowLike[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const row of rows) {
    const id = row.id ?? row.key
    if (id) out[id] = JSON.stringify(row)
  }
  return out
}

async function dbState(): Promise<Record<string, Record<string, string>>> {
  const [users, teams, members, quotas, settings, plans, orders] = await Promise.all([
    prisma.user.findMany({ where: { NOT: { email: SCRIPT_USER_EMAIL } }, orderBy: { id: 'asc' } }),
    prisma.team.findMany({ where: { NOT: { slug: SCRIPT_TEAM_SLUG } }, orderBy: { id: 'asc' } }),
    prisma.teamMember.findMany({
      where: { NOT: { OR: [{ team: { slug: SCRIPT_TEAM_SLUG } }, { user: { email: SCRIPT_USER_EMAIL } }] } },
      orderBy: { id: 'asc' },
    }),
    prisma.teamQuota.findMany({ where: { NOT: { team: { slug: SCRIPT_TEAM_SLUG } } }, orderBy: { id: 'asc' } }),
    prisma.settings.findMany({ orderBy: { id: 'asc' } }),
    prisma.plan.findMany({ where: { key: { notIn: PLAN_KEYS } }, orderBy: { id: 'asc' } }),
    prisma.order.findMany({ where: { NOT: SCRIPT_ORDER }, orderBy: { id: 'asc' } }),
  ])
  return {
    User: rowMap(users), Team: rowMap(teams), TeamMember: rowMap(members), TeamQuota: rowMap(quotas),
    Settings: rowMap(settings), Plan: rowMap(plans), Order: rowMap(orders),
  }
}

async function scanKeys(pattern: string): Promise<string[]> {
  const redis = getRedis()
  const keys: string[] = []
  let cursor = '0'
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500)
    cursor = next
    keys.push(...batch)
  } while (cursor !== '0')
  return keys
}

async function redisState(includeScriptKeys = false): Promise<Record<string, string>> {
  const redis = getRedis()
  const state: Record<string, string> = {}
  for (const pattern of REDIS_PATTERNS) {
    const readsValues = REDIS_VALUE_PATTERNS.has(pattern)
    for (const key of await scanKeys(pattern)) {
      if (!includeScriptKeys && isScriptKey(key)) continue
      if (!readsValues) { state[key] = '-'; continue }
      const type = await redis.type(key)
      state[key] = type === 'zset'
        ? `zset:${(await redis.zrange(key, 0, -1, 'WITHSCORES')).sort().join(',')}`
        : `${type}:${await redis.get(key)}`
    }
  }
  return state
}

/** `uploads/` 清单（相对路径 → 字节数）：B 段往这里写两张测试收款码，收尾必须一枚不剩。 */
async function uploadsState(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const root = UPLOADS_ROOT
  if (!root) return out
  async function walk(dir: string, rel: string) {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) { await walk(join(dir, entry.name), nextRel); continue }
      // B5（M-8）：自己那几枚测试收款码不进指纹（`SCRIPT_UPLOAD_KEYS` 的注释写了为什么）。
      if (SCRIPT_UPLOAD_KEYS.has(nextRel)) continue
      const info = await stat(join(dir, entry.name)).catch(() => null)
      out[nextRel] = String(info?.size ?? '?')
    }
  }
  await walk(root, '')
  return out
}

function diffRows(before: Record<string, string>, after: Record<string, string>) {
  return {
    gone: Object.keys(before).filter((id) => !(id in after)),
    changed: Object.keys(before).filter((id) => id in after && before[id] !== after[id]),
    added: Object.keys(after).filter((id) => !(id in before)),
  }
}

function isScriptKey(key: string) {
  return scriptKeyParts.some((part) => key.includes(part))
}

async function noteScriptUser(userId: string) {
  if (!scriptUserIds.includes(userId)) scriptUserIds.push(userId)
  if (!scriptKeyParts.includes(userId)) scriptKeyParts.push(userId)
  for (const sid of await getRedis().zrange(`admin:sessions:${userId}`, 0, -1)) {
    if (!scriptKeyParts.includes(sid)) scriptKeyParts.push(sid)
  }
}

// ---------- 足迹清理（幂等，FK 顺序） ----------

async function sweepDbFootprint() {
  const users = await prisma.user.findMany({ where: { email: SCRIPT_USER_EMAIL }, select: { id: true } })
  const userIds = users.map((u) => u.id)
  for (const id of userIds) await noteScriptUser(id)
  const teams = await prisma.team.findMany({
    where: { OR: [{ createdById: { in: userIds } }, { slug: SCRIPT_TEAM_SLUG }] },
    select: { id: true },
  })
  const teamIds = teams.map((t) => t.id)
  const orders = await prisma.order.findMany({
    where: { OR: [{ planKey: { in: PLAN_KEYS } }, { teamId: { in: teamIds } }] },
    select: { id: true },
  })
  const orderIds = orders.map((o) => o.id)
  const events = await prisma.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } })
  const attempts = await prisma.paymentAttempt.deleteMany({ where: { orderId: { in: orderIds } } })
  const deletedOrders = await prisma.order.deleteMany({ where: { id: { in: orderIds } } })
  const plans = await prisma.plan.deleteMany({ where: { key: { in: PLAN_KEYS } } })
  const memberships = await prisma.teamMember.deleteMany({
    where: { OR: [{ teamId: { in: teamIds } }, { userId: { in: userIds } }] },
  })
  const deletedTeams = await prisma.team.deleteMany({ where: { id: { in: teamIds } } })
  const deletedUsers = await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  return {
    users: deletedUsers.count, teams: deletedTeams.count, memberships: memberships.count,
    orders: deletedOrders.count, events: events.count, attempts: attempts.count, plans: plans.count,
  }
}

async function sweepUploadFootprint() {
  const removed: string[] = []
  if (!UPLOADS_ROOT) return removed   // B4：没有存储根就从来没有写过文件，清场也无从谈起
  for (const key of [QR_PNG_KEY, QR_JPG_KEY]) {
    await unlink(join(UPLOADS_ROOT, key)).then(() => removed.push(key)).catch(() => { /* 没写过就没有 */ })
  }
  return removed
}

async function sweepRedisFootprint() {
  const redis = getRedis()
  let revoked = 0
  for (const userId of scriptUserIds) {
    const sessionIds = await redis.zrange(`admin:sessions:${userId}`, 0, -1)
    for (const sessionId of sessionIds) {
      await revokeAdminSession(sessionId)
      revoked += 1
      if (!scriptKeyParts.includes(sessionId)) scriptKeyParts.push(sessionId)
    }
    const leftovers = [
      `admin:sessions:${userId}`,
      ...sessionIds.map((s) => `admin:session:${s}`),
      ...sessionIds.map((s) => `blacklist:admin_session:${s}`),
      ...(await scanKeys(`admin:device:${userId}:*`)),
      ...(await scanKeys(`token_fingerprint:${userId}:*`)),
    ]
    await redis.del(...leftovers)
  }
  return revoked
}

// ---------- Settings 快照/还原（B 段唯一的真写） ----------

const TRANSFER_COLS = ['transferAccountName', 'transferAccountNo', 'transferBank', 'transferNote', 'transferQrPath'] as const

async function snapshotSettings() {
  const row = await prisma.settings.findUnique({ where: { id: 'default' } })
  settingsSnapshot = row ? (JSON.parse(JSON.stringify(row)) as Record<string, unknown>) : null
  if (!settingsSnapshot) failures.push('Settings 的 id=default 行读不到，B 段无法做快照（跳过写入）')
  return settingsSnapshot
}

/**
 * 还原走 `$executeRaw`：Prisma 对 `@updatedAt` 会强制写当前时间，用 `update()` 还原的话这一行
 * 就永远回不到跑前的字节。列名与表名按 schema 原样（`Settings` / 驼峰加引号）。
 */
async function restoreSettings() {
  const snap = settingsSnapshot
  if (!snap) return '没做过快照，无需还原'
  await prisma.$executeRaw`
    UPDATE "Settings"
       SET "transferAccountName" = ${snap.transferAccountName as string | null},
           "transferAccountNo"   = ${snap.transferAccountNo as string | null},
           "transferBank"        = ${snap.transferBank as string | null},
           "transferNote"        = ${snap.transferNote as string | null},
           "transferQrPath"      = ${snap.transferQrPath as string | null},
           "updatedAt"           = ${new Date(String(snap.updatedAt))}
     WHERE "id" = 'default'`
  const after = await prisma.settings.findUniqueOrThrow({ where: { id: 'default' } })
  const same = JSON.stringify(after) === JSON.stringify(snap)
  expect('Settings 整行已还原到跑前快照（含 updatedAt，逐字节）', JSON.stringify(after), JSON.stringify(snap))
  return `还原后读回 ${JSON.stringify(Object.fromEntries(TRANSFER_COLS.map((c) => [c, (after as any)[c]])))}（整行逐字节=${same ? '一致' : '不一致'}）`
}

// ---------- 收尾 ----------

async function finish() {
  try {
    // B6（M-9）：只有 B 段真的往 Settings 落过写才还原。只跑 A 段的一轮（也包括 A1 的 SKIP 分支）
    // 对运营那一行一个字都不该动 —— 还原用的 `$executeRaw UPDATE` 语义上是 no-op，
    // 但它仍是一次本可避免的真实写入。
    let restored = 'B 段没写 Settings，未触发还原（也没发那次 no-op UPDATE）'
    if (settingsDirty) {
      try {
        restored = await restoreSettings()
      } catch (error) {
        failures.push(`Settings 还原抛出：${String(error)}`)
      }
    }
    let removed: string[] = []
    try {
      removed = await sweepUploadFootprint()
    } catch (error) {
      failures.push(`uploads 清场抛出：${String(error)}`)
    }
    console.log(`Settings 还原：${restored}`)
    console.log(`uploads 清场：删掉 ${removed.length ? removed.join(', ') : '0 枚'}（测试收款码）`)

    let revoked = 0
    try {
      revoked = await sweepRedisFootprint()
    } catch (error) {
      failures.push(`Redis 清场抛出：${String(error)}`)
    }
    try {
      const swept = await sweepDbFootprint()
      console.log(`清理：OrderEvent ${swept.events} / PaymentAttempt ${swept.attempts} / Order ${swept.orders} / `
        + `Plan ${swept.plans} / TeamMember ${swept.memberships} / Team ${swept.teams} / User ${swept.users}（临时会话回收 ${revoked} 枚）`)
    } catch (error) {
      failures.push(`库内清场抛出：${String(error)}`)
    }

    expect('清场后本脚本名下无残留 Order', await prisma.order.count({ where: SCRIPT_ORDER }), 0)
    expect('清场后无残留测试套餐（留着就是 Task 9 列表里看得见的假卡片）',
      await prisma.plan.count({ where: { key: { in: PLAN_KEYS } } }), 0)
    expect('清场后无残留临时 User', await prisma.user.count({ where: { email: SCRIPT_USER_EMAIL } }), 0)
    expect('清场后无残留临时 Team', await prisma.team.count({ where: { slug: SCRIPT_TEAM_SLUG } }), 0)
    expect('清场后无残留临时 TeamMember',
      await prisma.teamMember.count({ where: { OR: [{ userId: { in: scriptUserIds } }, { team: { slug: SCRIPT_TEAM_SLUG } }] } }), 0)
    const orphanEvents = await prisma.orderEvent.count({ where: { order: SCRIPT_ORDER } })
    const orphanAttempts = await prisma.paymentAttempt.count({ where: { order: SCRIPT_ORDER } })
    expectTrue('清场后无孤儿 OrderEvent/PaymentAttempt', orphanEvents === 0 && orphanAttempts === 0,
      `OrderEvent ${orphanEvents} / PaymentAttempt ${orphanAttempts}`)

    // 收款码文件必须一枚不剩（`uploads/branding` 是运营真会用的目录）。
    // B4：没有存储根 ⇒ 本轮从来没有文件可删，跳过而不是让它空过。
    if (UPLOADS_ROOT) {
      expect('清场后测试收款码文件已删净',
        await Promise.all([QR_PNG_KEY, QR_JPG_KEY].map((k) => stat(join(UPLOADS_ROOT, k)).then(() => 1, () => 0))).then((r) => r.reduce((a, b) => a + b, 0)), 0)
    }

    const before = dbBefore
    if (before) {
      const after = await dbState()
      const foreign: string[] = []
      for (const [table, rows] of Object.entries(before)) {
        const d = diffRows(rows, after[table] ?? {})
        expectTrue(`既有 ${table} 行未被动过（一个没少、一个没改）`, d.gone.length === 0 && d.changed.length === 0,
          `少了 ${d.gone.length} 行 / 改了 ${d.changed.length} 行：${[...d.gone, ...d.changed].slice(0, 3).join(', ')}`)
        if (table === 'TeamQuota' || table === 'Settings') {
          expectTrue(`${table} 没有多出任何一行`, d.added.length === 0, d.added.slice(0, 3).join(', '))
        } else if (d.added.length) {
          foreign.push(`${table} +${d.added.length}`)
        }
      }
      if (foreign.length) console.warn(`注意：跑动期间这些表多出了行（不是本脚本造的）：${foreign.join(' / ')}`)
    } else {
      failures.push('跑前的库内状态指纹没拿到，既有表无法回读')
    }

    const beforeUploads = uploadsBefore
    if (beforeUploads) {
      const d = diffRows(beforeUploads, await uploadsState())
      expectTrue('既有 uploads/ 文件一枚没少、大小没变', d.gone.length === 0 && d.changed.length === 0,
        `少了 ${d.gone.length} / 改了 ${d.changed.length}：${[...d.gone, ...d.changed].slice(0, 3).join(', ')}`)
      expectTrue('uploads/ 没多出任何文件（测试收款码已清干净）', d.added.length === 0, d.added.slice(0, 5).join(', '))
    } else if (!UPLOADS_ROOT) {
      console.log('uploads 回读：SKIP（STORAGE_ROOT 未设置，本轮没有量过 uploads/，见 UPLOADS_ROOT 的注释）')
    } else {
      failures.push('跑前的 uploads/ 清单没拿到，无法回读')
    }

    const beforeRedis = redisBefore
    if (beforeRedis) {
      const after = await redisState(true)
      const gone = Object.keys(beforeRedis).filter((k) => !(k in after))
      const changed = Object.keys(beforeRedis).filter((k) => k in after && beforeRedis[k] !== after[k])
      const added = Object.keys(after).filter((k) => !(k in beforeRedis))
      expectTrue('既有 Redis 会话键一枚没少（没有任何真会话被撤销或删除）', gone.length === 0, gone.slice(0, 3).join(', '))
      expectTrue('既有 Redis 会话键值逐字节未变', changed.length === 0, changed.slice(0, 3).join(', '))
      const mine = added.filter(isScriptKey)
      expectTrue('脚本自己的 Redis 足迹已清零', mine.length === 0, mine.slice(0, 3).join(', '))
      const foreign = added.filter((k) => !isScriptKey(k))
      if (foreign.length) console.warn(`注意：跑动期间 Redis 新出现 ${foreign.length} 枚与本脚本无关的键，不计入失败`)
      console.log(`Redis 回读：跑前 ${Object.keys(beforeRedis).length} 枚 / 跑后 ${Object.keys(after).length} 枚（少 ${gone.length}、改 ${changed.length}、多 ${added.length}）`)
    } else {
      failures.push('跑前的 Redis 指纹没拿到，既有会话无法回读')
    }
  } finally {
    for (const close of [() => getRedis().disconnect(), () => prisma.$disconnect(), () => appPrisma.$disconnect()]) {
      try { await close() } catch (error) { console.error('断开连接失败（不影响断言结果）：', error) }
    }
  }
}

function finishOnce(): Promise<void> {
  if (!finished) finished = finish()
  return finished
}

/**
 * A2（I-2）：B 段**每一次**写入（含第一次）之前调它。返回 true 就立刻从 main() 返回 ——
 * 清场只有 main() 的 finally 这一个执行者，所以「还原」一定排在所有写入之后。
 * 只置位不检查等于照样写完，两头都要。
 */
function bailIfAborted(next: string): boolean {
  if (!aborted) return false
  console.log(`收到 ${lastSignal}：${next} 之前的写入取消，Settings/uploads 交给 main() 的 finally 还原`)
  return true
}

// ---------- 主矩阵 ----------

async function main() {
  for (const key of ['JWT_SECRET', 'DATABASE_URL', 'REDIS_HOST']) {
    if (!process.env[key]) {
      console.error(`缺少 ${key}：请用 \`npx tsx --env-file=.env src/disabled-billing/scripts/check-billing-read-routes.mts\` 运行`)
      process.exit(2)
    }
  }
  // A2（I-2）：处理器**只置位**，不在这里并发跑 finish()。旧写法让 finish() 与仍停在 await 上的
  // main() 同时跑，而 B 段在还原点之后还排着四次 `settings.update` 与两次 `writeFile` —— Ctrl-C
  // 落在 B 段的真实顺序就成了「恢复 → 再写回假账号 → exit(130)」，运营那一行留下
  // `transferAccountNo = 测试串`，而且 `既有 Settings 行未被动过` 那条断言根本来不及跑。
  // 现在还原只可能发生在 main() 的 finally，即所有写入都已停止之后。
  //
  // 必须是 `process.on` 而不是 `process.once`：`node_modules/tsx/dist/preflight.cjs` 给自己装了一个
  // 隐藏监听器，逻辑是「用户监听器数归零就 process.exit(128+signo)」。`once` 会在**调用处理器之前**
  // 先把这一枚摘掉 ⇒ 隐藏处理器随后看到 0 ⇒ 我们的 finally 压根没机会跑（实测：SIGTERM 落在 B 段，
  // 输出停在处理器那一行，进程 143 死，库里留下 3 User / 5 Team / 4 Plan）。换成 `on` 之后
  // 计数始终 ≥1，清场跑得完；要强行终止只有 SIGKILL，**但它在上面这一切之外 —— 代价与手工救法见文件头注释**。
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      aborted = true
      lastSignal = signal
      console.error(`\n收到 ${signal}：只置位，清场交给 main() 的 finally（含 Settings/uploads 还原）；`
        + '中止点之后的 B 段写入不再执行，本轮以 130 退出')
    })
  }
  console.log(VIA_HTTP
    ? `传输层：真 HTTP → ${BASE_URL}（brief Step 4 原形态，只发请求，不碰进程）`
    : '传输层：同进程 import { GET }（不打 3000）')

  selfTestLeakScanner()

  const stale = await prisma.user.findMany({ where: { email: SCRIPT_USER_EMAIL }, select: { id: true } })
  for (const u of stale) await noteScriptUser(u.id)
  if (stale.length) console.log(`发现 ${stale.length} 个上一轮残留的临时身份，本轮收尾一并清掉`)

  // F-5：自愈必须排在**指纹与快照之前**。排在指纹之后的话，`既有 Settings 行未被动过` 那条回读会把
  // 这一轮的清场记成上一轮的破坏；排在快照之后的话，快照照下假账号，`finally` 又把假账号还原回去。
  await healStaleFakeSettings()

  dbBefore = await dbState()
  redisBefore = await redisState()
  // B4（M-7）：STORAGE_ROOT 未设 ⇒ 不量 uploads/（null 而不是空清单，收尾据此跳过而不是回读一个空集）。
  uploadsBefore = UPLOADS_ROOT ? await uploadsState() : null
  await snapshotSettings()
  console.log(`跑前既有数据：${Object.entries(dbBefore).map(([t, rows]) => `${t} ${Object.keys(rows).length}`).join(' / ')}`)
  console.log(UPLOADS_ROOT
    ? `跑前 uploads/：${Object.keys(uploadsBefore ?? {}).length} 个文件（根目录 ${UPLOADS_ROOT}，与 storage.ts 同一个根）`
    : 'SKIP：STORAGE_ROOT 未设置 ⇒ uploads 指纹与 B 段的收款码文件跳过（脚本不猜存储根，见 UPLOADS_ROOT 的注释）')

  try {
    const leftovers = await sweepDbFootprint()
    if (leftovers.users || leftovers.teams || leftovers.orders || leftovers.plans) {
      console.log(`发现上一次跑动的残留，先清掉：User ${leftovers.users} / Team ${leftovers.teams} / `
        + `Order ${leftovers.orders} / Plan ${leftovers.plans}`)
    }
    const removedFiles = await sweepUploadFootprint()
    if (removedFiles.length) console.log(`发现上一次跑动的收款码残留，先删掉：${removedFiles.join(', ')}`)

    // ---------- 三个临时身份 + 四个团队 + 四张套餐 ----------
    const owner = await prisma.user.create({
      data: { email: OWNER_EMAIL, name: 'billing-list-check-owner', password: await hashPassword(OWNER_PASSWORD) },
    })
    const member = await prisma.user.create({
      data: { email: MEMBER_EMAIL, name: 'billing-list-check-member', password: await hashPassword(MEMBER_PASSWORD) },
    })
    const outsider = await prisma.user.create({
      data: { email: OUTSIDER_EMAIL, name: 'billing-list-check-outsider', password: await hashPassword(OUTSIDER_PASSWORD) },
    })
    for (const u of [owner, member, outsider]) await noteScriptUser(u.id)
    const mk = (tag: string, status = 'ACTIVE', createdById = owner.id) => prisma.team.create({
      data: {
        name: `${TEAM_PREFIX}${tag}-${STAMP}`, slug: `${TEAM_PREFIX}${tag}-${STAMP}`,
        shareKey: `br-${STAMP}${tag}`, createdById, status,
      },
    })
    const teamA = await mk('a')            // owner=OWNER, member=MEMBER：主角团队
    const teamB = await mk('b', 'ACTIVE', outsider.id)  // outsider 自己的团队（跨团队对照）
    const teamC = await mk('c', 'DISABLED')             // 被平台停用的团队
    const teamD = await mk('d')            // 用来造一张 REPORTED 单
    const teamE = await mk('e')            // 55 张单：证 take:50 截断
    const expiresAt = new Date(Date.UTC(2027, 4, 31, 12, 0, 0))
    await prisma.team.update({ where: { id: teamA.id }, data: { subscriptionExpiresAt: expiresAt } })
    await prisma.teamMember.createMany({
      data: [
        { teamId: teamA.id, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
        { teamId: teamA.id, userId: member.id, role: 'MEMBER', status: 'ACTIVE' },
        { teamId: teamB.id, userId: outsider.id, role: 'OWNER', status: 'ACTIVE' },
        { teamId: teamC.id, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
        { teamId: teamD.id, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
        { teamId: teamE.id, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
      ],
    })
    const mkPlan = (key: string, name: string, priceCents: number, sort: number, active: boolean, durationDays: number) =>
      prisma.plan.create({
        data: {
          key, name, priceCents, currency: 'CNY', durationDays, sort, active,
          maxMembers: 3, maxProjects: 4, maxVideos: 5, maxStorageGB: 6,
        },
      })
    await mkPlan(PLAN_A, 'billing-list-a', PRICE_A, 20, true, 31)
    await mkPlan(PLAN_B, 'billing-list-b', PRICE_B, 10, true, 93)
    await mkPlan(PLAN_ZERO, 'billing-list-zero', 0, 1, true, 31)
    await mkPlan(PLAN_OFF, 'billing-list-off', 8800, 2, false, 31)

    const verifiedOwner = await verifyCredentials(OWNER_EMAIL, OWNER_PASSWORD)
    const verifiedMember = await verifyCredentials(MEMBER_EMAIL, MEMBER_PASSWORD)
    const verifiedOutsider = await verifyCredentials(OUTSIDER_EMAIL, OUTSIDER_PASSWORD)
    if (!verifiedOwner || !verifiedMember || !verifiedOutsider) throw new Error('verifyCredentials 没认出临时账号，矩阵无法继续')
    const ownerTok = (await issueAdminTokens(verifiedOwner, fpOf('owner'))).accessToken
    const memberTok = (await issueAdminTokens(verifiedMember, fpOf('member'))).accessToken
    const outsiderTok = (await issueAdminTokens(verifiedOutsider, fpOf('outsider'))).accessToken
    console.log('令牌来源：verifyCredentials + issueAdminTokens，三枚都签给脚本自造的临时账号（既有账号的会话只被读作指纹）')

    // ---------- 前置：当前的真实配置（503 / 404 分支的来源） ----------
    const configBefore = await getTransferConfig()
    // A1（I-1）：这是**守卫**，不是断言。上面那两行 `expect` 只记录失败、拦不住下面 B 段的
    // `settings.update`，而 Task 11 演示时运营会往那五行里填真账号 —— 从那一刻起：
    //   1) 这个闸门必须仍然可跑（不能永久红在两枚只测环境状态的断言上）；
    //   2) 更不能把真账号覆盖掉：覆盖窗口内用户自己的 `next dev` 正在服务真实流量，
    //      任何真实团队的 `GET /api/billing/orders/:id/intent` 都会把假账号当成收款目标返回，
    //      那正是「客户往假账号打钱」这件事。
    // 环境已经是配置态 ⇒ 打印一行 SKIP、**不记任何失败**（这是环境状态，不是被测代码的问题），
    // B 段整段不执行，A 段照跑 —— 跟缺凭据时的处置同形（诚实跳过，不是猜）。
    const settingsWritable = configBefore.configured === false && configBefore.qrPath === null
    console.log(settingsWritable
      ? '跑前环境：平台未配置收款账户 ⇒ B 段可以临时写入（收尾原样还原并读回）'
      : `跑前环境：configured=${configBefore.configured} / qrPath=${configBefore.qrPath ? '已设置' : 'null'}`)

    // 依赖「跑前环境未配置」的那两枚分支（503 / 无码 404）测的是环境而不是 fixture：环境已经是
    // 配置态时它们必然红，而且红了也不说明被测代码有问题 —— 一并跳过并说明原因（A1 的后半段要求）。
    const canCheckUnconfigured = configBefore.configured === false
    const canCheckNoQrKey = configBefore.qrPath === null

    // ---------- 订单：teamA 一张 OPEN（走 Task 6 的真接口），teamD 一张 REPORTED ----------
    const created = await call('POST', '/api/billing/orders', { ...L('下单 建单'), token: ownerTok, teamId: teamA.id, body: { planKey: PLAN_A, periods: 1 } })
    expect('建单 200（Task 6 的接口可用）', created.status, 200)
    const orderId = String(created.json?.order?.id)
    const orderAmount = Number(created.json?.order?.amountCents)
    const orderReference = String(created.json?.order?.reference)
    expect('建单金额 = 套餐价 × 1 期', orderAmount, PRICE_A)

    const createdD = await call('POST', '/api/billing/orders', { ...L('下单 建单D'), token: ownerTok, teamId: teamD.id, body: { planKey: PLAN_A, periods: 1 } })
    const orderIdD = String(createdD.json?.order?.id)
    const reported = await prisma.$transaction((tx) => reportOrderPaid(tx, {
      orderId: orderIdD, teamId: teamD.id, reportNote: '脚本造的 REPORTED 单', actorUserId: owner.id,
    }))
    expect('teamD 的单已进 REPORTED（走真 reportOrderPaid，不是手改状态）', reported.ok, true)
    expect('teamD 单状态回读', await prisma.order.count({ where: { id: orderIdD, status: 'REPORTED' } }), 1)

    // teamE：55 张直插单（createdAt 递增），证 `take: 50` 与倒序都在生效。
    const baseTs = Date.now()
    await prisma.order.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({
        teamId: teamE.id, planKey: PLAN_A, periods: 1, amountCents: PRICE_A, currency: 'CNY',
        reference: `BR${STAMP}${i}`, status: 'OPEN', createdById: owner.id,
        createdAt: new Date(baseTs + i * 1000),
      })),
    })
    expect('teamE 库里确实是 55 张（否则下面的 50 条截断断言永真）', await prisma.order.count({ where: { teamId: teamE.id } }), 55)

    // ---------- Step 1：列表 GET ----------
    const anon = await call('GET', '/api/billing/orders', { ...L('列表 无令牌'), extraForbidden: LIST_FORBIDDEN })
    expect('列表 无令牌 401', anon.status, 401)
    expect('列表 无令牌文案', anon.json?.error, '未登录')

    const outsiderOnA = await call('GET', '/api/billing/orders', { ...L('列表 非成员'), token: outsiderTok, teamId: teamA.id, extraForbidden: LIST_FORBIDDEN })
    expect('列表 非本团队成员 403（不是 200 空列表）', outsiderOnA.status, 403)
    expect('列表 403 文案', outsiderOnA.json?.error, '无权访问')

    const disabled = await call('GET', '/api/billing/orders', { ...L('列表 停用团队'), token: ownerTok, teamId: teamC.id, extraForbidden: LIST_FORBIDDEN })
    expect('列表 被平台停用的团队 403（账单面整体消失，与 Task 6 同一谓词）', disabled.status, 403)

    const listA = await call('GET', '/api/billing/orders', { ...L('列表 OWNER'), token: ownerTok, teamId: teamA.id, extraForbidden: LIST_FORBIDDEN })
    expect('列表 OWNER 200', listA.status, 200)
    expect('列表 顶层键恰好 orders/plan/team', Object.keys(listA.json ?? {}).sort(), ['orders', 'plan', 'team'])
    expect('列表 orders 条数与库内计数一致', listA.json?.orders?.length, await prisma.order.count({ where: { teamId: teamA.id } }))
    expect('列表 订单是那张 OPEN 单', listA.json?.orders?.[0]?.id, orderId)
    expect('列表 订单状态', listA.json?.orders?.[0]?.status, 'OPEN')
    const DTO_KEYS = ['id', 'reference', 'planKey', 'periods', 'amountCents', 'currency', 'status', 'createdAt',
      'reportedAt', 'paidAt', 'fulfilledAt', 'periodEnd', 'closeReason', 'reportNote',
      'invoiceRequested', 'invoiceTitle', 'invoiceTaxNo'].sort()
    expect('列表 OrderDto 走的是 Task 6 那份投影（17 键，无 planName/账号）', Object.keys(listA.json?.orders?.[0] ?? {}).sort(), DTO_KEYS)
    // 套餐卡片：`sort` 升序 + 只列 active 且 priceCents>0，两道过滤各有一枚能红的断言。
    expect('列表 plan 只含有价且上架的套餐，按 sort 升序', (listA.json?.plan ?? []).map((p: any) => p.key), [PLAN_B, PLAN_A])
    expect('列表 PlanCard 字段契约', Object.keys(listA.json?.plan?.[0] ?? {}).sort(), ['currency', 'durationDays', 'key', 'name', 'priceCents', 'quota'])
    expect('列表 PlanCard.quota 四列齐', Object.keys(listA.json?.plan?.[0]?.quota ?? {}).sort(), ['maxMembers', 'maxProjects', 'maxStorageGB', 'maxVideos'])
    expect('列表 PlanCard 价格/天数来自库里', [listA.json?.plan?.[0]?.priceCents, listA.json?.plan?.[0]?.durationDays], [PRICE_B, 93])
    expectTrue('列表 0 价种子行 MONTHLY 不在卡片里（¥0 卡片点了必失败）', !(listA.json?.plan ?? []).some((p: any) => p.key === 'MONTHLY' || p.priceCents <= 0),
      JSON.stringify((listA.json?.plan ?? []).map((p: any) => [p.key, p.priceCents])))
    expect('列表 当前权益：plan 取自 Team.subscriptionPlan', listA.json?.team?.plan, 'TRIAL')
    expect('列表 当前权益：expiresAt 是 ISO 串（取自 Team.subscriptionExpiresAt）', listA.json?.team?.expiresAt, expiresAt.toISOString())

    // ---------- Task 9 的「额度来源」行（Ruling D-6 补的读面：team.quota）----------
    // 键集只许 { reference, source }：这一行是**来历说明**不是权益表。塞进 maxStorageGB 之类的实值，
    // 就等于在同一屏开了第二套额度口径（权益的正主是 plan[] 卡片与平台端）。
    expect('列表 team.quota 键集恰是 reference/source（不许塞额度实值）', Object.keys(listA.json?.team?.quota ?? {}).sort(), ['reference', 'source'])
    // 脚本自己的团队此刻没有 TeamQuota 行 —— 这就是本地库多数派的形状（存量行的来历不可知，页面必须
    // 能在「没有行」上整行不渲染）。这道夹具前置检查让下面那枚 null/null 不是空断言。
    const quotaRowsBefore = await prisma.teamQuota.count({ where: { teamId: teamA.id } })
    expectTrue('夹具：teamA 没有 TeamQuota 行（否则下面 null/null 那枚永真）', quotaRowsBefore === 0, `实际 ${quotaRowsBefore} 行`)
    expect('列表 无 TeamQuota 行 → { source: null, reference: null }', listA.json?.team?.quota, { source: null, reference: null })

    // MANUAL：平台在控制台手改过额度 ⇒ 页面渲染「手动调整」，且**没有**备注码可指。
    await prisma.teamQuota.upsert({
      where: { teamId: teamA.id },
      create: { teamId: teamA.id, source: 'MANUAL' },
      update: { source: 'MANUAL', sourceOrderId: null },
    })
    const listManual = await call('GET', '/api/billing/orders', { ...L('列表 额度来源 MANUAL'), token: ownerTok, teamId: teamA.id, extraForbidden: LIST_FORBIDDEN })
    expect('列表 source=MANUAL 读回 MANUAL', listManual.json?.team?.quota?.source, 'MANUAL')
    expect('列表 source=MANUAL 时 reference 仍为 null（手改没有落地单）', listManual.json?.team?.quota?.reference, null)

    // PLAN + sourceOrderId：`TeamQuota` 与 `Order` **没有关系定义**，所以 reference 只能显式二次查询，
    // `include` 拿不到。断言它等于脚本本轮建好的那枚 OPEN 单的备注码 —— 页面「额度来自订单 RV-XXXXXX」
    // 那一行全靠这个值；写成 source==='ORDER' 之类的分支会永不成立（schema `:166-172` 只有 PLAN/MANUAL）。
    await prisma.teamQuota.upsert({
      where: { teamId: teamA.id },
      create: { teamId: teamA.id, source: 'PLAN', sourceOrderId: orderId },
      update: { source: 'PLAN', sourceOrderId: orderId },
    })
    const listQuotaOrder = await call('GET', '/api/billing/orders', { ...L('列表 额度来源 PLAN+落地单'), token: ownerTok, teamId: teamA.id, extraForbidden: LIST_FORBIDDEN })
    expect('列表 source=PLAN 读回 PLAN', listQuotaOrder.json?.team?.quota?.source, 'PLAN')
    expect('列表 source=PLAN+sourceOrderId → reference 就是那张单的备注码（二次查询有值可断）',
      listQuotaOrder.json?.team?.quota?.reference, orderReference)
    // 收尾不在此处手工删 TeamQuota：`TeamQuota.teamId` 是 `onDelete: Cascade`，
    // finish() 删掉 teamA 就把它带走了（`dbState()` 也按脚本团队的 slug 把它排除在指纹外）。

    const listB = await call('GET', '/api/billing/orders', { ...L('列表 越权面'), token: outsiderTok, teamId: teamB.id, extraForbidden: LIST_FORBIDDEN })
    expect('列表 outsider 读自己团队 200', listB.status, 200)
    expect('列表 跨团队不串单（teamB 的列表里没有 teamA 的订单）',
      (listB.json?.orders ?? []).some((o: any) => o.id === orderId), false)
    expect('列表 teamB 自己是空的', listB.json?.orders?.length, 0)
    expect('列表 teamB 的权益列回 null（未设置过期时间）', listB.json?.team?.expiresAt, null)

    const listE = await call('GET', '/api/billing/orders', { ...L('列表 截断'), token: ownerTok, teamId: teamE.id, extraForbidden: LIST_FORBIDDEN })
    expect('列表 55 张单只回 50 张（take:50 有值可断）', listE.json?.orders?.length, 50)
    expect('列表 按 createdAt 倒序（第一张是最新的）', listE.json?.orders?.[0]?.reference, `BR${STAMP}54`)
    expect('列表 截断的是最旧的（最后一张是第 6 新）', listE.json?.orders?.[49]?.reference, `BR${STAMP}5`)

    // ---------- Step 1/3 的门禁口径：MEMBER 可读、不可下单 ----------
    const listM = await call('GET', '/api/billing/orders', { ...L('列表 MEMBER'), token: memberTok, teamId: teamA.id, extraForbidden: LIST_FORBIDDEN })
    expect('列表 MEMBER 200（看账单不需要 OWNER）', listM.status, 200)
    expect('列表 MEMBER 读到同一张单', listM.json?.orders?.[0]?.id, orderId)
    const listNoHeader = await call('GET', '/api/billing/orders', { ...L('列表 无 x-team-id'), token: memberTok, extraForbidden: LIST_FORBIDDEN })
    expect('列表 不带 x-team-id 也能读（teamId 由服务端派生，头只是意图）', listNoHeader.status, 200)
    expect('列表 不带 x-team-id 时落在自己的 ACTIVE 团队', listNoHeader.json?.orders?.[0]?.id, orderId)
    const memberPost = await call('POST', '/api/billing/orders', { ...L('下单 MEMBER'), token: memberTok, teamId: teamA.id, body: { planKey: PLAN_A, periods: 1 } })
    expect('MEMBER 仍然不能下单 403（读面放宽没有顺手放宽写面）', memberPost.status, 403)
    expect('MEMBER 下单被拒后团队里还是 1 张', await prisma.order.count({ where: { teamId: teamA.id } }), 1)

    // ---------- Step 2：intent ----------
    const intentAnon = await call('GET', `/api/billing/orders/${orderId}/intent`, { ...L('intent 无令牌'), extraForbidden: [] })
    expect('intent 无令牌 401', intentAnon.status, 401)
    // A3（I-3）：这道 403 是那个闸门上唯一的洞 —— 其余六发 intent 带的都是**有效** membership
    // 或没有令牌，删掉路由里 `if (!membership) return 403` 那一行只会让 `membership.teamId`
    // 抛 TypeError（框架 500），矩阵照样全绿。夹具已经在手：outsider 只属于 teamB，
    // teamC 是被平台停用的那个团队 ⇒ 解析器给 null。与另外两条路由的 403 断言同形。
    const intentNoTeam = await call('GET', `/api/billing/orders/${orderId}/intent`, { ...L('intent 无可用团队'), token: outsiderTok, teamId: teamC.id, extraForbidden: [] })
    expect('intent 有会话但没有可用团队归属 → 403（闸门在 findFirst 之前，不发账号）', intentNoTeam.status, 403)
    expect('intent 403 文案', intentNoTeam.json?.error, '无权访问')
    const intentForeign = await call('GET', `/api/billing/orders/${orderId}/intent`, { ...L('intent 跨团队'), token: outsiderTok, teamId: teamB.id, extraForbidden: [] })
    expect('别人团队的 orderId 打 intent → 404（不许是 403 带出存在性）', intentForeign.status, 404)
    expect('intent 404 文案', intentForeign.json?.error, '订单不存在')
    const intentMissing = await call('GET', '/api/billing/orders/br-nope-not-here/intent', { ...L('intent 不存在的单'), token: ownerTok, teamId: teamA.id, extraForbidden: [] })
    expect('不存在的 orderId → 404', intentMissing.status, 404)
    const intentReported = await call('GET', `/api/billing/orders/${orderIdD}/intent`, { ...L('intent REPORTED'), token: ownerTok, teamId: teamD.id, extraForbidden: [] })
    expect('REPORTED 单打 intent → 409（不再发账号，避免收到没人认领的转账）', intentReported.status, 409)
    expect('intent 409 文案', intentReported.json?.error, '该订单已不需要付款')
    if (canCheckUnconfigured) {
      const intentNoConfig = await call('GET', `/api/billing/orders/${orderId}/intent`, { ...L('intent 未配置'), token: memberTok, teamId: teamA.id, extraForbidden: [] })
      expect('未配置收款账户 → 503（不是塌成 500）', intentNoConfig.status, 503)
      expect('503 的文案逐字', intentNoConfig.json?.error, '平台尚未配置收款账户，请联系运营')
    } else {
      // A1 的后半段：环境已经是配置态时，这条测的是环境而不是 fixture（更不能让它去测 B 段
      // 自己写进去的那个桩 —— B 段本轮已经跳过了），所以诚实跳过并说明原因。
      console.log('SKIP：跑前平台已配置收款账户 ⇒ 「未配置 → 503」这两枚测的是环境状态，不是被测代码，本轮跳过')
    }
    if (VIA_HTTP) {
      const notAllowed = await call('POST', `/api/billing/orders/${orderId}/intent`, { ...L('intent POST'), token: ownerTok, teamId: teamA.id, body: {} , extraForbidden: [] })
      expect('intent 只暴露 GET：POST → 405', notAllowed.status, 405)
    } else {
      console.log('SKIP：POST → 405 只有真 HTTP 才成立（同进程 import 只拿到 GET 导出），已在真 HTTP 那轮覆盖')
    }

    // ---------- Step 3：收款码（未配置态） ----------
    const qrAnon = await call('GET', '/api/billing/transfer/qr', L('QR 无令牌'))
    expect('QR 无令牌 401（绝不能公开可读）', qrAnon.status, 401)
    const qrOutsider = await call('GET', '/api/billing/transfer/qr', { ...L('QR 非成员'), token: outsiderTok, teamId: teamA.id })
    expect('QR 带别人团队的 x-team-id → 403', qrOutsider.status, 403)
    const qrDisabled = await call('GET', '/api/billing/transfer/qr', { ...L('QR 停用团队'), token: ownerTok, teamId: teamC.id })
    expect('QR 被停用的团队 → 403', qrDisabled.status, 403)
    if (canCheckNoQrKey) {
      const qrNone = await call('GET', '/api/billing/transfer/qr', { ...L('QR 未上传'), token: memberTok, teamId: teamA.id })
      expect('库里 transferQrPath 为 null → 404（MEMBER 也算有权看）', qrNone.status, 404)
      expect('QR 404 文案逐字', qrNone.json?.error, '平台尚未上传收款码')
    } else {
      console.log('SKIP：跑前库里已有收款码键 ⇒ 「无键 → 404」这两枚测的是环境状态，本轮跳过（同 A1）')
    }

    // ---------- B 段：填上收款配置，证 200 那两条（收尾会还原并读回） ----------
    // A1（I-1）：`settingsWritable` 拦在**任何写入之前**（旧写法只有两枚 expect 记录失败，
    // 拦不住下面的 `settings.update`）。平台已经是配置态 ⇒ B 段整段跳过、一枚失败都不记。
    if (!settingsWritable) {
      console.log('SKIP：平台已配置收款账户，B 段（Settings 写入）跳过')
    } else if (!UPLOADS_ROOT) {
      // B4（M-7）：没有存储根就没有文件可写，200 那两条也无从可断 —— 跳过，不猜根目录。
      console.log('SKIP：STORAGE_ROOT 未设置，B 段（收款码文件 + 200 那两条）跳过')
    } else if (!settingsSnapshot) {
      failures.push('B 段没跑：Settings 快照没拿到')
    } else {
      const root = UPLOADS_ROOT
      try {
        // A2（I-2）：每一次写入（含 B 的第一次写入）之前回看中断位。返回 true 就从 main() 直接
        // return ⇒ finally 里的 finishOnce() 成为唯一的清场者，「还原」因此一定排在最后一次写入之后。
        if (bailIfAborted(`mkdir ${root}`)) return
        // 本地模式下 storage.ts 会自己 mkdir(recursive)；脚本直接写文件就得先把目录建出来（branding/ 现在是空的）。
        await mkdir(dirname(join(root, QR_PNG_KEY)), { recursive: true })

        if (bailIfAborted('写入测试收款配置')) return
        // 置位在写之前：这一发 UPDATE 哪怕抛出去，收尾也必须按快照还原（快照来自跑前的那一行）。
        settingsDirty = true
        await prisma.settings.update({
          where: { id: 'default' },
          data: { transferAccountName: TEST_ACCOUNT_NAME, transferAccountNo: TEST_ACCOUNT_NO, transferBank: TEST_BANK, transferNote: TEST_NOTE },
        })

        if (bailIfAborted('写入两张测试收款码')) return
        await writeFile(join(root, QR_PNG_KEY), PNG_BYTES)
        await writeFile(join(root, QR_JPG_KEY), JPG_BYTES)
        console.log(`已写入测试收款配置 + 两张测试收款码（${QR_PNG_KEY} ${PNG_BYTES.length}B / ${QR_JPG_KEY} ${JPG_BYTES.length}B），收尾还原`)

        const cfg = await getTransferConfig()
        expect('B 段：配置已生效（configured）', cfg.configured, true)

        if (bailIfAborted('把 transferQrPath 指向 .png')) return
        await prisma.settings.update({ where: { id: 'default' }, data: { transferQrPath: QR_PNG_KEY } })
        const intentOk = await call('GET', `/api/billing/orders/${orderId}/intent`, { ...L('intent 200'), token: memberTok, teamId: teamA.id, extraForbidden: [] })
        expect('配好账户后 MEMBER 也能拿 intent 200', intentOk.status, 200)
        expect('intent 分支是 instructions', intentOk.json?.kind, 'instructions')
        expect('intent 键集恰是 instructions 分支那 9 个', Object.keys(intentOk.json ?? {}).sort(),
          ['accountName', 'accountNo', 'amountCents', 'bank', 'currency', 'kind', 'note', 'qrPath', 'reference'].sort())
        expect('intent 户名', intentOk.json?.accountName, TEST_ACCOUNT_NAME)
        expect('intent 账号', intentOk.json?.accountNo, TEST_ACCOUNT_NO)
        expect('intent 开户行', intentOk.json?.bank, TEST_BANK)
        expect('intent 备注', intentOk.json?.note, TEST_NOTE)
        expect('intent 金额取自订单（不是入参）', intentOk.json?.amountCents, orderAmount)
        expect('intent 转账备注码 = order.reference', intentOk.json?.reference, orderReference)
        expectTrue('intent.qrPath 是存储键不是 URL（Task 9 要拿它去换这一条读接口）',
          typeof intentOk.json?.qrPath === 'string' && !String(intentOk.json.qrPath).startsWith('/'), String(intentOk.json?.qrPath))

        const qrPng = await call('GET', '/api/billing/transfer/qr', { ...L('QR png'), token: memberTok })
        expect('已传码 → QR 200', qrPng.status, 200)
        expect('QR Content-Type 跟后缀走（.png）', qrPng.headers.get('content-type'), 'image/png')
        expect('QR Cache-Control 逐字节（换码必须立刻发新图）', qrPng.headers.get('cache-control'), 'no-store, no-cache, must-revalidate, private')
        expect('QR 字节就是库里指的那张', qrPng.bytes.equals(PNG_BYTES), true)

        // 换码：改的是**库里的键**，接口必须马上发另一张 —— 路径写死常量就死在这条上。
        if (bailIfAborted('换码为 .jpg（旧版信号路径就是漏在这里：还原之后又写回假账号）')) return
        await prisma.settings.update({ where: { id: 'default' }, data: { transferQrPath: QR_JPG_KEY } })
        const qrJpg = await call('GET', '/api/billing/transfer/qr', { ...L('QR jpg'), token: ownerTok, teamId: teamA.id })
        expect('换码后同一 URL 立刻发新图（200）', qrJpg.status, 200)
        expect('QR Content-Type 跟后缀走（.jpg → image/jpeg）', qrJpg.headers.get('content-type'), 'image/jpeg')
        expect('QR 字节换成了新那张', qrJpg.bytes.equals(JPG_BYTES), true)

        // fileExists 那道守卫的能红断言：键在库里、文件不在盘上 —— 少了守卫就是 200 + 半路 ENOENT。
        if (bailIfAborted('把 transferQrPath 指向一枚不存在的键')) return
        await prisma.settings.update({ where: { id: 'default' }, data: { transferQrPath: QR_MISSING_KEY } })
        const qrGone = await call('GET', '/api/billing/transfer/qr', { ...L('QR 文件失踪'), token: ownerTok, teamId: teamA.id })
        expect('库里有键、盘上没文件 → 404 而不是 200 断流（fileExists 守卫）', qrGone.status, 404)
        expect('失踪时的文案', qrGone.json?.error, '平台尚未上传收款码')

        // 收款账号已经躺在 Settings 里了，列表接口依然一个字都不许带出去。
        if (bailIfAborted('把 transferQrPath 收回 null')) return
        await prisma.settings.update({ where: { id: 'default' }, data: { transferQrPath: null } })
        const listAfterConfig = await call('GET', '/api/billing/orders', { ...L('列表 配置后'), token: ownerTok, teamId: teamA.id, extraForbidden: [...LIST_FORBIDDEN, TEST_ACCOUNT_NO] })
        expect('配好收款信息后列表仍 200', listAfterConfig.status, 200)
        expectTrue('配好收款信息后列表响应里没有真账号那串数字', !listAfterConfig.text.includes(TEST_ACCOUNT_NO), listAfterConfig.text.slice(0, 200))
      } catch (error) {
        // B 段抛出去也要走完收尾（还原 Settings、删测试收款码），所以这里记账不 rethrow。
        failures.push(`B 段抛出：${String((error as Error)?.message ?? error)}`)
      }
    }
  } finally {
    await finishOnce()
  }
}

/**
 * F-5 自愈（文件头「中断这一脚本的代价」那一节讲的就是它）：SIGKILL 落在 B 段中间会留下脚本自造的
 * 假收款配置，而 A1 守卫「已经是配置态 ⇒ 整段 SKIP」过去会把它一直冻着。所以在**指纹与快照之前**
 * 先认一次「五列里有没有本脚本自己写的那几枚带私有前缀的字面量」：**至少两枚**逐字相等 ⇒ 上一轮就是
 * 被硬杀在这里，五列一起置 `NULL`（B 段只可能从「五列全 NULL」起步 —— `settingsWritable` 要求
 * `configured === false` 且 `qrPath === null`，所以 NULL 就是那一轮的真实基准，不是猜出来的次优值），
 * 然后照常走 A1 与快照。不足两枚就**一个字都不动**：判据宁可漏不可误 —— 见下面 `own` 那一段。
 * 走 `$executeRaw` 而不是 `settings.update`：只清这五列，`updatedAt` 不归本脚本决定（它记的是
 * 上一轮那次硬杀写入的时刻，改成现在反而是假话）。
 */
async function healStaleFakeSettings() {
  const row = await prisma.settings.findUnique({
    where: { id: 'default' },
    select: { transferAccountName: true, transferAccountNo: true, transferBank: true, transferNote: true, transferQrPath: true },
  })
  if (!row) return
  // 判据只认**带私有命名空间**的那五枚字面量（`BCHECK ` 前缀的户名/开户行、`branding/bcheck-` 前缀的三枚
  // 收款码键）。原先这里是「七枚里任一枚逐字相等就动手」，而 `TEST_NOTE` 是一句没有命名空间的通用中文提示语
  // （`转账备注请填订单号` 恰好就是这一格在生产里最可能被运营原样填出来的内容）、`TEST_ACCOUNT_NO` 是正常
  // 银联号段形状 —— 命中一枚就把五列一起置 NULL，而自愈排在 `snapshotSettings()` 之前，被清掉的**真**户名/
  // 真账号根本不在还原快照里，脚本内无从恢复。「冻住假配置」可救（清五列即可），「销毁真配置」不可救。
  // 为什么「至少两枚」不伤真阳性：B 段那次 `settings.update` 是单条原子写，户名与开户行必然同时是假的。
  // 唯一漏掉的形态是「只有收款码列是假的」（硬杀发生在本脚本自己的还原中途）—— 那一发漏自愈只会让 A1
  // 继续 SKIP、界面给一张坏码，人工清一格就能救，比误清真账号便宜得多，所以按这个方向偏。
  const own = new Set<string>([TEST_ACCOUNT_NAME, TEST_BANK, QR_PNG_KEY, QR_JPG_KEY, QR_MISSING_KEY])
  const hits = Object.entries(row).filter(([, value]) => typeof value === 'string' && own.has(value)).map(([key]) => key)
  if (hits.length < 2) return
  await prisma.$executeRaw`
    UPDATE "Settings"
       SET "transferAccountName" = NULL,
           "transferAccountNo"   = NULL,
           "transferBank"        = NULL,
           "transferNote"        = NULL,
           "transferQrPath"      = NULL
     WHERE "id" = 'default'`
  console.log(`自愈：上一轮被硬杀在 B 段中间，库里还留着本脚本自己的假收款配置（命中列 ${hits.join(', ')}）`
    + '⇒ 五列一起置回 NULL，随后 A1 守卫与快照照常执行（SIGKILL 本身仍然是禁用的：其余清理项不归这一条管）')
}

function tally(): number {
  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) console.log(failures.join('\n'))
  return failures.length ? 1 : 0
}

/**
 * A2（I-2）：清场（含 Settings 还原）永远排在所有写入之后，但被打断的这一轮断言集本来就不完整
 * （B 段中止在某一次写入之前），所以退出码按信号语义给 130 而不是「全绿 0」。
 */
function exitCode(): number {
  const code = tally()
  if (aborted) {
    console.log(`（本轮被 ${lastSignal} 打断：中止点之后的 B 段写入没有执行，Settings 已按快照还原，退出码 130）`)
    return 130
  }
  return code
}

main()
  .then(() => process.exit(exitCode()))
  .catch((error) => {
    // try 里抛出来的异常已经在 finally 里清过场了；这里把它记成一枚失败，别让计数不打印。
    console.error(error)
    failures.push(`脚本抛出：${String((error as Error)?.message ?? error)}`)
    process.exit(exitCode())
  })
