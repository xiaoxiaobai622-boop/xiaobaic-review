/**
 * Task 6 gate：`POST /api/billing/orders` 的六条 curl 矩阵 + OWNER 门禁的**全部三侧**
 * （OWNER 正例 / MEMBER 403 / 非成员 403）。两种传输层，同一份断言：
 *
 * 1. **同进程**（默认）：`import { POST }` 真路由，自己造 NextRequest（真 bearer 令牌 + 真
 *    x-team-id），断言返回 Response 的状态码与 JSON 体。
 * 2. **真 HTTP**（给 `BILLING_CHECK_BASE_URL`）：同样的矩阵打到他正在跑的 `next dev`。
 *
 * 跑法 —— **不需要任何口令**（临时身份由脚本自己造，见下面 I-1 那段）：
 *
 *   npx tsx --env-file=.env src/disabled-billing/scripts/check-billing-orders-route.mts
 *   BILLING_CHECK_BASE_URL=http://localhost:3000 \
 *     npx tsx --env-file=.env src/disabled-billing/scripts/check-billing-orders-route.mts
 *
 * `--env-file=.env` 是必须的：tsx 不自动读 .env，而 `src/lib/auth.ts` 在模块加载时就取
 * JWT_SECRET（Prisma 自己会读 DATABASE_URL，JWT 不会）。缺它每个请求都会 401。
 * 真 HTTP 模式只往**用户自己起的** dev server 发请求 —— 不启进程、不跑 build。
 *
 * ---------------------------------------------------------------------------
 * I-1（评审）：为什么只用脚本自造的临时身份，以及为什么快照/还原整套删掉了
 * ---------------------------------------------------------------------------
 * 上一版给**用户自己的**既有管理员账号用 `issueAdminTokens` 签令牌，而
 * `registerAdminSession` 在该 userId 的设备数已达 `MAX_ACTIVE_DEVICES = 3` 时会
 * `revokeAdminSession` 掉最旧的一台（`src/lib/studio-session-registry.ts:55-61`）—— 本地正好三台，
 * 于是每一次跑都挤掉他一台真设备，再靠 `finally` 里的快照/还原补回去。那条路有三种漏法
 * （签发排在 `try` 之外、`finally` 里库内清场排在还原之前、SIGINT/SIGTERM 压根不走 `finally`），
 * 而且还原分不清「脚本自己上一轮的槽」和「真设备的槽」，会把僵尸会话放回一个 `MAX_ACTIVE_DEVICES`
 * 名额里（I-2）。现在一律换成 `scripts/check-billing-flow.mts:19-31 / :172-185` 那一套：
 * **会话按 userId 分片**（`admin:sessions:<uid>`），临时账号 `zcard` 恒为 1 ⇒ `overflow <= 0`
 * ⇒ 签发在结构上碰不到任何既有账号，快照/还原也就没有活可干，整块删除（连 I-2 一起消失）。
 * 换来的还有两枚本来要等 Task 8 的令牌：MEMBER 403 与非成员 403 就在这里打完了
 * （brief Step 3 划走的那条「MEMBER 403 与越权面要第二枚令牌」就地关闭，Task 8 的脚本仍保留它自己那份覆盖）。
 * `DISABLED` 团队也改成脚本自建，不再依赖用户的真团队。
 *
 * 代价：脚本自己造 2 个临时 User + 3 个临时 Team + 3 条 TeamMember，按 FK 顺序在 `finally` 里清。
 * 为了把「没碰用户的东西」变成可证的事，跑前跑后各读一次既有状态的指纹：
 * - 库里六张表（User / Team / TeamMember / TeamQuota / Settings / Plan / Order）逐行逐字节；
 * - Redis 五类键（`admin:sessions:* / admin:session:* / admin:device:* /
 *   blacklist:admin_session:* / token_fingerprint:*`）—— 正是 `issueAdminTokens` 会写的全部键形。
 *
 * 足迹与清理（跑前也按同一份命名空间清一次残留，`sweepDbFootprint()` 幂等）：
 * - 库里：邮箱 `billing-orders-check-*@example.invalid` 的临时 User、slug 前缀 `billing-orders-check-`
 *   的临时 Team 及其 TeamMember、`BCHECK-HTTP` 这张测试套餐与它名下的单（OrderEvent →
 *   PaymentAttempt → Order → Plan）。
 * - Redis：只删由临时 userId / 本次签出的 sessionId 派生出来的键；既有会话一个字节都不写。
 */
import { createHash, randomUUID } from 'crypto'
import { PrismaClient } from '@prisma/client'
import { NextRequest } from 'next/server'
import { POST } from '../app/api/billing/orders/route'
import { issueAdminTokens, verifyCredentials } from '@/lib/auth'
import { prisma as appPrisma } from '@/lib/db'
import { getRedis } from '@/lib/redis'
import { revokeAdminSession } from '@/lib/studio-session-registry'
import { hashPassword } from '@/lib/encryption'

const PLAN_KEY = 'BCHECK-HTTP'
const PRICE_CENTS = 39800
const PERIODS = 3
const AMOUNT_CENTS = PRICE_CENTS * PERIODS // 119400 —— 服务端算出来的，不是入参
const UNSAFE_KEYS = ['transferAccountNo', 'transferAccountName', 'transferBank', 'transferQrPath', 'transferNote', 'accessToken']

// 临时身份的命名空间：清理范围只按这两个前缀匹配。`.invalid` 是保留 TLD，
// 真账号不可能长这样 ⇒ 删除语句在结构上就够不到既有管理员账号。
const USER_PREFIX = 'billing-orders-check-'
const USER_DOMAIN = '@example.invalid'
const TEAM_PREFIX = 'billing-orders-check-'
const STAMP = Date.now()
const OWNER_EMAIL = `${USER_PREFIX}owner-${STAMP}${USER_DOMAIN}`
const MEMBER_EMAIL = `${USER_PREFIX}member-${STAMP}${USER_DOMAIN}`
// 口令是脚本自己造的随机值、跑完连账号一起删；不打日志、不落文件，也不需要人来提供。
// 不能用 `STAMP` 推导：邮箱前缀 + 同一个 STAMP 就在仓库里写着，崩溃残留的那一行
// （一个 role=ADMIN 的 User，邮箱在后台用户列表里可见）等于把口令抄在门上。
const OWNER_PASSWORD = randomUUID()
const MEMBER_PASSWORD = randomUUID()
// 脚本自己的设备指纹（只挂在临时账号身上，绝不复用真设备的指纹）。
const OWNER_FINGERPRINT = createHash('sha256').update(`billing-orders-check-owner ${STAMP}\nnode-tsx`).digest('base64url')
const MEMBER_FINGERPRINT = createHash('sha256').update(`billing-orders-check-member ${STAMP}\nnode-tsx`).digest('base64url')

// 传输层开关：默认同进程 import 真路由；给了 BASE_URL 就改打真 HTTP（brief Step 3 的原始形态）。
const BASE_URL = (process.env.BILLING_CHECK_BASE_URL || '').replace(/\/+$/, '')
const VIA_HTTP = BASE_URL.length > 0

// `issueAdminTokens(user, fingerprintHash)` 会写的全部键形 —— 一条不多、一条不少，
// 所以「跑完 Redis 回到逐字节原状」这件事是可以证死的，不需要扫全库。
const REDIS_PATTERNS = ['admin:sessions:*', 'admin:session:*', 'admin:device:*', 'blacklist:admin_session:*', 'token_fingerprint:*']
// `token_fingerprint:*` 本地就有 600+ 枚，只比键集合、不逐枚读值。
const REDIS_VALUE_PATTERNS = new Set(['admin:sessions:*', 'admin:session:*', 'admin:device:*', 'blacklist:admin_session:*'])

const prisma = new PrismaClient()
let passed = 0
const failures: string[] = []

// 收尾与断言要用，跨 `try`/`finally`/信号处理器共享。
const scriptUserIds: string[] = []
const scriptKeyParts: string[] = []   // 判定「这枚 Redis 键是本脚本造的」的依据（临时 uid + 本次签出的 sessionId）
let dbBefore: Record<string, Record<string, string>> | null = null
let redisBefore: Record<string, string> | null = null
let finished: Promise<void> | null = null

function expect(name: string, actual: unknown, want: unknown) {
  const ok = typeof want === 'number' && typeof actual === 'number'
    ? Math.abs(actual - want) < 1e-9
    : actual === want
  if (ok) passed += 1
  else failures.push(`${name}\n      expected ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`)
}

function expectTrue(name: string, ok: boolean, detail = '') {
  if (ok) passed += 1
  else failures.push(`${name}\n      ${detail || 'expected true'}`)
}

type Reply = { status: number; json: any; text: string }

async function reply(response: Response, label: string): Promise<Reply> {
  const text = await response.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { /* 非 JSON 响应由 text 断言兜住 */ }
  // M-3：收款信息/令牌的下发面要在**每一发**响应上扫，不是只扫第一发。
  const leaked = UNSAFE_KEYS.filter((key) => text.includes(key))
  expectTrue(`${label} 响应不含账号/令牌字段`, leaked.length === 0, `出现 ${leaked.join(', ')}：${text.slice(0, 200)}`)
  return { status: response.status, json, text }
}

async function call(
  body: unknown,
  token: string | null,
  teamId: string | null,
  label: string,
): Promise<Reply> {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (token) headers.set('authorization', `Bearer ${token}`)
  if (teamId) headers.set('x-team-id', teamId)
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  if (VIA_HTTP) {
    // 真 HTTP：brief Step 3 的原始形态，打到他自己的 next dev 上（只发请求，不管进程）。
    const response = await fetch(`${BASE_URL}/api/billing/orders`, { method: 'POST', headers, body: payload })
    return reply(response, label)
  }
  const request = new NextRequest('http://localhost:3000/api/billing/orders', {
    method: 'POST',
    headers,
    body: payload,
  })
  return reply(await POST(request), label)
}

// ---------- 状态指纹（只读） ----------

// 「既有状态」的指纹要**先把本脚本命名空间里的东西摘出去**：上一轮崩在中途会留下临时身份
// （实测：Ctrl-C 那次的 User/Team/Order/Plan 与它们派生的 Redis 键还在），如果把它们当成
// 「既有行」，本轮收尾时正常接走它们反而会把「既有行一枚没少」染成假红。
const SCRIPT_USER_EMAIL = { startsWith: USER_PREFIX, endsWith: USER_DOMAIN }
const SCRIPT_TEAM_SLUG = { startsWith: TEAM_PREFIX }
const SCRIPT_ORDER = { OR: [{ planKey: PLAN_KEY }, { team: { slug: SCRIPT_TEAM_SLUG } }] }

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
    prisma.plan.findMany({ where: { key: { not: PLAN_KEY } }, orderBy: { id: 'asc' } }),
    prisma.order.findMany({ where: { NOT: SCRIPT_ORDER }, orderBy: { id: 'asc' } }),
  ])
  return {
    User: rowMap(users),
    Team: rowMap(teams),
    TeamMember: rowMap(members),
    TeamQuota: rowMap(quotas),
    Settings: rowMap(settings),
    Plan: rowMap(plans),
    Order: rowMap(orders),
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
      // 跑前必须跳过：上一轮崩在这里留下的临时身份键不算「既有状态」。
      // 跑后要带上（传 true）：否则 `added.filter(isScriptKey)` 永远是空数组，
      // 「脚本自己的足迹已清零」那条断言就成了一句永远不会红的话。
      if (!includeScriptKeys && isScriptKey(key)) continue
      if (!readsValues) {
        state[key] = '-'
        continue
      }
      const type = await redis.type(key)
      // 带 WITHSCORES：zset 的指纹必须含分数，否则「到期时间没被动过」这件事根本不在比较范围内。
      state[key] = type === 'zset'
        ? `zset:${(await redis.zrange(key, 0, -1, 'WITHSCORES')).sort().join(',')}`
        : `${type}:${await redis.get(key)}`
    }
  }
  return state
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

/**
 * 把一个临时 userId 登记成「脚本自己的」，并顺手把它在 Redis 里已有的会话 id 也登记上。
 * 必须登记 id 而不只是 uid：`admin:session:<sid>` 与 `blacklist:admin_session:<sid>` 两族键名里
 * 没有 userId，只有 sid —— 上一轮崩在这里留下的那两枚若不算脚本键，本轮收尾删掉它们就会被
 * 「既有键一枚没少」判成假红（实测：Ctrl-C 那一次确实留下了）。
 */
async function noteScriptUser(userId: string) {
  if (!scriptUserIds.includes(userId)) scriptUserIds.push(userId)
  if (!scriptKeyParts.includes(userId)) scriptKeyParts.push(userId)
  for (const sid of await getRedis().zrange(`admin:sessions:${userId}`, 0, -1)) {
    if (!scriptKeyParts.includes(sid)) scriptKeyParts.push(sid)
  }
}

// ---------- 足迹清理（幂等，FK 顺序） ----------

/**
 * 只删本脚本命名空间里的东西。删除顺序由 FK 决定（Task 1 坐实）：
 * OrderEvent/PaymentAttempt 随 Order CASCADE 但显式删以便计数；Order 对 Team/User/Plan 都是
 * Restrict ⇒ 单必须先于团队与用户删；TeamMember 随 Team/User CASCADE，这里也显式删。
 * 清不干净不吞异常 —— 那是污染本地库。跑前也调一次，把上一次崩掉的残留接走。
 */
async function sweepDbFootprint() {
  const users = await prisma.user.findMany({
    where: { email: SCRIPT_USER_EMAIL },
    select: { id: true },
  })
  const userIds = users.map((u) => u.id)
  // 登记进 scriptUserIds/scriptKeyParts：这样它们在 Redis 里的痕迹也被认成「脚本自己的」，
  // 既不算既有状态，也不会漏进收尾的清扫。
  for (const id of userIds) await noteScriptUser(id)
  const teams = await prisma.team.findMany({
    where: { OR: [{ createdById: { in: userIds } }, { slug: SCRIPT_TEAM_SLUG }] },
    select: { id: true },
  })
  const teamIds = teams.map((t) => t.id)
  const orders = await prisma.order.findMany({
    where: { OR: [{ planKey: PLAN_KEY }, { teamId: { in: teamIds } }] },
    select: { id: true },
  })
  const orderIds = orders.map((o) => o.id)
  const events = await prisma.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } })
  const attempts = await prisma.paymentAttempt.deleteMany({ where: { orderId: { in: orderIds } } })
  const deletedOrders = await prisma.order.deleteMany({ where: { id: { in: orderIds } } })
  const plans = await prisma.plan.deleteMany({ where: { key: PLAN_KEY } })
  const memberships = await prisma.teamMember.deleteMany({
    where: { OR: [{ teamId: { in: teamIds } }, { userId: { in: userIds } }] },
  })
  const deletedTeams = await prisma.team.deleteMany({ where: { id: { in: teamIds } } })
  const deletedUsers = await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  return {
    users: deletedUsers.count,
    teams: deletedTeams.count,
    memberships: memberships.count,
    orders: deletedOrders.count,
    events: events.count,
    attempts: attempts.count,
    plans: plans.count,
    userIds,
    teamIds,
  }
}

/**
 * 回收本脚本签出的会话。`revokeAdminSession` 会删记录、zrem、删设备键；这里再把它留下的
 * `blacklist:admin_session:<sid>` 标记与 zset 空壳删干净 —— 那枚令牌只活在本进程的局部变量里，
 * 对应的账号马上就没了（撤销标记永远匹配不到任何真请求），留着就是一枚 30 天的垃圾键。
 * 键名一律由临时 userId / 本次 sessionId 拼出来，够不到任何既有会话。
 */
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

// ---------- 收尾：清场 + 把「没碰用户的东西」变成断言 ----------

async function finish() {
  try {
    // 每一步都单独兜住：Redis 清场失败不许挡住库内清场，反之也一样（I-1 第 2 条的根因就是
    // 两段清理排成了前后依赖）。
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

    // ---------- 清场回读（一律按脚本自己的命名空间数，不数全局：库里可能留着别人的行） ----------
    expect('清场后本脚本名下无残留 Order', await prisma.order.count({ where: SCRIPT_ORDER }), 0)
    expect('清场后无残留 BCHECK-HTTP 套餐（留着就是 Task 9 列表里一张看得见的假套餐）',
      await prisma.plan.count({ where: { key: PLAN_KEY } }), 0)
    expect('清场后无残留临时 User', await prisma.user.count({ where: { email: SCRIPT_USER_EMAIL } }), 0)
    expect('清场后无残留临时 Team', await prisma.team.count({ where: { slug: SCRIPT_TEAM_SLUG } }), 0)
    expect('清场后无残留临时 TeamMember',
      await prisma.teamMember.count({ where: { OR: [{ userId: { in: scriptUserIds } }, { team: { slug: SCRIPT_TEAM_SLUG } }] } }), 0)
    const eventWhere = { order: SCRIPT_ORDER }
    const orphanEvents = await prisma.orderEvent.count({ where: eventWhere })
    const orphanAttempts = await prisma.paymentAttempt.count({ where: eventWhere })
    expectTrue('清场后无孤儿 OrderEvent/PaymentAttempt', orphanEvents === 0 && orphanAttempts === 0,
      `OrderEvent ${orphanEvents} / PaymentAttempt ${orphanAttempts}`)

    // ---------- 既有状态逐字节回读（跑前指纹 vs 跑后指纹） ----------
    // 先拷成局部 const：`redisBefore`/`dbBefore` 是模块级 `let`，`await` 之后 TS 会丢掉对它们的窄化。
    const before = dbBefore
    if (before) {
      const after = await dbState()
      const foreign: string[] = []
      for (const [table, rows] of Object.entries(before)) {
        const d = diffRows(rows, after[table] ?? {})
        expectTrue(`既有 ${table} 行未被动过（一个没少、一个没改）`, d.gone.length === 0 && d.changed.length === 0,
          `少了 ${d.gone.length} 行 / 改了 ${d.changed.length} 行：${[...d.gone, ...d.changed].slice(0, 3).join(', ')}`)
        if (table === 'TeamQuota' || table === 'Settings') {
          // 这两张表「多出一行」本身就是事故（履约才会写额度，写设置只有那个路由），
          // 而本任务不可能并发写它们 ⇒ 这条断言可以硬。
          expectTrue(`${table} 没有多出任何一行（本任务不该写额度/设置）`, d.added.length === 0, d.added.slice(0, 3).join(', '))
        } else if (d.added.length) {
          foreign.push(`${table} +${d.added.length}`)
        }
      }
      // 别的表多出行只可能是并发跑的其他脚本留下的（本脚本自己名下的已由上面几条清零），
      // 打出来但不算失败 —— 否则这条门禁会被别人的跑动染红。
      if (foreign.length) console.warn(`注意：跑动期间这些表多出了行（不是本脚本造的）：${foreign.join(' / ')}`)
    } else {
      failures.push('跑前的库内状态指纹没拿到，既有表无法回读')
    }
    const beforeRedis = redisBefore
    if (beforeRedis) {
      const after = await redisState(true)
      const gone = Object.keys(beforeRedis).filter((k) => !(k in after))
      const changed = Object.keys(beforeRedis).filter((k) => k in after && beforeRedis[k] !== after[k])
      const added = Object.keys(after).filter((k) => !(k in beforeRedis))
      expectTrue('既有 Redis 会话键一枚没少（没有任何真会话被撤销或删除）', gone.length === 0, gone.slice(0, 3).join(', '))
      expectTrue('既有 Redis 会话键值逐字节未变（分数/记录/设备映射都没动）', changed.length === 0, changed.slice(0, 3).join(', '))
      const mine = added.filter(isScriptKey)
      expectTrue('脚本自己的 Redis 足迹已清零（没有属于临时身份的键残留）', mine.length === 0, mine.slice(0, 3).join(', '))
      const foreign = added.filter((k) => !isScriptKey(k))
      if (foreign.length) console.warn(`注意：跑动期间 Redis 新出现 ${foreign.length} 枚与本脚本无关的键（大概是用户自己登录/刷新），不计入失败`)
      console.log(`Redis 回读：跑前 ${Object.keys(beforeRedis).length} 枚 / 跑后 ${Object.keys(after).length} 枚（少 ${gone.length}、改 ${changed.length}、多 ${added.length}）`)
    } else {
      failures.push('跑前的 Redis 指纹没拿到，既有会话无法回读')
    }
  } finally {
    // 断开连接必须执行，否则进程挂住不退；三个连接池都要关（路由用的是 `@/lib/db` 那个单例）。
    for (const close of [() => getRedis().disconnect(), () => prisma.$disconnect(), () => appPrisma.$disconnect()]) {
      try { await close() } catch (error) { console.error('断开连接失败（不影响断言结果）：', error) }
    }
  }
}

function finishOnce(): Promise<void> {
  if (!finished) finished = finish()
  return finished
}

async function main() {
  for (const key of ['JWT_SECRET', 'DATABASE_URL', 'REDIS_HOST']) {
    if (!process.env[key]) {
      console.error(`缺少 ${key}：请用 \`npx tsx --env-file=.env src/disabled-billing/scripts/check-billing-orders-route.mts\` 运行`)
      process.exit(2)
    }
  }
  // I-1 第 3 条：Node 默认的 SIGINT/SIGTERM 处理不会走 `finally`，Ctrl-C 就等于把足迹留在库里。
  // 装一个处理器，按**同一条** `finishOnce()` 幂等清场后再退出。诚实说一句：实测这一路只能
  // 「尽力」—— 信号打紧、或第二枚信号（`once` 之后回到默认动作）会直接终止进程，清场做不完。
  // 真正的兜底是命名空间 + 幂等清扫：残留只可能是 `billing-orders-check-*` 与 `BCHECK-HTTP`，
  // 既占不到用户的任何设备槽（会话按 userId 分片，临时账号永远 zcard=1），也不会被下一轮漏掉
  // —— 下面那条 `try` 的第一件事就是把它们接走（本地实测：「发现上一次跑动的残留，先清掉」）。
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      console.error(`\n收到 ${signal}：先按 finally 同一条路径清场，再以 130 退出；清不完下一轮也会接走`)
      void finishOnce().finally(() => process.exit(130))
    })
  }
  // 真 HTTP 模式下，矩阵 ①（写新表）与 ④（读新表）就是「这个 next dev 进程里的 Prisma client
  // 是不是新的」的探针：旧 client 的签名是 500 + 空 body，会直接红在这两条断言上，不会静默放行。
  console.log(VIA_HTTP
    ? `传输层：真 HTTP → ${BASE_URL}/api/billing/orders（brief Step 3 原形态，只发请求，不碰进程）`
    : '传输层：同进程 import { POST }（不打 3000）')

  // 先认账：上一轮崩在中途没清干净的临时身份（实测 Ctrl-C 就能造出来）。把它们连同其 Redis 会话
  // 登记成「脚本自己的」，再取跑前指纹 —— 否则本轮收尾合法接走它们时，「既有行/既有键一枚没少」
  // 会被染成假红。
  const stale = await prisma.user.findMany({ where: { email: SCRIPT_USER_EMAIL }, select: { id: true } })
  for (const u of stale) await noteScriptUser(u.id)
  if (stale.length) console.log(`发现 ${stale.length} 个上一轮残留的临时身份，本轮收尾一并清掉`)

  dbBefore = await dbState()
  redisBefore = await redisState()
  console.log(`跑前既有数据：${Object.entries(dbBefore).map(([t, rows]) => `${t} ${Object.keys(rows).length}`).join(' / ')}`)
  console.log(`跑前既有 Redis 键：${Object.keys(redisBefore).length} 枚（只扫 ${REDIS_PATTERNS.join(' / ')}）`)

  // `try` 开在**第一个写操作之前**：签发令牌、建临时身份、造套餐，任何一步抛出去都能走到 `finally`。
  try {
    const leftovers = await sweepDbFootprint()
    if (leftovers.users || leftovers.teams || leftovers.orders || leftovers.plans) {
      console.log(`发现上一次跑动的残留，先清掉：User ${leftovers.users} / Team ${leftovers.teams} / `
        + `Order ${leftovers.orders} / Plan ${leftovers.plans}`)
    }

    // ---------- 三个临时身份：ACTIVE+OWNER / ACTIVE+MEMBER / ACTIVE 但本人不是成员 ----------
    // `role` 用 schema 默认 ADMIN（与上一轮打矩阵用的本地账号同形状）；`isPlatformAdmin` 留默认
    // false —— 这条链路（`getCurrentUserFromRequest` → `ownerTeam`）只读团队 membership，两处都不读。
    const owner = await prisma.user.create({
      data: { email: OWNER_EMAIL, name: 'billing-orders-check-owner', password: await hashPassword(OWNER_PASSWORD) },
    })
    const member = await prisma.user.create({
      data: { email: MEMBER_EMAIL, name: 'billing-orders-check-member', password: await hashPassword(MEMBER_PASSWORD) },
    })
    await noteScriptUser(owner.id)
    await noteScriptUser(member.id)
    const activeTeam = await prisma.team.create({
      data: { name: `${TEAM_PREFIX}active-${STAMP}`, slug: `${TEAM_PREFIX}active-${STAMP}`, shareKey: `bo-${STAMP}a`, createdById: owner.id, status: 'ACTIVE' },
    })
    const disabledTeam = await prisma.team.create({
      data: { name: `${TEAM_PREFIX}disabled-${STAMP}`, slug: `${TEAM_PREFIX}disabled-${STAMP}`, shareKey: `bo-${STAMP}d`, createdById: owner.id, status: 'DISABLED' },
    })
    // 建得出来、但 owner 没有任何 TeamMember 行：证「createdById 不等于授权」，也证解析器不会
    // 悄悄回落到别的团队。上一轮这件事只能蹭用户的真团队，现在不用了。
    const strangerTeam = await prisma.team.create({
      data: { name: `${TEAM_PREFIX}stranger-${STAMP}`, slug: `${TEAM_PREFIX}stranger-${STAMP}`, shareKey: `bo-${STAMP}s`, createdById: member.id, status: 'ACTIVE' },
    })
    const teamId = activeTeam.id
    await prisma.teamMember.createMany({
      data: [
        { teamId: activeTeam.id, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
        { teamId: activeTeam.id, userId: member.id, role: 'MEMBER', status: 'ACTIVE' },
        { teamId: disabledTeam.id, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
      ],
    })
    await prisma.plan.create({
      data: {
        key: PLAN_KEY, name: 'billing-check', priceCents: PRICE_CENTS, currency: 'CNY',
        durationDays: 31, maxMembers: 3, maxProjects: 4, maxVideos: 5, maxStorageGB: 6, active: true,
      },
    })

    // ---------- 两枚令牌：都签给临时账号 ----------
    // 口令校验用登录路由同一个校验器（`src/app/api/auth/login/route.ts:141-142` 调的就是
    // `verifyCredentials` + `issueAdminTokens`），所以「脚本自造的账号」也真走了一遍口令链。
    const verifiedOwner = await verifyCredentials(OWNER_EMAIL, OWNER_PASSWORD)
    expect('OWNER 临时账号的口令校验通过（与 /api/auth/login 同一个校验器）', verifiedOwner?.id, owner.id)
    const verifiedMember = await verifyCredentials(MEMBER_EMAIL, MEMBER_PASSWORD)
    expect('MEMBER 临时账号的口令校验通过', verifiedMember?.id, member.id)
    if (!verifiedOwner || !verifiedMember) {
      // 抛出去而不是 process.exit —— 那样才会走 finally，临时身份不会留在库里。
      throw new Error('verifyCredentials 没认出临时账号，矩阵无法继续')
    }
    const ownerTokens = await issueAdminTokens(verifiedOwner, OWNER_FINGERPRINT)
    const memberTokens = await issueAdminTokens(verifiedMember, MEMBER_FINGERPRINT)
    const bearer = ownerTokens.accessToken
    const memberBearer = memberTokens.accessToken
    console.log('令牌来源：verifyCredentials + issueAdminTokens（与 /api/auth/login 同一条链），两枚都签给脚本自造的'
      + '临时账号 —— 既有账号的会话只被读作跑前/跑后指纹，从未被写过、撤销过，更没有被挤掉过')
    // 会话按 userId 分片 ⇒ 溢出只可能发生在临时账号自己身上，而这正是下面那两条「既有键未变」断言要证的。
    expect('临时 OWNER 的会话槽数 = 1（挤槽逻辑压根没被触发）',
      (await getRedis().zrange(`admin:sessions:${owner.id}`, 0, -1)).length, 1)
    expect('临时 MEMBER 的会话槽数 = 1', (await getRedis().zrange(`admin:sessions:${member.id}`, 0, -1)).length, 1)

    // 前置：临时团队此刻不能有未终结订单 —— createOrder 会复用它，正例就不是「新建」而是「复用」了。
    expect('临时 ACTIVE 团队开局没有未终结单',
      await prisma.order.count({ where: { teamId, status: { in: ['OPEN', 'REPORTED'] } } }), 0)

    // Team/TeamQuota 只读快照：createOrder 不许延长期限，也不许碰额度（那是 fulfilment 的活）。
    const teamBefore = await prisma.team.findUniqueOrThrow({
      where: { id: teamId },
      select: { status: true, subscriptionPlan: true, subscriptionExpiresAt: true },
    })
    // M-2：行数看不出「就地 upsert」，所以按**整行值**快照（`fulfillOrder` 的 teamQuota.upsert
    // 会改 updatedAt/source/sourceOrderId，行数列数不到）。
    const quotaBefore = JSON.stringify(await prisma.teamQuota.findMany({ where: { teamId }, orderBy: { id: 'asc' } }))
    expect('临时团队开局没有 TeamQuota 行（履约才写额度）', quotaBefore, '[]')
    // 种子行不能被这次跑动改到：MONTHLY 的 0 价是「不编造定价」的证据。
    const seedBefore = await prisma.plan.findUnique({ where: { key: 'MONTHLY' }, select: { priceCents: true, active: true } })

    // ---------- 矩阵 1：正例（M-1：入参金额要挡在**首建**这一发） ----------
    // `amountCents: 1` 必须挂在 ① 上。挂在 ② 上是永真断言：① 已经建好行，② 落在 `createOrder`
    // 的复用分支，119400 是 ① 落库的值，服务端算价那一路（`src/lib/billing.ts` 里 `createOrder` 走到新建那一支才调的
    // `computeAmountCents(plan.priceCents, input.periods)`）根本没再进过一次。
    // `task-6-brief.md:148` 写的正是「① 干净、② 带金额」这个顺序 —— 缺陷出在 brief 的测试
    // 设计而不是实现（评审 M-1）。**别照 brief 那一行把两发换回去**：首建这一发必须带着脏入参，
    // 「入参金额被丢弃」这条不变量才有能红的那一次。
    const r1 = await call({ planKey: PLAN_KEY, periods: PERIODS, amountCents: 1 }, bearer, teamId, '① 首单')
    expect('① 有价套餐下单 200', r1.status, 200)
    expect('① 金额 = 服务端算的 priceCents × periods（入参 amountCents:1 在进 createOrder 前就被剥掉）',
      r1.json?.order?.amountCents, AMOUNT_CENTS)
    expect('① reused=false（这一发走的是新建分支，不是复用）', r1.json?.reused, false)
    expect('① 状态 OPEN', r1.json?.order?.status, 'OPEN')
    expect('① 币种取自 plan', r1.json?.order?.currency, 'CNY')
    expectTrue('① reference 形如 RV-XXXXXX（字母表去掉了 I/O/0/1）', /^RV-[A-HJ-NP-Z2-9]{6}$/.test(String(r1.json?.order?.reference)), String(r1.json?.order?.reference))
    expectTrue('① createdAt 是 ISO 串', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(String(r1.json?.order?.createdAt)))
    const firstOrderId = String(r1.json?.order?.id)

    // DTO 是后续任务（7/10/11）复用的契约：字段名多一个少一个都是断裂。
    const DTO_KEYS = ['id', 'reference', 'planKey', 'periods', 'amountCents', 'currency', 'status', 'createdAt',
      'reportedAt', 'paidAt', 'fulfilledAt', 'periodEnd', 'closeReason', 'reportNote',
      'invoiceRequested', 'invoiceTitle', 'invoiceTaxNo'].sort()
    expect('① OrderDto 字段契约（17 个键，不含 planName/账号）', JSON.stringify(Object.keys(r1.json?.order ?? {}).sort()), JSON.stringify(DTO_KEYS))
    expect('① 响应顶层只有 order 与 reused', JSON.stringify(Object.keys(r1.json ?? {}).sort()), JSON.stringify(['order', 'reused']))

    // ---------- 矩阵 2：复用分支也不许被入参金额改写 ----------
    const r2 = await call({ planKey: PLAN_KEY, periods: PERIODS, amountCents: 1 }, bearer, teamId, '② 复用')
    expect('② 带 amountCents 入参仍 200', r2.status, 200)
    expect('② 金额仍是服务端算的 119400（客户端金额被 zod 剥掉）', r2.json?.order?.amountCents, AMOUNT_CENTS)
    expect('② 复用同一张单', r2.json?.order?.id, firstOrderId)
    expect('② reused=true', r2.json?.reused, true)

    // ---------- 矩阵 3：periods 不在白名单 ----------
    const r3 = await call({ planKey: PLAN_KEY, periods: 2 }, bearer, teamId, '③ periods=2')
    expect('③ periods=2 拒 400（不是 500）', r3.status, 400)
    expect('③ 文案是时长那条', r3.json?.error, '续费时长只能是 1、3、6、12 期')
    expect('③ 没有因此多出订单', await prisma.order.count({ where: { planKey: PLAN_KEY } }), 1)

    // ---------- 矩阵 4：不存在的套餐 ----------
    const r4 = await call({ planKey: 'NOPE', periods: 1 }, bearer, teamId, '④ 未知套餐')
    expect('④ 未知 planKey 拒 400', r4.status, 400)
    expect('④ 未售文案', r4.json?.error, '该套餐尚未开放，请联系运营')

    // ---------- 矩阵 5：0 价种子行不可售 ----------
    const r5 = await call({ planKey: 'MONTHLY', periods: 1 }, bearer, teamId, '⑤ 0 价种子行')
    expect('⑤ MONTHLY（priceCents=0）拒 400', r5.status, 400)
    expect('⑤ 文案「该套餐尚未开放，请联系运营」', r5.json?.error, '该套餐尚未开放，请联系运营')
    expect('⑤ 库里没有 0 元单', await prisma.order.count({ where: { planKey: 'MONTHLY' } }), 0)

    // ---------- 矩阵 6：幂等复跑（brief 的第 6 发是干净入参） ----------
    const r6 = await call({ planKey: PLAN_KEY, periods: PERIODS }, bearer, teamId, '⑥ 幂等复跑')
    expect('⑥ 再次下单 200', r6.status, 200)
    expect('⑥ order.id 与第一次相同', r6.json?.order?.id, firstOrderId)
    expect('⑥ reused=true', r6.json?.reused, true)

    // ---------- 库里核对（brief Step 3 的 read-back） ----------
    const rows = await prisma.order.findMany({
      where: { planKey: PLAN_KEY },
      select: { id: true, reference: true, amountCents: true, status: true, teamId: true, periods: true, createdById: true },
    })
    console.table(rows)
    expect('核对 恰好 1 行（幂等生效，不是 2 行）', rows.length, 1)
    expect('核对 status 为 OPEN', rows[0]?.status, 'OPEN')
    expect('核对 amountCents', rows[0]?.amountCents, AMOUNT_CENTS)
    expect('核对 periods', rows[0]?.periods, PERIODS)
    expect('核对 teamId 由服务端从 membership 派生', rows[0]?.teamId, teamId)
    expect('核对 createdById 是持令牌的那个人', rows[0]?.createdById, owner.id)
    expect('核对 本次造的终结单数', await prisma.order.count({ where: { planKey: PLAN_KEY, status: { not: 'OPEN' } } }), 0)
    expect('核对 一期手写一条 manual attempt', await prisma.paymentAttempt.count({ where: { orderId: firstOrderId } }), 1)
    expect('核对 一条 CREATED 事件', await prisma.orderEvent.count({ where: { orderId: firstOrderId, type: 'CREATED' } }), 1)

    // ---------- 房外：发票三列要真的落到库里并从 DTO 回显（复用分支也要带） ----------
    const rInvoice = await call({ planKey: PLAN_KEY, periods: PERIODS, invoice: { requested: true, title: '甲方抬头', taxNo: 'TAX-A' } }, bearer, teamId, '⑦ 发票')
    expect('发票 复用分支不吞请求 200', rInvoice.status, 200)
    expect('发票 DTO 回显抬头', rInvoice.json?.order?.invoiceTitle, '甲方抬头')
    expect('发票 DTO 回显税号', rInvoice.json?.order?.invoiceTaxNo, 'TAX-A')
    expect('发票 DTO requested 为 true', rInvoice.json?.order?.invoiceRequested, true)
    const dbInvoice = await prisma.order.findUniqueOrThrow({ where: { id: firstOrderId }, select: { invoiceRequested: true, invoiceTitle: true, invoiceTaxNo: true } })
    expect('发票 库里真的写了（latest request wins）', JSON.stringify(dbInvoice), JSON.stringify({ invoiceRequested: true, invoiceTitle: '甲方抬头', invoiceTaxNo: 'TAX-A' }))

    // ---------- 门禁的第二、三侧（上一轮因为只有一枚令牌而记「未验证」） ----------
    // 同一团队、同一合法请求体，只把令牌换成 MEMBER 的：`route.ts:31` 的
    // `membership.role !== 'OWNER'` 从此有了一条能红的断言。
    const rMember = await call({ planKey: PLAN_KEY, periods: PERIODS }, memberBearer, teamId, '⑧ MEMBER')
    expect('MEMBER 下单拒 403', rMember.status, 403)
    expect('MEMBER 拒答文案（中文同族）', rMember.json?.error, '只有团队所有者可以下单')
    expect('MEMBER 的请求没有落单（ACTIVE 团队仍是 1 张）', await prisma.order.count({ where: { teamId } }), 1)
    // 不是这个团队的人拿这个团队的 id 来 —— 解析器返回 null，且**不许**悄悄回落到他自己的团队。
    const rStranger = await call({ planKey: PLAN_KEY, periods: PERIODS }, bearer, strangerTeam.id, '⑨ 非成员')
    expect('非成员请求别的团队拒 403', rStranger.status, 403)
    expect('非成员拒答文案', rStranger.json?.error, '只有团队所有者可以下单')
    expect('非成员的请求没有落单', await prisma.order.count({ where: { teamId: strangerTeam.id } }), 0)
    expect('非成员的请求也不会落到别的团队上', await prisma.order.count({ where: { teamId } }), 1)
    // MEMBER 同样进不了被停用的团队（两条谓词任缺其一都是 403）。
    const rMemberStranger = await call({ planKey: PLAN_KEY, periods: PERIODS }, memberBearer, strangerTeam.id, '⑩ MEMBER+非成员')
    expect('MEMBER 请求自己没加入的团队也拒 403', rMemberStranger.status, 403)

    // ---------- P-6 门禁：被平台停用的团队不再产生订单（脚本自建的 DISABLED 团队） ----------
    const rDisabled = await call({ planKey: PLAN_KEY, periods: PERIODS }, bearer, disabledTeam.id, '⑪ DISABLED 团队')
    expect('DISABLED 团队拒 403', rDisabled.status, 403)
    expect('DISABLED 团队拒答文案（中文同族）', rDisabled.json?.error, '只有团队所有者可以下单')
    expect('DISABLED 团队没有多出订单', await prisma.order.count({ where: { teamId: disabledTeam.id } }), 0)
    // 被拒的那几次不许泄漏到 ACTIVE 团队：仍然只有矩阵 1 那一张。
    expect('被拒的团队 id 不会落到 ACTIVE 团队', await prisma.order.count({ where: { teamId } }), 1)

    // ---------- 没登录 / 请求体不合法 ----------
    const rAnon = await call({ planKey: PLAN_KEY, periods: PERIODS }, null, teamId, '⑫ 无令牌')
    expect('无令牌 401', rAnon.status, 401)
    expect('无令牌文案', rAnon.json?.error, '未登录')
    const rGarbage = await call('not json', bearer, teamId, '⑬ 坏体')
    expect('非 JSON 体走 400 而不是崩', rGarbage.status, 400)
    expect('非 JSON 体落到 tolerant 分支 → schema 400', rGarbage.json?.error, 'Validation failed')
    const rFake = await call({ planKey: PLAN_KEY, periods: '3' }, bearer, teamId, '⑭ periods 是字符串')
    expect('periods 传字符串拒 400', rFake.status, 400)
    expect('拒绝后订单数不变', await prisma.order.count({ where: { planKey: PLAN_KEY } }), 1)

    // ---------- 只读的东西没被改到 ----------
    const teamAfter = await prisma.team.findUniqueOrThrow({
      where: { id: teamId },
      select: { status: true, subscriptionPlan: true, subscriptionExpiresAt: true },
    })
    expect('Team.status 未变', teamAfter.status, teamBefore.status)
    expect('Team.subscriptionPlan 未变', teamAfter.subscriptionPlan, teamBefore.subscriptionPlan)
    expect('Team.subscriptionExpiresAt 未变（createOrder 不延长期限）',
      teamAfter.subscriptionExpiresAt?.getTime(), teamBefore.subscriptionExpiresAt?.getTime())
    expect('TeamQuota 整行未变（连就地 upsert 也逃不过字段比对）',
      JSON.stringify(await prisma.teamQuota.findMany({ where: { teamId }, orderBy: { id: 'asc' } })), quotaBefore)
    const seedAfter = await prisma.plan.findUnique({ where: { key: 'MONTHLY' }, select: { priceCents: true, active: true } })
    expect('种子行 MONTHLY 未被改写', JSON.stringify(seedAfter), JSON.stringify(seedBefore))
  } finally {
    await finishOnce()
  }

  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) { console.log(failures.join('\n')); process.exit(1) }
}

// try 里抛出来的异常已经在 finally 里清过场了，这里只负责让它响。
main().catch((error) => { console.error(error); process.exit(1) })
