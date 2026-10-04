/**
 * Task 11 门禁：`/api/platform/orders*` 四枚端点的一条命令复压脚本（台账裁定 D-16）。
 *
 * 跑法（不需要任何凭据环境变量，身份全部由脚本自造）：
 *
 *   cd /Users/xiaoxiaobai/code/xiaobaic-review \
 *     && BILLING_CHECK_BASE=http://localhost:3000 node --env-file=.env scripts/check-platform-orders.mjs
 *
 * `--env-file=.env` 是必须的：`new PrismaClient()` 要 `DATABASE_URL`。纯 `node`（不是 tsx）、
 * 零新增依赖：内置 `fetch` + 既有依赖 `bcryptjs` / `@prisma/client`。
 * 3000 上是用户自己起的 `next dev`：**本脚本只发 HTTP 请求**，不管进程、不起服务、不重启它；
 * 第一发请求 `ECONNREFUSED` 就以 3 退出并打印 `BLOCKED`（见 `probe()`），不做任何库内写入。
 *
 * ---------------------------------------------------------------------------
 * 为什么这四枚端点必须用可重跑的断言脚本，而不是几条 curl（裁定 D-16）
 * ---------------------------------------------------------------------------
 * `confirm` 是全站唯一会把一个真实客户的 `subscriptionExpiresAt` 前移、并覆盖其额度的写入口。
 * 拿它做验证如果随手写几条 curl，会踩两条硬红线：
 * ① 给**既有**账号铸令牌 —— 会话注册表 `MAX_ACTIVE_DEVICES = 3`，他本地那个真账号正好 3/3，
 *    脚本一登录就挤掉他浏览器正在用的那一枚（`src/lib/studio-session-registry.ts:4,55-60`，
 *    平台侧同 3 枚：`src/lib/platform-session-registry.ts:4,49-53`）。
 * ② 造出来的 Order / TeamQuota / Team 留在库里 —— 后续每一只断言脚本的红绿都不再可信。
 * 所以身份法照抄 `scripts/billing-api-check.mjs` 的精神，一字不改：四枚身份全部（`owner` / `admin` /
 * `admin2` / `exadmin` —— 比 brief 说的「三个」多一枚，多出来的 `admin2` 是断言 2b 要的「平台管理员
 * 但手里只有团队受众令牌」那一枚；`User.email` 唯一，同一个人没法既走平台登录又走团队登录复用同一行）
 * `prisma.user.create` 现造，邮箱 `${前缀}${tag}-${STAMP}@example.invalid`（保留 TLD ⇒ 清扫语句
 * 在结构上够不到 `admin@example.com`），口令 `randomBytes` 运行时生成、**永不打印**；令牌**只**从
 * 真实登录端点换（团队侧 `POST /api/auth/login` 收 `email`，平台侧 `POST /api/platform/auth/login`
 * 收 `identifier` 且只认 `isPlatformAdmin`）。**绝不自铸 JWT、绝不给任何既有用户铸令牌、
 * 绝不吊销/改动既有会话。** 收尾两族各走自己的登出端点，再按 FK 顺序删干净并**读回核对为 0**。
 * 唯一无法清的足迹是登录审计行（`ADMIN_PASSWORD_LOGIN_SUCCESS` 的 SecurityEvent 与一条
 * `ADMIN_ACCESS` 外部通知）—— 那是产品审计数据，删它比留它更糟，`billing-api-check.mjs` 同样留两枚。
 *
 * ---------------------------------------------------------------------------
 * 命名空间（台账裁定 T8-1 的延续）
 * ---------------------------------------------------------------------------
 * `plan.key = 'BCHECK-PORDER'`、user/team 前缀 `platform-orders-check-`。
 * 与既有 `BCHECK-RPT` / `BCHECK-HTTP` / `BCHECK-LIST` / `-LIST9` / `-LIST0` / `-LISTOFF` 均不构成
 * 前缀关系；各脚本只扫自己的精确 key / 自己的前缀，谁也不吞谁的行。
 *
 * ---------------------------------------------------------------------------
 * 断言 5 为什么用「子进程直调」而不是在脚本里抄一遍算式
 * ---------------------------------------------------------------------------
 * D-16 要的是预览端点与**真实现** `computeFulfillmentPreview()` 逐字段相同。`.mjs` + 纯 `node`
 * 不能 import `.ts`（`billing-pricing.ts:12` 的 `constructor(public code: …)` 是 parameter property，
 * strip-only 模式直接 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`，09-25 实测），也不能引新依赖。
 * ⇒ 用 `node --experimental-transform-types -e` 起一枚一次性子进程，import **同一个源文件**、
 * 调**同一个函数**、把结果 JSON 打回来。仍然是纯 node，零新依赖，且红线（不重启他的 dev server）
 * 一点没碰。脚本里不复制任何算式，所以「两处不一致」这件事只可能由实现本身红出来。
 * 入参由脚本**独立**从库里读出来再喂给真函数：路由侧任何拿错入参的写法（periods、durationDays、
 * 额度来源、quotaSource 漏传、给 null 额度兜默认值）都会以逐字段差异红出来。一处例外要说白：
 * `quotaSource` 的**塌缩规则**（`MANUAL` 之外一律 `PLAN`）在夹具里被照抄成同一式，规则本身写错时
 * 两侧同时错、断言照绿 —— 断言 5 证的是路由接线，不是那枚映射（详见 `previewInputFor()` 上方）。
 * 为了让比较不受毫秒漂移影响，团队 A 的 `subscriptionExpiresAt` 钉成「此刻 + 10 天」的整秒值：
 * 到期日在未来时 `nextExpiryMs()` 的基准就是那一列本身，与 `nowMs` 无关（`billing-pricing.ts:51`）。
 *
 * 收款配置（`Settings` 那五列 transfer*）本脚本**既不读也不写**：四枚端点里没有任何一条链路会碰它。
 * 其余读它的端点这里说准（Task 15 按评审 m-3 修正旧措辞——「intent 路由才是唯一读它的端点」偏松）：
 * 客户侧有两枚 —— intent 路由（`intent/route.ts:42` 调 `getPaymentProvider().createIntent()`，实现在
 * `payment-provider.ts:59`，配置就读在它下一行 `:60` 的 `getTransferConfig()`）与收款码路由
 * （`billing/transfer/qr/route.ts:24` 直读）；平台侧 `settings/transfer` 的 GET/PATCH 也读。
 * 这三面的覆盖**并不齐**，别说成「已由 `billing-api-check.mjs` 覆盖」：那支脚本 `:259` 的收款码那一发是
 * **无令牌 ⇒ 401**，在 `qr/route.ts:24` 之前就返回了，证的是闸门不是读配置；认证态收款码的七档
 * （未登录/非成员/停用团队/未上传/png/jpg/文件失踪）在 `check-billing-read-routes.mts` 里
 * `// ---------- Step 3：收款码` 那一组起（后三档在它的 B 段，即填上收款配置之后）；
 * `settings/transfer` 那边 `billing-api-check.mjs:350` 只有 GET 200，**PATCH 全仓无脚本覆盖**。
 * （Task 15 评审 M-1：旧稿此处写作「已由 `billing-api-check.mjs` 覆盖」，与上面三条实测不符，已改口。）
 *
 * 跑之前请先确认没有别的断言在飞（台账硬规则：可能碰 `Settings` 的脚本同一时刻只允许一枚）：
 *   ps -eo pid,etime,command | grep -E "check-.*\.(mjs|mts)"
 *
 * ---------------------------------------------------------------------------
 * Task 12 的跨任务追加（控制者点单，裁定 D-18；不是本脚本原作者的自发改动）
 * ---------------------------------------------------------------------------
 * `GET /api/platform/orders` 的响应契约由 Task 12 补了第三枚键 `total`（与当前 `status` 筛选同谓词
 * 的行数，`src/app/api/platform/orders/route.ts`），因此：顶层键集合那一发从 `['counts','orders']`
 * 改成 `['counts','orders','total']`，并新增 `[4b]` 一节逐筛选核对 `total`。身份法、清理链、
 * 其余断言一字未动。
 *
 * Task 12 fix round 1 的同一批追加（控制者裁定 D-25）：`GET /api/platform/orders/[id]` 的响应体
 * 补了一枚与 `preview` **同级**的 `currentQuota`（库里那一行 TeamQuota 的四列，缺行时为 `null`），
 * 用来让确认弹窗把「额度 旧 → 新」的旧字真摊出来。于是：详情顶层键集合那一发从 `['order','preview']`
 * 改成 `['currentQuota','order','preview']`（**这条不改就会红，那是断言过时不是实现错了**），
 * 并新增「A 无额度行 ⇒ null」「B 四列逐项回读库里 TeamQuota」「currentQuota 不进 preview」三组断言。
 * `PreviewResult` 的字段集一字未动 ⇒ 断言 5 那发逐字段比对仍是绿的。
 */
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

const BASE = process.env.BILLING_CHECK_BASE || 'http://localhost:3000'
const PLAN_KEY = 'BCHECK-PORDER'
const PLAN_NAME = 'billing-porder-check'
const PRICE_CENTS = 39800
const DURATION_DAYS = 31
const PERIODS_A = 3          // 团队 A 的单：93 天，够把「叠加天数」核对成一个精确毫秒数
const PERIODS_B = 1
const USER_PREFIX = 'platform-orders-check-'
const USER_DOMAIN = '@example.invalid'      // 保留 TLD ⇒ 清扫语句结构上够不到真账号
const STAMP = Date.now().toString(36)
const DAY = 86_400_000
// 钉死的到期基准：未来 10 天，整秒（见文件头「断言 5」那段）
const EXPIRY_MS = (Math.floor(Date.now() / 1000) + 10 * 86_400) * 1000
const PRICING_TS = new URL('../lib/billing-pricing.ts', import.meta.url).href
const STATUSES = ['OPEN', 'REPORTED', 'PAID', 'FULFILLED', 'CLOSED']
// 契约：OrderDto（Task 6 的白名单，17 列）+ 平台端独有的两个名字
const ROW_KEYS = [...['id', 'reference', 'planKey', 'periods', 'amountCents', 'currency', 'status', 'createdAt',
  'reportedAt', 'paidAt', 'fulfilledAt', 'periodEnd', 'closeReason', 'reportNote',
  'invoiceRequested', 'invoiceTitle', 'invoiceTaxNo', 'teamName', 'planName']].sort()

const prisma = new PrismaClient()
const failures = []
let assertionCount = 0
const created = { userIds: [], teamIds: [], orderIds: [], tokens: [], platformTokens: [] }
// 脚本自生成的凭据：只用来在响应体里查泄漏，永不打印（见 redact()）
const guarded = []

function redact(text) {
  let out = String(text ?? '')
  for (const secret of guarded) if (secret) out = out.split(secret).join('[已脱敏]')
  return out.slice(0, 240)
}

function expect(label, ok, detail) {
  assertionCount += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail === undefined ? '' : `　→ ${detail}`}`)
  if (!ok) failures.push(`${label}${detail === undefined ? '' : `　→ ${detail}`}`)
  return ok
}

function dump(label, value) {
  console.log(`     ${label} ${redact(JSON.stringify(value))}`)
}

// FK 顺序由 Task 1 坐实：Order 对 Team/User/Plan 全是 Restrict ⇒ 单必须先删，Plan/Team/User 后删。
// TeamQuota 对 Team 是 Cascade，这里仍显式删一遍并读回：`confirm` 是这些脚本里唯一会**新建**
// 额度行的路径，把「不留额度行」这件事押在 schema 的级联上，等于押在下次改 schema 的人身上。
async function purge({ userIds, teamIds }) {
  const ids = (await prisma.order.findMany({
    where: { OR: [{ planKey: PLAN_KEY }, { teamId: { in: teamIds } }] }, select: { id: true },
  })).map(o => o.id)
  const events = await prisma.orderEvent.deleteMany({ where: { orderId: { in: ids } } })
  const attempts = await prisma.paymentAttempt.deleteMany({ where: { orderId: { in: ids } } })
  const orders = await prisma.order.deleteMany({ where: { id: { in: ids } } })
  const plans = await prisma.plan.deleteMany({ where: { key: PLAN_KEY } })
  const quotas = await prisma.teamQuota.deleteMany({ where: { teamId: { in: teamIds } } })
  const memberships = await prisma.teamMember.deleteMany({ where: { OR: [{ teamId: { in: teamIds } }, { userId: { in: userIds } }] } })
  const teams = await prisma.team.deleteMany({ where: { id: { in: teamIds } } })
  const users = await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  return { events: events.count, attempts: attempts.count, orders: orders.count, plans: plans.count, quotas: quotas.count, memberships: memberships.count, teams: teams.count, users: users.count }
}

let exiting = false
// 唯一出口：先按族登出（走应用自己的撤销链清会话），再清库，最后读回核对。
// 团队令牌给 `/api/auth/logout`、平台令牌给 `/api/platform/auth/logout`：`revokePresentedTokens`
// 只用 `ADMIN_ACCESS_SECRET` 解 sessionId，把平台令牌交给它会静默不撤销那一族（见
// `billing-api-check.mjs` 头注释同段的实测记录）。
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
      + `Plan ${swept.plans} / TeamQuota ${swept.quotas} / TeamMember ${swept.memberships} / Team ${swept.teams} / User ${swept.users}`)
    // 收尾自查（不是装饰）：删完再读一次库。光靠「我调了 deleteMany」看不出留没留行，
    // 而留一行 = 客户的账单页多一张假套餐、平台队列多一张假单、多一个能登进去的账号。
    const left = {
      plan: await prisma.plan.count({ where: { key: PLAN_KEY } }),
      order: await prisma.order.count({ where: { planKey: PLAN_KEY } }),
      orderByTeam: await prisma.order.count({ where: { teamId: { in: created.teamIds } } }),
      orderEvent: await prisma.orderEvent.count({ where: { orderId: { in: created.orderIds } } }),
      paymentAttempt: await prisma.paymentAttempt.count({ where: { orderId: { in: created.orderIds } } }),
      teamQuota: await prisma.teamQuota.count({ where: { teamId: { in: created.teamIds } } }),
      quotaByOrder: await prisma.teamQuota.count({ where: { sourceOrderId: { in: created.orderIds } } }),
      user: await prisma.user.count({ where: { email: { startsWith: USER_PREFIX, endsWith: USER_DOMAIN } } }),
      team: await prisma.team.count({ where: { slug: { startsWith: USER_PREFIX } } }),
      teamMember: await prisma.teamMember.count({ where: { userId: { in: created.userIds } } }),
    }
    console.log(`清场读回（要求全 0）：${JSON.stringify(left)}`)
    if (Object.values(left).some(n => n !== 0)) {
      console.error('清场后仍有残留：', JSON.stringify(left))
      code = code || 1
    }
  } catch (error) {
    console.error(`清理失败，请手工删除 planKey=${PLAN_KEY} 的行与 ${USER_PREFIX}*${USER_DOMAIN} 账号/团队：`, error?.message)
    code = code || 1
  } finally {
    await prisma.$disconnect()
  }
  console.log(`断言 ${assertionCount} 条，失败 ${failures.length} 条 → 退出码 ${code}`)
  process.exit(code)
}

// Ctrl-C / SIGTERM / 顶层抛异常都不许把足迹留在库里：三条路全部并进同一个 `finish()`
// （`exiting` 让它幂等）。真正的兜底是命名空间 + 下面那次「接走上一次残留」。
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    console.error(`\n收到 ${signal}：先按同一条 finish() 清场，再以 130 退出`)
    void finish(130)
  })
}
process.on('uncaughtException', (error) => {
  console.error(`未捕获异常：${redact(error?.message ?? error)}（先清场）`)
  void finish(1)
})
process.on('unhandledRejection', (error) => {
  console.error(`未处理的 Promise 拒绝：${redact(error?.message ?? error)}（先清场）`)
  void finish(1)
})

async function call(method, path, { body, token, teamId, want } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  if (teamId) headers['x-team-id'] = teamId        // src/lib/team-access.ts:5 TEAM_HEADER
  const res = await fetch(`${BASE}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) })
  const text = await res.text()
  for (const secret of guarded) {
    if (secret && text.includes(secret)) failures.push(`${method} ${path} 的响应体里出现了脚本自生成的凭据（已脱敏，未打印）`)
  }
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* 非 JSON 也照原样进 failures */ }
  // `want === undefined` 只用于「状态本身就是被测对象」的那一发（并发探针）：
  // 它不预设答案，由调用方对两发的组合下断言。
  const ok = want === undefined || res.status === want
  console.log(`${ok ? 'PASS' : 'FAIL'} ${method} ${path} → ${res.status}${want === undefined ? ' (状态本身是被测对象)' : ` (want ${want})`}`)
  if (!ok) {
    failures.push(`${method} ${path}: want ${want}, got ${res.status} ${redact(text)}`)
    if (text) console.log(`     body ${redact(text)}`)
  }
  return { status: res.status, json }
}

// 一发不带任何鉴权的裸请求，只用来判「网络可达」——用 Task 7 已验收的既有端点做探针，
// 这样新路由万一编译不过，也不会被误读成「他的 dev server 挂了」。
async function probe() {
  try {
    const res = await fetch(`${BASE}/api/billing/transfer/qr`)
    console.log(`探针 ${BASE}/api/billing/transfer/qr → ${res.status}（既有端点，未登录应为 401）`)
    return true
  } catch (error) {
    console.error(`BLOCKED：${BASE} 不可达（${error?.cause?.code ?? error?.message}）`)
    console.error('3000 上是用户自己起的 next dev —— 本脚本绝不代替他起服务、绝不重启它。未写入任何数据。')
    await prisma.$disconnect()
    process.exit(3)
  }
}

// 一次性身份：建号 → （可选）建 ACTIVE 团队 → 走**真实**登录端点换令牌。
// `login: 'team' | 'platform'` 决定受众是哪一族：断言 2b 需要「平台管理员的团队受众令牌」，
// 那是唯一能把 `requirePlatformAuth` 与 `requirePlatformAdmin` 区分开的一发（见文件头 Step 0）。
async function makeAccount({ tag, teams = [], platformAdmin = false, login = 'team' }) {
  const password = randomBytes(24).toString('hex')
  guarded.push(password)
  const email = `${USER_PREFIX}${tag}-${STAMP}${USER_DOMAIN}`
  const user = await prisma.user.create({
    data: {
      email, name: `${USER_PREFIX}${tag}`,
      password: await bcrypt.hash(password, 14),   // 与 hashPassword 同参数（src/lib/encryption.ts:162-169）
      ...(platformAdmin ? { isPlatformAdmin: true } : {}),
    },
  })
  created.userIds.push(user.id)
  const teamIds = []
  for (const [i, role] of teams.entries()) {
    const slug = `${USER_PREFIX}${tag}-${i}-${STAMP}`
    const t = await prisma.team.create({ data: { name: slug, slug, shareKey: `po${STAMP}${tag}${i}`, createdById: user.id, status: 'ACTIVE' } })
    created.teamIds.push(t.id)
    teamIds.push(t.id)
    await prisma.teamMember.create({ data: { teamId: t.id, userId: user.id, role } })
  }
  const platformSide = login === 'platform'
  const res = await fetch(`${BASE}${platformSide ? '/api/platform/auth/login' : '/api/auth/login'}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(platformSide ? { identifier: email, password } : { email, password }),
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* 下面按失败处理 */ }
  const token = json?.tokens?.accessToken
  if (!token) {
    // 不重试：登录失败会写安全事件并入队一次外部通知（`api/auth/login/route.ts:75-131`）。
    console.error(`${tag} 的一次性身份登录失败 ${res.status}：${redact(text)}`)
    await finish(2)
  }
  guarded.push(token)
  ;(platformSide ? created.platformTokens : created.tokens).push(token)
  return { userId: user.id, email, token, teamIds }
}

// 断言 5 的另一半：直调真实现。见文件头「子进程直调」那段。
function directPreview(input) {
  const call = [
    'computeFulfillmentPreview({',
    '  currentExpiresAt: i.currentExpiresAtMs === null ? null : new Date(i.currentExpiresAtMs),',
    '  nowMs: i.nowMs, periods: i.periods, plan: i.plan,',
    '  currentQuota: i.currentQuota ?? undefined, quotaSource: i.quotaSource ?? undefined,',
    '})',
  ].join('\n')
  const child = [
    `import { computeFulfillmentPreview } from ${JSON.stringify(PRICING_TS)}`,
    'const i = JSON.parse(process.env.T11_PREVIEW_INPUT)',
    `process.stdout.write(JSON.stringify(${call}))`,
  ].join('\n')
  // 门禁对 Node 版本有一枚隐式依赖：`--experimental-transform-types` 一旦被**改名或移除**（本地实测
  // v24.20.0），这发 `execFileSync` 会直接抛 ⇒ 全场红，而红的原因与被测产品无关。
  // 旧措辞「转正即抛」（评审 m-11）过度，Task 15 修正：Node 对转正的实验项通常先把原 flag 保留为
  // 兼容别名（此时不抛，只是白传），别名被移除的那一版才抛 —— 届时的处置同样是动下面这一行。
  const out = execFileSync(process.execPath, ['--experimental-transform-types', '--input-type=module', '-e', child], {
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '1', T11_PREVIEW_INPUT: JSON.stringify(input) },
  })
  return JSON.parse(out)
}

// 预览入参：脚本自己从库里读，不借路由的任何一行代码 —— 于是路由拿错任何一枚入参都会以逐字段差异红出来。
// **唯一例外是下面那行 `quotaSource`**：它把 `[id]/route.ts:52` 的塌缩规则（只认 `MANUAL`，其余一律
// `PLAN`）原样抄了一遍，规则本身写错时两侧会同时错、彼此对上 ⇒ 这条门禁证不了那枚映射。
// 断言 5 真正证的是路由的**接线**：基准列是 `Team.subscriptionExpiresAt`（不是 `order.periodEnd`、
// 不是 `order.createdAt`）、`periods` / `durationDays` 取自库里的行、额度行为 null 时没兜 schema 默认。
// `quotaSource → willResetManual` 那步塌缩映射的正确性在本任务四枚文件之外，也没有断言替它背书。
async function previewInputFor(orderId) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { plan: true, team: true } })
  const quota = await prisma.teamQuota.findUnique({ where: { teamId: order.teamId } })
  const four = (row) => ({ maxMembers: row.maxMembers, maxProjects: row.maxProjects, maxVideos: row.maxVideos, maxStorageGB: row.maxStorageGB })
  return {
    currentExpiresAtMs: order.team.subscriptionExpiresAt?.getTime() ?? null,
    nowMs: Date.now(),
    periods: order.periods,
    plan: { durationDays: order.plan.durationDays, quota: four(order.plan) },
    currentQuota: quota ? four(quota) : null,
    // 与 `[id]/route.ts:52` 同式：这一枚不能自证（规则错了两侧一起错），见函数上那段注释。
    quotaSource: quota ? (quota.source === 'MANUAL' ? 'MANUAL' : 'PLAN') : null,
  }
}

function diffPreviewFields(orderId, routePreview, direct, { timeIndependent = false } = {}) {
  const keys = [...new Set([...Object.keys(routePreview ?? {}), ...Object.keys(direct ?? {})])].sort()
  expect(`preview[${orderId}] 字段集完整`, keys.join(',') === ['fromExpiry', 'nextQuota', 'quotaChanged', 'toExpiry', 'toExpiryDate', 'willResetManual'].join(','), keys.join(','))
  const timeKeys = ['fromExpiry', 'toExpiry', 'toExpiryDate']
  for (const key of keys) {
    // 到期日为 null 的那一支：`fromExpiry` 就是实现自己的 `nowMs`（`billing-pricing.ts:89`），
    // 两枚进程不可能取到同一毫秒 ⇒ 三个时间字段只能按容差比，其余字段仍严格比。
    if (timeIndependent && timeKeys.includes(key)) continue
    const a = JSON.stringify(routePreview?.[key])
    const b = JSON.stringify(direct?.[key])
    expect(`preview.${key} 与直调逐字段相同`, a === b, `路由 ${a} / 直调 ${b}`)
  }
  if (timeIndependent) {
    const drift = Math.abs((routePreview?.fromExpiry ?? 0) - (direct?.fromExpiry ?? 0))
    expect('fromExpiry 落在「两枚进程各取一次 now()」的容差内', drift < 5000, `漂移 ${drift}ms`)
    expect('toExpiry − fromExpiry 恰为一个周期（null 到期日从今天起算）',
      routePreview?.toExpiry - routePreview?.fromExpiry === DURATION_DAYS * PERIODS_B * DAY,
      `${routePreview?.toExpiry - routePreview?.fromExpiry} vs ${DURATION_DAYS * PERIODS_B * DAY}`)
  }
}

// 四枚端点的清单一处定义，三枚错误身份共用。body 只挂在 POST 上（GET 带 body 会被 fetch
// 同步拒掉），而这两枚 body 是刻意的探针：`confirm` 的唯一入参是路径 id + 会话，
// `close` 的合法理由必须被 401 挡在判空与事务之前 —— 路由若把顺序写反，这里就是 400/409。
const FOUR_ENDPOINTS = (id) => [
  ['GET', '/api/platform/orders?status=REPORTED', {}],
  ['GET', `/api/platform/orders/${id}`, {}],
  ['POST', `/api/platform/orders/${id}/confirm`, { body: { actorUserId: 'cmubillingcheckfake000000c' } }],
  ['POST', `/api/platform/orders/${id}/close`, { body: { reason: '错误身份带的合法理由' } }],
]

console.log(`目标：${BASE}　命名空间：plan=${PLAN_KEY} / user=${USER_PREFIX}*${USER_DOMAIN} / team slug=${USER_PREFIX}*`)

if (!(await probe())) process.exit(3)   // probe 自己已打印并退出；这行只是给读代码的人

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

await prisma.plan.upsert({
  where: { key: PLAN_KEY },
  update: { priceCents: PRICE_CENTS, durationDays: DURATION_DAYS, active: true, name: PLAN_NAME },
  create: {
    key: PLAN_KEY, name: PLAN_NAME, priceCents: PRICE_CENTS, currency: 'CNY', durationDays: DURATION_DAYS,
    maxMembers: 3, maxProjects: 4, maxVideos: 5, maxStorageGB: 6, active: true,
  },
})

// ---------------------------------------------------------------------------
// 身份与订单夹具
// ---------------------------------------------------------------------------
// owner：两支 ACTIVE 团队的 OWNER。团队受众令牌既是夹具（下单/报付款）也是断言 2 的错误身份。
const ownerAccount = await makeAccount({ tag: 'owner', teams: ['OWNER', 'OWNER'] })
const owner = ownerAccount.token
const teamA = ownerAccount.teamIds[0]
const teamB = ownerAccount.teamIds[1]
// A 的到期日钉成「此刻 + 10 天」的整秒值：`nextExpiryMs()` 的基准取这一列本身，与 nowMs 无关，
// 于是「接口预览 vs 子进程直调」的比较不受两枚进程各取一次时间的影响（见文件头）。
// B **故意留 null**：那是 `currentExpiresAt` 的另一支（从今天起算），由断言 5b 覆盖。
await prisma.team.update({ where: { id: teamA }, data: { subscriptionExpiresAt: new Date(EXPIRY_MS) } })
expect('夹具：A 的到期日在未来（比较与 nowMs 无关这一前提成立）', EXPIRY_MS > Date.now(), `EXPIRY_MS=${EXPIRY_MS} now=${Date.now()}`)
// admin 与 admin2 是**两个**一次性账号（email 唯一，同一 tag 撞两次必反）：同一个「平台管理员」
// 身份分别走平台登录端点与团队登录端点，拿到两种受众的令牌 —— 断言 2b 靠这一对区分两枚鉴权函数。
const adminAccount = await makeAccount({ tag: 'admin', platformAdmin: true, login: 'platform' })
const admin = adminAccount.token
const adminTeamAudience = await makeAccount({ tag: 'admin2', platformAdmin: true, login: 'team' })
// exadmin：先以平台管理员登录（证明令牌本身是活的），随后脚本把 isPlatformAdmin 撤成 false。
const exAdminAccount = await makeAccount({ tag: 'exadmin', platformAdmin: true, login: 'platform' })
const exAdmin = exAdminAccount.token
console.log(`一次性身份：owner 团队 A=${teamA} 团队 B=${teamB}；平台管理员 ${adminAccount.userId}`)

// 夹具走真实的客户侧链路（Task 6/8 的端点），这样订单带着 CREATED 的 PaymentAttempt
// 与 REPORTED 的 OrderEvent —— 断言 6 才有「章被盖上没」可查。
const createdA = await call('POST', '/api/billing/orders', { token: owner, teamId: teamA, body: { planKey: PLAN_KEY, periods: PERIODS_A }, want: 200 })
const orderA = createdA.json?.order?.id
const createdB = await call('POST', '/api/billing/orders', { token: owner, teamId: teamB, body: { planKey: PLAN_KEY, periods: PERIODS_B }, want: 200 })
const orderB = createdB.json?.order?.id
if (!orderA || !orderB) {
  // 夹具没给 id，后面每一条 :id 断言都会打在 undefined 上（红是真的红，但它证的不是本任务）。
  // 直接收尾：这是「崩在中途」最贵的一种，必须走清场那条路。
  failures.push('夹具下单没有返回 order.id，:id 断言无法继续')
  await finish(1)
}
created.orderIds.push(orderA, orderB)
await call('POST', `/api/billing/orders/${orderA}/report`, { token: owner, teamId: teamA, body: { reportNote: '自动检查：请核对流水' }, want: 200 })
expect('夹具：A 已报付款、B 停在 OPEN', createdA.status === 200 && createdB.status === 200, `A=${orderA} B=${orderB}`)

// ---------------------------------------------------------------------------
// 断言 1：无令牌 → 四枚端点全 401
// ---------------------------------------------------------------------------
console.log('\n[1] 无令牌：四枚端点必须全 401（鉴权排在 404/400/事务之前）')
for (const [method, path, extra] of FOUR_ENDPOINTS(orderA)) {
  const r = await call(method, path, { ...extra, want: 401 })
  expect(`${method} ${path} 无令牌：401 且文案是 Unauthorized`, r.json?.error === 'Unauthorized', JSON.stringify(r.json))
}

// ---------------------------------------------------------------------------
// 断言 2：团队受众令牌 → 四枚全 401（不是 403）
// ---------------------------------------------------------------------------
console.log('\n[2] 客户侧令牌打平台端点：必须 401（requirePlatformAuth 只认平台受众，无 403 分支）')
const teamSide = await call('GET', '/api/billing/orders', { token: owner, teamId: teamA, want: 200 })
expect('团队令牌本身是活的（能读自己团队的账单，含夹具单）', (teamSide.json?.orders ?? []).some(o => o.id === orderA), `orders=${(teamSide.json?.orders ?? []).length}`)
for (const [method, path, extra] of FOUR_ENDPOINTS(orderA)) {
  await call(method, path, { ...extra, token: owner, teamId: teamA, want: 401 })
}
console.log('  [2b] 平台管理员的**团队受众**令牌：同样必须 401 —— 这一发才真正区分 requirePlatformAuth 与 requirePlatformAdmin')
for (const [method, path, extra] of FOUR_ENDPOINTS(orderA)) {
  await call(method, path, { ...extra, token: adminTeamAudience.token, want: 401 })
}
expect('断言 2b 不是空断言：这个人的 isPlatformAdmin 真的是 true',
  (await prisma.user.findUniqueOrThrow({ where: { id: adminTeamAudience.userId }, select: { isPlatformAdmin: true } })).isPlatformAdmin === true)

// ---------------------------------------------------------------------------
// 断言 3：平台受众 + isPlatformAdmin=false → 401
// ---------------------------------------------------------------------------
console.log('\n[3] 平台令牌但 isPlatformAdmin=false：先证明令牌活着（200），撤掉字段后必须 401')
await call('GET', '/api/platform/orders?status=REPORTED', { token: exAdmin, want: 200 })
await prisma.user.update({ where: { id: exAdminAccount.userId }, data: { isPlatformAdmin: false } })
for (const [method, path, extra] of FOUR_ENDPOINTS(orderA)) {
  await call(method, path, { ...extra, token: exAdmin, want: 401 })
}

// ---------------------------------------------------------------------------
// 断言 4：列表（筛选 / 非法值不 500 / counts 复算）
// ---------------------------------------------------------------------------
console.log('\n[4] 列表：状态筛选、非法值 200、counts 的**键集合**与逐键值都要等于库里 groupBy 的复算（缺键即失败）')
const listReported = await call('GET', '/api/platform/orders?status=REPORTED', { token: admin, want: 200 })
const listBogus = await call('GET', '/api/platform/orders?status=BOGUS', { token: admin, want: 200 })
const listOpen = await call('GET', '/api/platform/orders?status=OPEN', { token: admin, want: 200 })
const listAll = await call('GET', '/api/platform/orders?status=ALL', { token: admin, want: 200 })
expect('顶层只有 orders + counts + total 三个键（total 由 Task 12 按裁定 D-18 补进契约）', JSON.stringify(Object.keys(listReported.json ?? {}).sort()) === JSON.stringify(['counts', 'orders', 'total']), JSON.stringify(Object.keys(listReported.json ?? {})))
const rowA = (listReported.json?.orders ?? []).find(o => o.id === orderA)
const rowB = (listOpen.json?.orders ?? []).find(o => o.id === orderB)
dump('REPORTED 命中行', rowA && { id: rowA.id, status: rowA.status, teamName: rowA.teamName, planName: rowA.planName, periods: rowA.periods, amountCents: rowA.amountCents, reportNote: rowA.reportNote })
expect('REPORTED 里看得到刚报付款的 A，看不到 OPEN 的 B', Boolean(rowA) && !(listReported.json?.orders ?? []).some(o => o.id === orderB), `rowA=${Boolean(rowA)}`)
expect('OPEN 里看得到 B，看不到已报付款的 A', Boolean(rowB) && !(listOpen.json?.orders ?? []).some(o => o.id === orderA), `rowB=${Boolean(rowB)}`)
expect('ALL 里两枚都在', [orderA, orderB].every(id => (listAll.json?.orders ?? []).some(o => o.id === id)))
expect('每行 status 都落在筛选值上（REPORTED 页没有别的状态混进来）', (listReported.json?.orders ?? []).every(o => o.status === 'REPORTED'))
expect('行形状 = OrderDto + teamName + planName（不多不少）', JSON.stringify(Object.keys(rowA ?? {}).sort()) === JSON.stringify(ROW_KEYS), JSON.stringify(Object.keys(rowA ?? {}).sort()))
expect('金额是服务端算的 priceCents × periods', rowA?.amountCents === PRICE_CENTS * PERIODS_A, `${rowA?.amountCents}`)
expect('列表带出团队名/套餐名（队列行的两列）', rowA?.teamName === (await prisma.team.findUnique({ where: { id: teamA }, select: { name: true } }))?.name && rowA?.planName === PLAN_NAME, `${rowA?.teamName} / ${rowA?.planName}`)
expect('非法 status 与 REPORTED 同形（不 500、同一批行、同一套键）',
  JSON.stringify((listBogus.json?.orders ?? []).map(o => o.id)) === JSON.stringify((listReported.json?.orders ?? []).map(o => o.id))
  && JSON.stringify(Object.keys((listBogus.json?.orders ?? [])[0] ?? {}).sort()) === JSON.stringify(ROW_KEYS),
  `BOGUS ${listBogus.status} 行数 ${(listBogus.json?.orders ?? []).length} vs REPORTED ${(listReported.json?.orders ?? []).length}`)
// §11.3/§11.4「收款账号不出网关」这一条的**真凭据是构造**，不是下面这行：四枚路由没有一枚 import
// `@/lib/settings` / `getTransferConfig`（读它的是别处：intent 路由经 provider、
// 收款码路由直读，平台侧 `settings/transfer` 也读写——旧措辞「唯一读它的是 intent 路由」偏松，
// Task 15 按评审 m-3 修正，详见文件头「收款配置」段）、`toOrderDto` 是逐列白名单、
// `logError` 只会输出 `Error.name: Error.message`。下面这行只匹配**键名**，测不到**值级**泄漏 ——
// 真账号被写进 `reportNote` / `invoiceTitle` 这类自由文本列时它照样绿（本地 `Settings.transfer*` 为
// NULL，那个场景在本夹具里也无从构造）。别把这行绿读成 §11.3 已经证过。
expect('响应里没有收款账号/令牌类字段（只比键名，测不到值级泄漏，见上）', ['accountNo', 'accountName', 'transferAccount', 'accessToken', 'password'].every(k => !JSON.stringify(listReported.json ?? '').includes(k)))
const grouped = await prisma.order.groupBy({ by: ['status'], _count: true })
const recomputed = {}
for (const g of grouped) recomputed[g.status] = g._count
const apiCounts = listReported.json?.counts ?? {}
dump('counts / 库里复算', { 接口: listReported.json?.counts, 复算: recomputed })
// 「键缺失」不等于「值为 0」：`groupBy` 对零计数的状态压根不出行（`api/platform/orders/route.ts` 里
// `prisma.order.groupBy({ by: ['status'], _count: true })` 那一发，以及只遍历它的结果来填 `counts` 的那个循环），
// 老写法 `counts?.[status] ?? 0` 把「接口没这个键」和「接口说 0」压成同一个 0 —— 接口返回
// `counts: {}` 时五态里有三态照样绿，而日志还印出一行凭空造出来的「接口 0」。
// 现在先比**键集合**，再只对「两侧任一存在的那个键」比值：任一侧缺键即失败，日志写清缺在哪一侧。
const apiCountKeys = Object.keys(apiCounts).sort()
const realCountKeys = Object.keys(recomputed).sort()
expect('counts 的键集合与库里复算一致（缺键即失败，不读成 0）',
  JSON.stringify(apiCountKeys) === JSON.stringify(realCountKeys),
  `接口 [${apiCountKeys.join(',')}] / 复算 [${realCountKeys.join(',')}]`)
for (const status of [...new Set([...apiCountKeys, ...realCountKeys])].sort()) {
  const inApi = Object.prototype.hasOwnProperty.call(apiCounts, status)
  const inReal = Object.prototype.hasOwnProperty.call(recomputed, status)
  expect(`counts.${status} 与复算相等`,
    inApi && inReal && apiCounts[status] === recomputed[status],
    `接口 ${inApi ? apiCounts[status] : '无此键'} / 复算 ${inReal ? recomputed[status] : '无此键'}`)
}
expect('counts 不含五态之外的键', Object.keys(listReported.json?.counts ?? {}).every(k => STATUSES.includes(k)), JSON.stringify(Object.keys(listReported.json?.counts ?? {})))
// 这一条**不叫**「take:100 生效」：本机库里只有夹具那 2 单，「第 101 单会不会被截掉」在这里观察不到。
// 它实际观察到的是：ALL 视图的行数 = min(脚本自己 groupBy 求和的库内总行数, 100)。
// 这个式子能红「take 小于夹具行数」（`take: 1` 把两行截成一行），红不了「不传 take」与「take: 1000」——
// 它们在 2 行的库上给出的行数与 `take: 100` 完全相同，这是数据量的上限而不是断言写法的问题。
// 截断这件事本身在本数据量下依然观察不到；D-18 让 Task 12 给响应补了 `total`，
// 「被截掉的行有没有答案」由下面 4b 逐筛选核对。
const totalInDb = Object.values(recomputed).reduce((a, b) => a + b, 0)
const allRows = (listAll.json?.orders ?? []).length
expect('ALL 视图行数 = min(库内总行数, 100) 且 ≤100（本数据量观察不到截断，被截断时的答案见 4b 的 total）',
  allRows === Math.min(totalInDb, 100) && allRows <= 100, `接口 ${allRows} 行 / 库内 ${totalInDb} 行 / 上限 100`)

// ---------------------------------------------------------------------------
// 断言 4b（Task 12 名下补的契约，裁定 D-18）：`total` = **与当前 status 筛选同谓词**的行数
//
// 三枚筛选各读一次，并与脚本自己从库里 `count({ where })` 的复算比。这一组真正咬住的是两种走偏：
// ① 把 `counts` 各值求和当成 `total`（那是全状态合计，与筛选后的列表对不上）—— 由
//    「REPORTED 的 total ≠ counts 求和」那一发红出来；此刻 A 是 REPORTED、B 是 OPEN，
//    求和必然比 REPORTED 的同谓词行数大（断言 6/7 才把 A confirm、B close，4b 跑在它们之前）。
// ② `count` 用了与 `findMany` 不同的谓词（例如漏掉 status）—— 由逐筛选的等值比对红出来。
// 界面侧的用法（`total > orders.length` 时显示「共 N 条，仅显示最近 100 条」）在本地数据量下
// 触发不了，那一条由 Task 12 Step 4 的桩态渲染证明，不在这里证。
// ---------------------------------------------------------------------------
console.log('\n[4b] total：等于同谓词的 prisma.order.count，且不是 counts 各值求和')
const totalProbes = [
  ['REPORTED', listReported, { status: 'REPORTED' }],
  ['OPEN', listOpen, { status: 'OPEN' }],
  ['ALL', listAll, {}],
]
for (const [label, res, where] of totalProbes) {
  const realTotal = await prisma.order.count({ where })
  const shownTotal = res.json?.total
  expect(`total[${label}] = 库里同谓词行数`, shownTotal === realTotal, `接口 ${JSON.stringify(shownTotal)} / 库里 ${realTotal}`)
  expect(`total[${label}] 是数字且 ≥ 本次返回行数（被截掉的行只会让它更大，不会消失）`,
    typeof shownTotal === 'number' && shownTotal >= (res.json?.orders ?? []).length,
    `total=${JSON.stringify(shownTotal)} 行数=${(res.json?.orders ?? []).length}`)
}
expect('total[REPORTED] ≠ counts 各值求和（证明它不是全状态合计；前提：此刻 A=REPORTED、B=OPEN）',
  listReported.json?.total !== totalInDb, `total=${JSON.stringify(listReported.json?.total)} / 求和=${totalInDb}`)
expect('total 是整数而不是字符串或 null（界面直接插值，不给 undefined 留门）',
  Number.isInteger(listReported.json?.total) && Number.isInteger(listAll.json?.total),
  `REPORTED ${JSON.stringify(listReported.json?.total)} / ALL ${JSON.stringify(listAll.json?.total)}`)

// ---------------------------------------------------------------------------
// 断言 5：预览端点 = 直调真实现
// ---------------------------------------------------------------------------
console.log('\n[5] 预览：与直调 computeFulfillmentPreview 比对 —— A 一发逐字段严格相同（同一组从库里读出的入参）；null 到期日那一发（5b）的三个时间键按容差/周期比，见 diffPreviewFields')
const detailA = await call('GET', `/api/platform/orders/${orderA}`, { token: admin, want: 200 })
expect('详情顶层只有 order + preview + currentQuota（currentQuota 由 Task 12 fix1 按裁定 D-25 补进契约，与 preview 同级）', JSON.stringify(Object.keys(detailA.json ?? {}).sort()) === JSON.stringify(['currentQuota', 'order', 'preview']), JSON.stringify(Object.keys(detailA.json ?? {})))
expect('详情的 order 与列表行同一个形状', JSON.stringify(Object.keys(detailA.json?.order ?? {}).sort()) === JSON.stringify(ROW_KEYS), JSON.stringify(Object.keys(detailA.json?.order ?? {})))
expect('确认前额度行确实不存在（路由不许兜 schema 默认）', (await prisma.teamQuota.count({ where: { teamId: teamA } })) === 0)
// 裁定 D-25 的边界 2：**无 TeamQuota 行 ⇒ 顶层 currentQuota 必须是 null**，界面才有「当前无额度记录」
// 那一支可写；兜成 0 或套餐默认四列就是台账 #57 那一族缺陷（缺行被兜成默认值，界面就此说谎）。
expect('A 无额度行 → 顶层 currentQuota 恰为 null（不是 0、不是套餐默认四列、不是缺键）',
  detailA.json && 'currentQuota' in detailA.json && detailA.json.currentQuota === null,
  JSON.stringify(detailA.json?.currentQuota))
// 边界 1：**旧值不许塞进 preview**。`PreviewResult` 的字段集由上面的 `diffPreviewFields` 钉着（断言 5），
// 这里再钉一次「新键在顶层、不在 preview 里」，免得后来人把两处搞混而让 Task 11 那发变红。
expect('currentQuota 不在 preview 里（PreviewResult 字段集一字未动）',
  !('currentQuota' in (detailA.json?.preview ?? {})), JSON.stringify(Object.keys(detailA.json?.preview ?? {})))
const inputA = await previewInputFor(orderA)
const directA = directPreview(inputA)
dump('预览入参（脚本自己从库里读）', inputA)
dump('预览结果（接口）', detailA.json?.preview)
diffPreviewFields('A', detailA.json?.preview, directA)
expect('fromExpiry 是毫秒数且等于钉住的当前到期日', detailA.json?.preview?.fromExpiry === EXPIRY_MS, `${detailA.json?.preview?.fromExpiry} vs ${EXPIRY_MS}`)
expect('预览就是 +93 天（durationDays × periods，与 fulfillOrder 同算式）', detailA.json?.preview?.toExpiry - detailA.json?.preview?.fromExpiry === DURATION_DAYS * PERIODS_A * DAY, `${detailA.json?.preview?.toExpiry - detailA.json?.preview?.fromExpiry}`)
expect('无额度行时 quotaChanged=true、willResetManual=false', detailA.json?.preview?.quotaChanged === true && detailA.json?.preview?.willResetManual === false, JSON.stringify(detailA.json?.preview && { q: detailA.json.preview.quotaChanged, w: detailA.json.preview.willResetManual }))
expect('toExpiryDate 与 toExpiry 是同一个时刻（Task 12 两处显示要一致）', Date.parse(detailA.json?.preview?.toExpiryDate ?? '') === detailA.json?.preview?.toExpiry, `${detailA.json?.preview?.toExpiryDate}`)
expect('nextQuota 就是套餐四列', JSON.stringify(detailA.json?.preview?.nextQuota) === JSON.stringify({ maxMembers: 3, maxProjects: 4, maxVideos: 5, maxStorageGB: 6 }), JSON.stringify(detailA.json?.preview?.nextQuota))

console.log('  [5b] 手改额度（MANUAL 且与套餐不同）+ 到期日为 null 的那一支')
await prisma.teamQuota.upsert({
  where: { teamId: teamB },
  create: { teamId: teamB, maxMembers: 99, maxProjects: 0, maxVideos: 0, maxStorageGB: 999, source: 'MANUAL' },
  update: { maxMembers: 99, maxProjects: 0, maxVideos: 0, maxStorageGB: 999, source: 'MANUAL' },
})
const detailB = await call('GET', `/api/platform/orders/${orderB}`, { token: admin, want: 200 })
const inputB = await previewInputFor(orderB)
const directB = directPreview(inputB)
expect('B 的到期日仍是 null（这一发覆盖 currentExpiresAt 的另一支）', inputB.currentExpiresAtMs === null, `${inputB.currentExpiresAtMs}`)
dump('预览入参（B）', inputB)
dump('预览结果（B，MANUAL 额度）', detailB.json?.preview)
diffPreviewFields('B', detailB.json?.preview, directB, { timeIndependent: true })
expect('MANUAL 特例被报出来（willResetManual=true 且 quotaChanged=true）',
  detailB.json?.preview?.willResetManual === true && detailB.json?.preview?.quotaChanged === true,
  JSON.stringify({ w: detailB.json?.preview?.willResetManual, q: detailB.json?.preview?.quotaChanged }))
// 裁定 D-25 的配套断言：**有额度行那一单，顶层 currentQuota 必须回读库里那一行 TeamQuota（四列逐项）**。
// 弹窗「额度 旧 → 新」的旧字就靠这一枚键；它对不上库里那行，界面上摊出来的后果就是假后果。
const quotaBRow = await prisma.teamQuota.findUniqueOrThrow({
  where: { teamId: teamB },
  select: { maxMembers: true, maxProjects: true, maxVideos: true, maxStorageGB: true },
})
dump('B 的 currentQuota（接口）与库里那一行', { api: detailB.json?.currentQuota, db: quotaBRow })
expect('B 详情带 currentQuota 且恰好四列（不多一列、不少一列）',
  JSON.stringify(Object.keys(detailB.json?.currentQuota ?? {}).sort()) === JSON.stringify(['maxMembers', 'maxProjects', 'maxStorageGB', 'maxVideos']),
  JSON.stringify(Object.keys(detailB.json?.currentQuota ?? {})))
for (const column of ['maxMembers', 'maxProjects', 'maxVideos', 'maxStorageGB']) {
  expect(`B 的 currentQuota.${column} = 库里 TeamQuota.${column}`,
    detailB.json?.currentQuota?.[column] === quotaBRow[column],
    `接口 ${detailB.json?.currentQuota?.[column]} / 库里 ${quotaBRow[column]}`)
}
expect('旧值与 preview.nextQuota 确实是两串数（否则弹窗那枚「→」是装饰）',
  JSON.stringify(detailB.json?.currentQuota) !== JSON.stringify(detailB.json?.preview?.nextQuota),
  `旧 ${JSON.stringify(detailB.json?.currentQuota)} / 新 ${JSON.stringify(detailB.json?.preview?.nextQuota)}`)
const missing = await call('GET', '/api/platform/orders/cmubillingchecknosuchorder', { token: admin, want: 404 })
expect('不存在的单：404 而不是 500', missing.json?.error === '订单不存在', JSON.stringify(missing.json))

// ---------------------------------------------------------------------------
// 断言 6：同一张单被连点两发 confirm → 恰好一 200 一 409，权益只前移一次
//
// 这组到底证了什么，说白（评审 m-12）：`[200, 409]` 这一对答案**分不清**「两发真在同一瞬间重叠」与
// 「败者只是在胜者提交之后才到」—— 两种时序给的是同一对状态码。所以「两个运营同时点也只落地一次」
// 不是本套件证的，它靠读码：`src/lib/billing.ts` 里 `confirmAndFulfill` 开头那次
// `updateMany where status in (OPEN,REPORTED)` 以影响行数判胜负，PostgreSQL 默认 READ COMMITTED 下败者重评谓词得 0 行 ⇒ `ok:false` ⇒ 409。
// 本套件真正咬住的是同一张单被点两发之后的**后置状态**：天数恰好前移一次、额度行恰 1、审计恰各 1、
// 章恰盖一次 —— 下面那串从库里读回来的计数才是硬证据，状态码只是它的入口。
// 覆盖面也写清：本夹具是「一张单 / 一个团队」，**同一团队的第二张可确认单**那种丢更新（lost update）它证不了
// —— 该情形当时由控制者挂起为**裁定 D-19**（本轮不加夹具、不在此处提修法）。终审 F-1 收了这条：
// `fulfillOrder` 读权益基准前先取一枚团队维度的 `pg_advisory_xact_lock`，并发证明在
// `.superpowers/sdd/2026-09-24-customer-billing-portal/t16-concurrent-fulfil.mts`（一次性脚本，不在本套件里）。
// ---------------------------------------------------------------------------
console.log('\n[6] 同一张单连点两发 confirm：恰好一 200 一 409（分不清重叠 vs 前后脚，见本节头注）；到期日只前移一次；额度不双花')
const beforeRow = await prisma.team.findUniqueOrThrow({ where: { id: teamA }, select: { subscriptionExpiresAt: true, status: true } })
const beforeMs = beforeRow.subscriptionExpiresAt.getTime()
expect('两发之前 A 仍是 REPORTED（CAS 谓词的初始状态）', (await prisma.order.findUniqueOrThrow({ where: { id: orderA }, select: { status: true } })).status === 'REPORTED')
const race = await Promise.all([
  call('POST', `/api/platform/orders/${orderA}/confirm`, { token: admin }),
  call('POST', `/api/platform/orders/${orderA}/confirm`, { token: admin }),
])
const codes = race.map(r => r.status).sort((x, y) => x - y)
expect('恰好一枚 200、一枚 409（同一张单点两发的答案；这组合不能证明两发时间重叠）', JSON.stringify(codes) === JSON.stringify([200, 409]), codes.join(','))
const winner = race.find(r => r.status === 200)
const loser = race.find(r => r.status === 409)
// `team` 已被路由投影成四列（评审 m-6 / 裁定 D-20）：这里原样印出来，日志里看得见收窄的结果。
// 套餐名与状态那两列的落地值不从这里读，从下面的库内断言读（`afterRow`）。
dump('200 的响应体（收窄后的 team 四列 + quota）', winner?.json && { ok: winner.json.ok, team: winner.json.team, quotaSource: winner.json.quota?.source, quotaSourceOrderId: winner.json.quota?.sourceOrderId })
expect('200 形状 = { ok, team, quota }', JSON.stringify(Object.keys(winner?.json ?? {}).sort()) === JSON.stringify(['ok', 'quota', 'team']), JSON.stringify(Object.keys(winner?.json ?? {})))
expect('200 的 team 只有四列（shareKey / createdById / avatarUrl / updatedAt 不在这张回显里）',
  JSON.stringify(Object.keys(winner?.json?.team ?? {}).sort()) === JSON.stringify(['id', 'name', 'status', 'subscriptionExpiresAt']),
  JSON.stringify(Object.keys(winner?.json?.team ?? {}).sort()))
expect('409 文案是那句「该订单已被处理」', loser?.json?.error === '该订单已被处理', JSON.stringify(loser?.json))
const afterRow = await prisma.team.findUniqueOrThrow({ where: { id: teamA }, select: { subscriptionExpiresAt: true, subscriptionPlan: true, status: true } })
const afterMs = afterRow.subscriptionExpiresAt.getTime()
expect(`库里到期日恰好前移 ${DURATION_DAYS * PERIODS_A} 天（比毫秒，不比字符串）`, afterMs - beforeMs === DURATION_DAYS * PERIODS_A * DAY, `前 ${beforeMs} 后 ${afterMs} 差 ${afterMs - beforeMs}`)
expect('200 响应回显的到期日 = 库里的值（弹窗与库不许两个数）', Date.parse(winner?.json?.team?.subscriptionExpiresAt ?? '') === afterMs, `${winner?.json?.team?.subscriptionExpiresAt}`)
expect('团队套餐名与状态被落地（subscriptionPlan=套餐、status=ACTIVE）', afterRow.subscriptionPlan === PLAN_KEY && afterRow.status === 'ACTIVE', JSON.stringify({ p: afterRow.subscriptionPlan, s: afterRow.status }))
const quotaRows = await prisma.teamQuota.count({ where: { sourceOrderId: orderA } })
expect('TeamQuota.count(sourceOrderId=该单) 恰为 1（加两次就是双花）', quotaRows === 1, `${quotaRows} 行`)
const teamQuotaCount = await prisma.teamQuota.count({ where: { teamId: teamA } })
expect('A 的额度行只有 1 枚（是 upsert 不是 insert）', teamQuotaCount === 1, `${teamQuotaCount} 行`)
expect('落地后的额度 = 套餐四列', JSON.stringify(await prisma.teamQuota.findUnique({ where: { teamId: teamA }, select: { maxMembers: true, maxProjects: true, maxVideos: true, maxStorageGB: true, source: true } })) === JSON.stringify({ maxMembers: 3, maxProjects: 4, maxVideos: 5, maxStorageGB: 6, source: 'PLAN' }))
expect('库里订单已是 FULFILLED 且带 fulfilledAt/fulfilledById', JSON.stringify(await prisma.order.findUnique({ where: { id: orderA }, select: { status: true, fulfilledById: true } })) === JSON.stringify({ status: 'FULFILLED', fulfilledById: adminAccount.userId }))
expect('CONFIRMED 事件恰 1 条（败者的点击不留审计痕）', (await prisma.orderEvent.count({ where: { orderId: orderA, type: 'CONFIRMED' } })) === 1)
expect('FULFILLED 事件恰 1 条', (await prisma.orderEvent.count({ where: { orderId: orderA, type: 'FULFILLED' } })) === 1)
const confirmedEvent = await prisma.orderEvent.findFirst({ where: { orderId: orderA, type: 'CONFIRMED' }, select: { actorUserId: true } })
expect('CONFIRMED 的 actor 取自会话（不是请求体）', confirmedEvent?.actorUserId === adminAccount.userId, `${confirmedEvent?.actorUserId}`)
// Step 2「必须走 provider」的唯一可观测证据：只有 markPaid 会把 PaymentAttempt 盖成 SUCCEEDED，
// 直接调 confirmAndFulfill 的路由会把它永远留在 CREATED。
const attempts = await prisma.paymentAttempt.groupBy({ by: ['status'], where: { orderId: orderA }, _count: true })
const attemptMap = {}
for (const a of attempts) attemptMap[a.status] = a._count
dump('该单的 PaymentAttempt 状态分布', attemptMap)
expect('PaymentAttempt 被盖成 SUCCEEDED（证明走的是 provider 而不是直调 confirmAndFulfill）', attemptMap.SUCCEEDED === 1 && !attemptMap.CREATED, JSON.stringify(attemptMap))
const attempt = await prisma.paymentAttempt.findFirst({ where: { orderId: orderA, status: 'SUCCEEDED' }, select: { provider: true, providerRef: true } })
expect('落章的 provider=manual、providerRef 指向点击的人', attempt?.provider === 'manual' && attempt?.providerRef === `confirmed:${adminAccount.userId}`, JSON.stringify(attempt))
console.log('  [6b] 再 confirm 第三发：已 FULFILLED 的单必须 409 且权益一动不动')
await call('POST', `/api/platform/orders/${orderA}/confirm`, { token: admin, body: { actorUserId: 'cmubillingcheckfake000000a' }, want: 409 })
const thirdRow = await prisma.team.findUniqueOrThrow({ where: { id: teamA }, select: { subscriptionExpiresAt: true } })
expect('第三发之后到期日毫秒值不变', thirdRow.subscriptionExpiresAt.getTime() === afterMs, `${thirdRow.subscriptionExpiresAt.getTime()} vs ${afterMs}`)
expect('第三发之后额度行仍是 1', (await prisma.teamQuota.count({ where: { sourceOrderId: orderA } })) === 1)
expect('第三发没有多写审计事件（CONFIRMED 仍 1 条）', (await prisma.orderEvent.count({ where: { orderId: orderA, type: 'CONFIRMED' } })) === 1)
const bogusConfirm = await call('POST', '/api/platform/orders/cmubillingchecknosuchorder/confirm', { token: admin, want: 409 })
expect('不存在的单 confirm：409 而不是 500', bogusConfirm.json?.error === '该订单已被处理', JSON.stringify(bogusConfirm.json))

// ---------------------------------------------------------------------------
// 断言 7：close —— FULFILLED 关不动、空白理由 400、合法理由关 OPEN
// ---------------------------------------------------------------------------
console.log('\n[7] close：FULFILLED → 409；reason 为 \'\' 与 \'   \' → 都是 400；OPEN 用合法理由 → 200')
const closeFulfilled = await call('POST', `/api/platform/orders/${orderA}/close`, { token: admin, body: { reason: '想把已到账的单关掉' }, want: 409 })
expect('已落地（FULFILLED）的单关不动，文案说清是这张单已被处理', closeFulfilled.json?.error === '该订单已被处理，无法关单', JSON.stringify(closeFulfilled.json))
for (const blank of ['', '   ']) {
  await call('POST', `/api/platform/orders/${orderA}/close`, { token: admin, body: { reason: blank }, want: 400 })
  await call('POST', `/api/platform/orders/${orderB}/close`, { token: admin, body: { reason: blank }, want: 400 })
}
await call('POST', `/api/platform/orders/${orderB}/close`, { token: admin, body: { }, want: 400 })
expect('OPEN 的 B 在空白理由探针之后仍是 OPEN（400 那一发没碰行）', (await prisma.order.findUnique({ where: { id: orderB }, select: { status: true, closeReason: true } }))?.status === 'OPEN')
const closeB = await call('POST', `/api/platform/orders/${orderB}/close`, { token: admin, body: { reason: '  客户撤销了这次转账  ', actorUserId: 'cmubillingcheckfake000000b', orderId: orderA }, want: 200 })
expect('关单 200 的响应体是 { ok: true }', JSON.stringify(closeB.json) === JSON.stringify({ ok: true }), JSON.stringify(closeB.json))
const closedB = await prisma.order.findUnique({ where: { id: orderB }, select: { status: true, closeReason: true } })
dump('B 关单后的库内值', closedB)
expect('库里 B 状态 CLOSED 且理由是那句（首尾空白被 closeOrder 收掉）', closedB?.status === 'CLOSED' && closedB?.closeReason === '客户撤销了这次转账', JSON.stringify(closedB))
expect('A 没被这发越界 orderId 影响（仍是 FULFILLED、closeReason 为空）', JSON.stringify(await prisma.order.findUnique({ where: { id: orderA }, select: { status: true, closeReason: true } })) === JSON.stringify({ status: 'FULFILLED', closeReason: null }))
const closedEvent = await prisma.orderEvent.findFirst({ where: { orderId: orderB, type: 'CLOSED' }, select: { actorUserId: true, note: true } })
expect('CLOSED 事件署名取自会话、note 即理由', closedEvent?.actorUserId === adminAccount.userId && closedEvent?.note === '客户撤销了这次转账', JSON.stringify(closedEvent))
await call('POST', `/api/platform/orders/${orderB}/close`, { token: admin, body: { reason: '关掉已关闭的单' }, want: 409 })
const bogusClose = await call('POST', '/api/platform/orders/cmubillingchecknosuchorder/close', { token: admin, body: { reason: '不存在的单' }, want: 409 })
expect('不存在的单 close：409 而不是 500', bogusClose.json?.error === '该订单已被处理，无法关单', JSON.stringify(bogusClose.json))
const noPermClose = await call('POST', `/api/platform/orders/${orderB}/close`, { body: { reason: '没令牌' }, want: 401 })
expect('close 的鉴权排在理由判空之前（无令牌带合法理由 → 401）', noPermClose.status === 401)

// 方法面：四枚端点没有多余的方法（平台侧不许建单）
await call('POST', '/api/platform/orders', { token: admin, body: { planKey: PLAN_KEY, periods: 1 }, want: 405 })
await call('GET', `/api/platform/orders/${orderA}/confirm`, { token: admin, want: 405 })
await call('PATCH', `/api/platform/orders/${orderA}`, { token: admin, body: { status: 'CLOSED' }, want: 405 })

console.log(`\n${failures.length ? failures.join('\n') : '全部通过'}`)
await finish(failures.length ? 1 : 0)
