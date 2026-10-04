/**
 * Task 8 gate：`POST /api/billing/orders/:id/report` + Task 6/7 的下单/读面，一条命令跑完的
 * **真 HTTP** 复压脚本（只发请求，不管进程 —— 3000 上是用户自己起的 `next dev`）。
 *
 * 跑法（不需要任何凭据环境变量，身份全部由脚本自造，见下面的 Ruling T8-2）：
 *
 *   BILLING_CHECK_BASE=http://localhost:3000 node --env-file=.env scripts/billing-api-check.mjs
 *
 * `--env-file=.env` 是必须的：`new PrismaClient()` 要 `DATABASE_URL`（脚本不发令牌，JWT 不必读）。
 * 纯 `node`（不是 tsx）：这里只用内置 `fetch` + 既有依赖 `bcryptjs` / `@prisma/client`，零新增依赖。
 *
 * ---------------------------------------------------------------------------
 * 身份为什么必须自建（台账 Ruling T8-2，这条是本步骤的硬门禁）
 * ---------------------------------------------------------------------------
 * 会话注册表按 userId 分片，`MAX_ACTIVE_DEVICES = 3`，超出就撤销最旧的一枚
 * （`src/lib/studio-session-registry.ts:4,55-60`；平台侧同样 3 枚、TTL 12h，
 * `src/lib/platform-session-registry.ts:4,49-53`）。他本地那个真账号的注册表**正好是 3/3**，
 * 所以脚本只要登录任何**既有**账号，就会挤掉他浏览器里正在用的那一枚 —— 每跑一次掉线一次，
 * 而且他会算到这轮的交付物头上。三个身份全部 `prisma.user.create` 现造（`.invalid` 保留 TLD
 * ⇒ 删除语句在结构上够不到 admin@example.com），口令是运行时随机值、永不打印，
 * 令牌**只**从真实的 `POST /api/auth/login` / `POST /api/platform/auth/login` 换 ——
 * 这一发本身就是验收项（登录链 + 令牌在响应体里、不走 cookie），绕过它自铸令牌反而丢掉覆盖。
 * 收尾：团队令牌 `POST /api/auth/logout`、平台令牌 `POST /api/platform/auth/logout`（各走自己那一族的
 * 撤销链：删 session、zrem 会话表、删 device 指针），再把库内足迹全删掉并**读回核对**。跑完 Redis 里
 * 只会多几枚 30 天 TTL 的 `blacklist:admin_session:<sid>` 孤儿键，那是正常登出的既有行为，不断言它。
 *
 * ---------------------------------------------------------------------------
 * 命名空间（台账 Ruling T8-1）
 * ---------------------------------------------------------------------------
 * `BCHECK-RPT` / `billing-report-check-`，与 Task 6 的 `BCHECK-HTTP` + `billing-orders-check-`、
 * Task 7 的 `BCHECK-LIST*` + `billing-orders-list-check-` 都不构成前缀关系 —— 三只脚本各扫各的，
 * 谁也不会把别人的行当成自己的删掉，红的时候才知道是谁红。
 *
 * 下单正例不能用 `MONTHLY`：Task 1 的种子行 `priceCents = 0`，Task 6 的路由会拒未定价套餐
 * （0 元单等于白续一年），所以脚本自己 upsert 一张 `BCHECK-RPT`（39800 分 / 31 天）当可购套餐，
 * 按 PaymentAttempt / OrderEvent → Order → Plan 的 FK 顺序清掉（`Order.plan` 是 Restrict，
 * 先删 Plan 必失败）。清场只在 `finish()` 里做一遍，`process.exit` 也只在那里。
 *
 * 唯一有意偏离 brief 代码块的地方：`GET /api/billing/orders/:id/intent` 的期望状态码。
 * 本地 `Settings` 那五列现在是 NULL（Task 7 的脚本在同一个库上实测并断言 `configured === false`），
 * 而 Task 8 明令**不写 Settings**，所以正例只能是 503 那条分支：脚本先只读一次收款配置，
 * 按它决定期望值（配好了要 200 且必须带 `accountNo`；没配就要 503 且必须是那句能照着做的话）。
 * 写死 200 会让这条门禁在用户的机器上恒红，写死 503 又会在配置好之后变成假绿。
 */
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

const BASE = process.env.BILLING_CHECK_BASE || 'http://localhost:3000'
const PLAN_KEY = 'BCHECK-RPT'
const PRICE_CENTS = 39800
const USER_PREFIX = 'billing-report-check-'
const USER_DOMAIN = '@example.invalid'      // 保留 TLD：真账号不可能长这样 ⇒ 删除语句够不到 admin@example.com
const STAMP = Date.now().toString(36)
const prisma = new PrismaClient()
const failures = []
const created = { userIds: [], teamIds: [], tokens: [], platformTokens: [] }

// FK 顺序由 Task 1 坐实：Order 对 Team/User/Plan 全是 Restrict ⇒ 单必须先删，Plan/Team/User 后删。
// 一次跑动唯一的清扫实现：`finish()` 和「接走上一次崩溃残留」都调它，不写两遍。
async function purge({ userIds, teamIds }) {
  const ids = (await prisma.order.findMany({
    where: { OR: [{ planKey: PLAN_KEY }, { teamId: { in: teamIds } }] }, select: { id: true },
  })).map(o => o.id)
  const events = await prisma.orderEvent.deleteMany({ where: { orderId: { in: ids } } })
  const attempts = await prisma.paymentAttempt.deleteMany({ where: { orderId: { in: ids } } })
  const orders = await prisma.order.deleteMany({ where: { id: { in: ids } } })
  const plans = await prisma.plan.deleteMany({ where: { key: PLAN_KEY } })
  const memberships = await prisma.teamMember.deleteMany({ where: { OR: [{ teamId: { in: teamIds } }, { userId: { in: userIds } }] } })
  const teams = await prisma.team.deleteMany({ where: { id: { in: teamIds } } })
  const users = await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  return { events: events.count, attempts: attempts.count, orders: orders.count, plans: plans.count, memberships: memberships.count, teams: teams.count, users: users.count }
}

let exiting = false
// 唯一出口：先登出（走应用自己的撤销链清会话）再清库。`process.exit` 只出现在这里。
// 团队令牌走 `/api/auth/logout`，平台令牌走 `/api/platform/auth/logout` —— 不能像 brief 代码块那样
// 把两族令牌都交给前者：`revokePresentedTokens`（`src/lib/auth.ts:457-470`）只用 `ADMIN_ACCESS_SECRET`
// 解 sessionId，平台令牌（`PLATFORM_JWT_SECRET` 签）解不出来就被 `catch` 吞掉，于是它那一族的
// `revokePlatformSession` 从来没被调用过 —— 只留下 `blacklist:token:*` 那一枚散列。实测证据：
// 用 brief 原样连跑三轮后，Redis 里多出 3 组 `platform:sessions:* / platform:session:* /
// platform:device:*`（各 1 枚活会话，TTL 12h），键主是已被删掉的一次性平台账号。
// 对用户的实际风险为零（`getPlatformUserFromRequest` 每次都要回库读 User，行没了就是 401；
// refresh 令牌从不打印、从不落盘），但「跑完不留任何行」这件事也包括不留别人的会话壳子。
async function logout(token, endpoint) {
  await fetch(`${BASE}${endpoint}`, { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => null)
}
async function finish(code) {
  if (exiting) return
  exiting = true
  for (const token of created.tokens) await logout(token, '/api/auth/logout')
  for (const token of created.platformTokens) await logout(token, '/api/platform/auth/logout')
  try {
    const swept = await purge(created)
    console.log(`清场删除：OrderEvent ${swept.events} / PaymentAttempt ${swept.attempts} / Order ${swept.orders} / `
      + `Plan ${swept.plans} / TeamMember ${swept.memberships} / Team ${swept.teams} / User ${swept.users}`)
    // 收尾自查（不是装饰）：删完再读一次库。留着行 = 客户门户列表里多一张假套餐 / 多一个能登进去的账号，
    // 光靠「我调了 deleteMany」是看不出来的。读回非零就把退出码抬成 1，留人手工处理。
    const left = {
      plan: await prisma.plan.count({ where: { key: PLAN_KEY } }),
      order: await prisma.order.count({ where: { planKey: PLAN_KEY } }),
      user: await prisma.user.count({ where: { email: { startsWith: USER_PREFIX, endsWith: USER_DOMAIN } } }),
      team: await prisma.team.count({ where: { slug: { startsWith: USER_PREFIX } } }),
      teamMember: await prisma.teamMember.count({ where: { userId: { in: created.userIds } } }),
    }
    console.log(`清场读回（要求全 0）：${JSON.stringify(left)}`)
    if (left.plan || left.order || left.user || left.team || left.teamMember) {
      console.error('清场后仍有残留：', left)
      code = code || 1
    }
  } catch (error) {
    console.error(`清理失败，请手工删除 planKey=${PLAN_KEY} 的行与 ${USER_PREFIX}*${USER_DOMAIN} 账号/团队：`, error?.message)
    code = code || 1
  } finally {
    await prisma.$disconnect()
  }
  process.exit(code)
}

// Ctrl-C / SIGTERM / 顶层抛异常都不许把足迹留在库里：这三条路全部并进同一个 `finish()`
// （`exiting` 让它幂等）。诚实说一句：信号打得太急时清场仍可能做不完，真正的兜底是命名空间 +
// 下面那次「接走上一次残留」—— 残留只可能是本脚本自己的键名前缀，下一轮一定接走。
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    console.error(`\n收到 ${signal}：先按同一条 finish() 清场，再以 130 退出`)
    void finish(130)
  })
}
process.on('uncaughtException', (error) => {
  console.error(`未捕获异常：${error?.message ?? error}（先清场）`)
  void finish(1)
})

async function setupPlan() {
  await prisma.plan.upsert({
    where: { key: PLAN_KEY },
    update: { priceCents: PRICE_CENTS, active: true },
    create: {
      key: PLAN_KEY, name: 'billing-check', priceCents: PRICE_CENTS, currency: 'CNY', durationDays: 31,
      maxMembers: 3, maxProjects: 4, maxVideos: 5, maxStorageGB: 6, active: true,
    },
  })
}

async function call(method, path, { body, token, teamId, want } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  if (teamId) headers['x-team-id'] = teamId          // src/lib/team-access.ts:5 TEAM_HEADER
  const res = await fetch(`${BASE}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* 非 JSON 也照原样进 failures */ }
  const ok = res.status === want
  console.log(`${ok ? 'PASS' : 'FAIL'} ${method} ${path} → ${res.status} (want ${want})`)
  if (!ok) failures.push(`${method} ${path}: ${text.slice(0, 200)}`)
  return json
}

// 一次性身份：建号 → 建团队 → 走**真实**登录端点换令牌。
// 两个登录端点的字段名不一样，发错必 400：`/api/auth/login` 收 `email`（`src/lib/validation.ts:243`
// 的 `loginSchema`，`verifyCredentials` 对 email/手机号/用户名三选一匹配），
// `/api/platform/auth/login` 收 `identifier` 且只认 `isPlatformAdmin`（该路由 `:17,24`）。
// 返回体两边都是 `{ …, tokens: { accessToken } }`（团队侧另带 `success`），**令牌在响应体里、登录态不走 cookie**。
async function makeAccount({ tag, teams = [], platformAdmin = false }) {
  const password = randomBytes(24).toString('hex')
  const user = await prisma.user.create({
    data: {
      email: `${USER_PREFIX}${tag}-${STAMP}${USER_DOMAIN}`,
      name: `billing-report-check-${tag}`,
      password: await bcrypt.hash(password, 14),        // 与 hashPassword 同参数（src/lib/encryption.ts:162-169），否则 verifyCredentials 认不出
      ...(platformAdmin ? { isPlatformAdmin: true } : {}),
    },
  })
  created.userIds.push(user.id)
  const teamIds = []
  for (const [i, role] of teams.entries()) {
    const slug = `${USER_PREFIX}${tag}-${i}-${STAMP}`
    const t = await prisma.team.create({ data: { name: slug, slug, shareKey: `br${STAMP}${tag}${i}`, createdById: user.id, status: 'ACTIVE' } })
    created.teamIds.push(t.id)
    teamIds.push(t.id)
    await prisma.teamMember.create({ data: { teamId: t.id, userId: user.id, role } })
  }
  const isPlatform = platformAdmin
  const res = await fetch(`${BASE}${isPlatform ? '/api/platform/auth/login' : '/api/auth/login'}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(isPlatform ? { identifier: user.email, password } : { email: user.email, password }),
  })
  const json = await res.json().catch(() => null)
  const token = json?.tokens?.accessToken
  if (!token) {
    // 不重试：登录失败会写安全事件并入队一次外部通知（`api/auth/login/route.ts:81-131`）。
    console.error(`${tag} 登录失败 ${res.status}：${JSON.stringify(json)?.slice(0, 200)}`)
    await finish(2)
  }
  // 令牌按族存：清场时各自还各自的登出端点（见 finish() 上面那段）。
  ;(isPlatform ? created.platformTokens : created.tokens).push(token)
  return { userId: user.id, token, teamIds }
}

console.log(`目标：${BASE}　命名空间：plan=${PLAN_KEY} / user=${USER_PREFIX}*${USER_DOMAIN} / team slug=${USER_PREFIX}*`)

// 上一次崩在中途的残留先接走：不清掉的话，本轮「跑完不留一行」就是假的。
const stale = await prisma.user.findMany({
  where: { email: { startsWith: USER_PREFIX, endsWith: USER_DOMAIN } }, select: { id: true },
})
if (stale.length) {
  const staleIds = stale.map(u => u.id)
  const staleTeams = await prisma.team.findMany({
    where: { OR: [{ createdById: { in: staleIds } }, { slug: { startsWith: USER_PREFIX } }] }, select: { id: true },
  })
  await purge({ userIds: staleIds, teamIds: staleTeams.map(t => t.id) })
  console.log(`接走上一轮残留：User ${staleIds.length} / Team ${staleTeams.length}`)
}

await setupPlan()

// 收款配置**只读**（Task 8 不写 Settings，那行是真实运营数据）：intent 的期望状态码由它决定。
const transferRow = await prisma.settings.findUnique({
  where: { id: 'default' }, select: { transferAccountName: true, transferAccountNo: true },
})
const transferConfigured = Boolean(transferRow?.transferAccountName?.trim() && transferRow?.transferAccountNo?.trim())
console.log(`当前收款账户配置：${transferConfigured ? '已配置 ⇒ intent 正例要 200 并带账号' : '未配置 ⇒ intent 正例只能走 503 分支（Task 7 的 B 段覆盖 200 那侧）'}`)

// OWNER：团队侧主角（teams: ['OWNER'] = 给它建一支自己是 OWNER 的 ACTIVE 团队）
const ownerAccount = await makeAccount({ tag: 'owner', teams: ['OWNER'] })
const owner = ownerAccount.token
const team = { id: ownerAccount.teamIds[0] }
console.log(`OWNER 一次性团队 ${team.id}`)

// MEMBER：对照账号要同时满足两件事 —— 在主角团队里是 MEMBER（下单必须 403），
// 并且自己另有一支 ACTIVE 团队（跨团队越权才测得出来；同一支团队里换个人测不到这条）。
const memberAccount = await makeAccount({ tag: 'member', teams: ['OWNER'] })
await prisma.teamMember.create({ data: { teamId: team.id, userId: memberAccount.userId, role: 'MEMBER' } })
const member = memberAccount.token
const memberOwnTeam = { id: memberAccount.teamIds[0] }

const post = (body, want) => call('POST', '/api/billing/orders', { token: owner, teamId: team.id, body, want })
const a = await post({ planKey: PLAN_KEY, periods: 3 }, 200)
if (a?.order?.amountCents !== PRICE_CENTS * 3) failures.push(`金额不是服务端算的 3 倍价：${a?.order?.amountCents} ≠ ${PRICE_CENTS * 3}`)
const polluted = await post({ planKey: PLAN_KEY, periods: 3, amountCents: 1 }, 200)
if (polluted?.order?.amountCents !== a?.order?.amountCents) failures.push(`客户端塞 amountCents:1 影响了结果：${polluted?.order?.amountCents} vs ${a?.order?.amountCents}`)
await post({ planKey: PLAN_KEY, periods: 2 }, 400)          // 非白名单 periods
await post({ planKey: 'NOPE', periods: 1 }, 400)           // 不存在的套餐
await post({ planKey: 'MONTHLY', periods: 1 }, 400)        // 未定价的种子行不可售（Task 6 的守卫）
const b = await post({ planKey: PLAN_KEY, periods: 3 }, 200)
if (a?.order?.id !== b?.order?.id) failures.push(`幂等失效：${a?.order?.id} vs ${b?.order?.id}`)
if (b?.reused !== true) failures.push('复用已有单时 reused 应为 true')
// Task 3 评审 I-2：复用分支上的开票需求不能静默丢掉（写侧），下面这行同时验证读侧把它带回响应。
const withInvoice = await post({ planKey: PLAN_KEY, periods: 3, invoice: { requested: true, title: '测试工作室', taxNo: '91310000MA1TEST0' } }, 200)
if (withInvoice?.order?.invoiceRequested !== true || withInvoice?.order?.invoiceTitle !== '测试工作室') {
  failures.push(`复用分支丢了开票需求：${JSON.stringify({ r: withInvoice?.order?.invoiceRequested, t: withInvoice?.order?.invoiceTitle })}`)
}

const list = await call('GET', '/api/billing/orders', { token: owner, teamId: team.id, want: 200 })
const hasAccount = JSON.stringify(list).match(/accountNo|accountName|transferAccount/i)
if (hasAccount) failures.push(`订单列表接口泄漏收款字段：${hasAccount[0]}`)   // spec §11.3：账号只从 intent 流出
if ((list?.plan ?? []).some(p => p.priceCents <= 0)) failures.push('未定价套餐出现在门户套餐列表里（界面会给出点了必失败的卡片）')
// 收款码的团队侧读接口（Task 7 Step 3）：没登录必须 401，绝不能是公开可读
await call('GET', '/api/billing/transfer/qr', { want: 401 })

const oid = a?.order?.id
if (!oid) {
  // 下单正例没给 id，后面每一条 `:id` 断言都会打在 `undefined` 上（红是真的红，但它证的不是本任务）。
  // 直接收尾：这是「崩在中途」最贵的一种，必须走清场那条路。
  failures.push('下单正例没有返回 order.id，:id 断言无法继续')
  console.error(failures.join('\n'))
  await finish(1)
}
// intent 是收款字段的**唯一**出口（spec §11.3），所以它的期望值跟着服务端配置走，见文件头那段。
const intent = await call('GET', `/api/billing/orders/${oid}/intent`, { token: owner, teamId: team.id, want: transferConfigured ? 200 : 503 })
if (transferConfigured) {
  // 配好了就必须把客户照着能打的字全带回来：账号、户名、金额、转账备注一个都不能少。
  if (!intent?.accountNo || !intent?.accountName
    || intent?.amountCents !== a?.order?.amountCents || intent?.reference !== a?.order?.reference) {
    failures.push(`收款账户已配置，intent 却没把账号/金额/备注完整带回来：${JSON.stringify(intent)?.slice(0, 200)}`)
  }
} else if (intent?.error !== '平台尚未配置收款账户，请联系运营') {
  // 没配就必须落在那句能照着做的话上（不是 500、不是空响应）；200 那一侧由 Task 7 的 B 段覆盖。
  failures.push(`未配置收款账户时 intent 的 503 文案不是那句能照着做的话：${JSON.stringify(intent)?.slice(0, 200)}`)
}
await call('POST', `/api/billing/orders/${oid}/intent`, { token: owner, teamId: team.id, want: 405 })
await call('POST', '/api/billing/orders', { token: member, teamId: team.id, body: { planKey: PLAN_KEY, periods: 1 }, want: 403 })
// 越权面（spec §12.8）：MEMBER 带着自己那支团队的 teamId 去打别人团队的订单。
// 单订单 GET 路由本计划不建，所以越权用「列表面不到 + 动作改不动」两条来证。
const foreign = await call('GET', '/api/billing/orders', { token: member, teamId: memberOwnTeam.id, want: 200 })
if ((foreign?.orders ?? []).some(o => o.id === oid)) failures.push('越权：别人团队的订单出现在了这个团队的账单列表里')
// 没令牌必须 401，且不能因为「这张单不存在」就先把授权顺序让出去（门禁排在 CAS 之前）。
// 用一个不存在的 id：路由若把 401 弄丢了，这一发只会拿到 403/409 —— 红得了，不是空断言。
await call('POST', '/api/billing/orders/cmubillingchecknosuchid/report', { body: {}, want: 401 })
await call('POST', `/api/billing/orders/${oid}/report`, { token: member, teamId: memberOwnTeam.id, body: {}, want: 409 })
// Step 1 的门禁正面：报付款**不查 `role === 'OWNER'`** —— 看得到账单就报得出去，所以 MEMBER 报
// 自己团队的单要 200。这一发同时是「审计值只能取自会话」的探针：body 里故意塞两枚假 id。
// 路由若真去读 `actorUserId`，`orderEvent.create` 会撞 User 的 FK（Restrict）→ 500；若去读
// `teamId`，CAS 的谓词落空 → 409。两种走法都会把这一行染红，正确行为是 zod 把它们剥掉。
// 而下单人是 OWNER、报付款人是 MEMBER —— 只有这两枚 id 不同，「actor 取了会话值」这件事才是可证的
// （同一个人报自己下的单时，取会话值与回落到 createdById 得到同一个答案，那条断言就是空的）。
const reported = await call('POST', `/api/billing/orders/${oid}/report`, {
  token: member, teamId: team.id,
  body: { reportNote: '自动检查', actorUserId: 'cmbcheckfake000000000000a', teamId: 'cmbcheckfake000000000000b' },
  want: 200,
})
// 同一张单第二次报付款（换成 OWNER、干净 body）→ 409：状态谓词真的在判，不是只判了团队。
await call('POST', `/api/billing/orders/${oid}/report`, { token: owner, teamId: team.id, body: {}, want: 409 })
await call('GET', `/api/billing/orders/${oid}/intent`, { token: owner, teamId: team.id, want: 409 })   // 已报付款不再给账号

// 报付款的落库面：HTTP 响应里看不到「谁报的」（DTO 是白名单，故意不给 createdById），
// 而 I-3 要证的恰恰就是这个值 —— 只能在库里证。下面这几条是本任务的靶心，不是附加装饰：
// actor 错了（回落到下单人 / 取了 body 值）在界面上永远是绿的。
const orderRow = await prisma.order.findUnique({ where: { id: oid }, select: { status: true, reportNote: true, reportedAt: true, teamId: true, createdById: true } })
const reportEvent = await prisma.orderEvent.findFirst({ where: { orderId: oid, type: 'REPORTED' }, orderBy: { at: 'desc' } })
const reportEventCount = await prisma.orderEvent.count({ where: { orderId: oid, type: 'REPORTED' } })
if (orderRow?.status !== 'REPORTED') failures.push(`库里状态不是 REPORTED：${orderRow?.status}`)
if (orderRow?.reportNote !== '自动检查') failures.push(`库里 reportNote 没落进去：${JSON.stringify(orderRow?.reportNote)}`)
if (!orderRow?.reportedAt) failures.push('库里 reportedAt 为空')
if (orderRow?.teamId !== team.id) failures.push(`库里 teamId 不是 membership 派生的那支：${orderRow?.teamId}`)
if (reportEventCount !== 1) failures.push(`REPORTED 事件写了 ${reportEventCount} 条（被拒的那一发不该留痕，一条 CAS 失败的点击不该有审计记录）`)
if (reportEvent?.actorUserId !== memberAccount.userId || reportEvent?.actorUserId === orderRow?.createdById) {
  failures.push(`REPORTED 事件的 actor 不是报付款的那个人（I-3）：${reportEvent?.actorUserId} ≠ ${memberAccount.userId}（下单人是 ${orderRow?.createdById}，两者必须分开）`)
}
// 把这枚靶心值直接印出来：两者必须是**两个不同的 id**，否则上面那条 actor 断言就是在比一个
// 自己等于自己的数（下单人与报付款人同一人时，「取会话值」和「回落 createdById」给同一个答案）。
console.log(`审计靶心：下单人 createdById=${orderRow?.createdById} / REPORTED 事件 actor=${reportEvent?.actorUserId}（MEMBER 的 userId=${memberAccount.userId}）`)
if (reported?.order?.status !== 'REPORTED' || reported?.order?.reportNote !== '自动检查') {
  failures.push(`报付款响应 DTO 没回显新状态：${JSON.stringify({ s: reported?.order?.status, n: reported?.order?.reportNote })}`)
}
if (reported?.order?.reportedAt == null) failures.push('报付款响应 DTO 的 reportedAt 为空')
const leakedReport = ['accountNo', 'accountName', 'transferAccount', 'createdById', 'accessToken'].filter(k => JSON.stringify(reported ?? '').includes(k))
if (leakedReport.length) failures.push(`报付款响应泄漏了字段：${leakedReport.join(',')}`)
// DTO 是后续任务（9/10/11）复用的契约：路由这里最容易写错的是「顺手 return 整行 Order」——
// 那会多带 `plan`/`attempts`/`events`/`createdById`，而字段名多一个少一个界面就会崩。
const DTO_KEYS = ['id', 'reference', 'planKey', 'periods', 'amountCents', 'currency', 'status', 'createdAt',
  'reportedAt', 'paidAt', 'fulfilledAt', 'periodEnd', 'closeReason', 'reportNote',
  'invoiceRequested', 'invoiceTitle', 'invoiceTaxNo'].sort()
if (JSON.stringify(Object.keys(reported?.order ?? {}).sort()) !== JSON.stringify(DTO_KEYS)) {
  failures.push(`报付款响应的 OrderDto 键集与 Task 6 的契约不一致：${JSON.stringify(Object.keys(reported?.order ?? {}).sort())}`)
}
if (JSON.stringify(Object.keys(reported ?? {}).sort()) !== JSON.stringify(['order'])) {
  failures.push(`报付款响应顶层不是只有 order：${JSON.stringify(Object.keys(reported ?? {}).sort())}`)
}

// 收款信息的门禁面（spec §12 负例 11、12）
await call('GET', '/api/settings', { token: owner, teamId: team.id, want: 403 })
// 平台腿同样用一次性身份：`isPlatformAdmin: true` 就够（该路由只判这一个字段，不判 role）。
// 登他的平台账号会在平台会话表里挤掉他浏览器里那一枚，跟团队侧同一个道理。
const platformAccount = await makeAccount({ tag: 'platform', platformAdmin: true })
const platform = platformAccount.token
const s = await call('GET', '/api/settings', { token: platform, want: 200 })
const got = ['transferAccountName', 'transferAccountNo', 'transferBank', 'transferNote', 'transferQrPath'].filter(k => k in (s ?? {}))
if (got.length !== 5) failures.push(`平台 GET /api/settings 收款列不全：${got.join(',')}（整行展开是预期，见 spec §4.6）`)
await call('GET', '/api/settings/transfer', { token: platform, want: 200 })

// 三个身份 + 一张测试套餐的足迹由 `finish()` 负责清干净，它自己会读回核对（见上面的 `left`）。
console.log(`\n${failures.length ? failures.join('\n') : '全部通过'}`)
await finish(failures.length ? 1 : 0)
