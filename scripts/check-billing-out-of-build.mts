import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, posix } from 'node:path'

/**
 * 10-04 他点单：「先把计费功能从构建产物里移除」，我给的方案 A（搬出路由目录、代码一行不删）他答「选A，开始吧」。
 * 判据要证的不是"文件没了"，而是三件事：
 *  ① Next 只把 `src/app` 下的文件当路由，所以那 10 条计费路由必须整条不在 `src/app` 里，
 *    而是逐字躺在 `src/disabled-billing/` 下（搬≠删，将来 `git mv` 回来就能恢复）。
 *  ② 搬完之后**活代码里没有任何一条路径还通向计费**——没被任何路由引用的模块不会进 bundle，
 *    唯一的例外是全站写闸门 `platform-access.ts` 借用的 `isUnlimitedQuota`（两行纯函数），
 *    它必须就地自带一份，且语义（`<= 0` 即无限）一字不差，否则上传/建项目的额度判定会跟着变。
 *  ③ 线上那两张表刻意没动：schema 里 `Order` / `Plan` 模型还在、迁移目录还在。
 * 另外顺带证后台导航不再留一枚死链，和全站其它路由没被这次搬移带坏。
 *
 * 全程只 GET，不打任何写方法；凭据一律不碰（这条链上四张路由在没登录时本来也只回 401）。
 */
const BASE = process.env.BILLING_CHECK_BASE || 'http://localhost:3000'
const DISABLED = 'src/disabled-billing'

// 判据要 import 真模块（写闸门），它经 `@/lib/db` 拉着 Prisma；.env 必须先进 process.env。
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const i = line.indexOf('=')
  if (i > 0 && !line.startsWith('#')) {
    const k = line.slice(0, i).trim()
    if (k && !process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, '')
  }
}

// 搬走前从 `git ls-files` 现取的 10 条路由（8 条 API route.ts ＋ 2 张页面），不是手敲的。
const MOVED_ROUTES = [
  'app/api/billing/orders/[id]/intent/route.ts',
  'app/api/billing/orders/[id]/report/route.ts',
  'app/api/billing/orders/route.ts',
  'app/api/billing/transfer/qr/route.ts',
  'app/api/platform/orders/[id]/close/route.ts',
  'app/api/platform/orders/[id]/confirm/route.ts',
  'app/api/platform/orders/[id]/route.ts',
  'app/api/platform/orders/route.ts',
  'app/platform/orders/page.tsx',
  'app/studio/team/billing/page.tsx',
]
// 搬走的实现方（2 枚组件＋4 个 lib）与它的 7 份判据脚本。
const MOVED_IMPL = [
  'components/platform/OrderQueue.tsx',
  'components/platform/OrderConfirmDialog.tsx',
  'lib/billing.ts',
  'lib/billing-dto.ts',
  'lib/billing-pricing.ts',
  'lib/payment-provider.ts',
]
const MOVED_SCRIPTS = [
  'scripts/billing-api-check.mjs',
  'scripts/check-billing-flow.mts',
  'scripts/check-billing-orders-route.mts',
  'scripts/check-billing-pricing.mts',
  'scripts/check-billing-read-routes.mts',
  'scripts/check-payment-provider.mts',
  'scripts/check-platform-orders.mjs',
]
const OLD_PATHS = [
  ...MOVED_ROUTES.map(p => `src/${p}`),
  ...MOVED_IMPL.map(p => `src/${p}`),
  ...MOVED_SCRIPTS.map(p => `scripts/${posix.basename(p)}`),
]

// 只 GET 探测；四条 API 都导出了 GET，所以不需要碰写方法。
const MUST_404 = [
  '/studio/team/billing',
  '/platform/orders',
  '/api/billing/orders',
  '/api/billing/transfer/qr',
  '/api/platform/orders',
  '/api/billing/orders/DEADBEEF/intent',
]
// 这次搬移不许带坏的活路由（回归面）。
const MUST_STILL_WORK = ['/', '/login', '/api/health', '/features/frame-comments']

const failures: string[] = []
let ran = 0
function check(ok: boolean, label: string, detail = '') {
  ran++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p.split('/').join('/'))
  }
  return out
}
const appFiles = walk('src/app')

// —— A 组：结构 ——
const stillInApp = appFiles.filter(f => /billing|orders/i.test(f))
check(stillInApp.length === 0, 'A1 src/app 里不再有 billing/orders 路径段', stillInApp.slice(0, 4).join(', '))

for (const rel of [...MOVED_ROUTES, ...MOVED_IMPL]) {
  check(existsSync(join(DISABLED, rel)), `A2 搬到了 disabled/${rel}`)
}
for (const rel of MOVED_SCRIPTS) {
  check(existsSync(join(DISABLED, 'scripts', posix.basename(rel))), `A2 判据脚本跟着搬 ${posix.basename(rel)}`)
}
const gone = OLD_PATHS.filter(p => !existsSync(p))
check(gone.length === OLD_PATHS.length, 'A3 原位置已经空了', `${gone.length}/${OLD_PATHS.length} 已空`)

// 搬≠删：每条路由文件的 handler 必须还写着，导出计数与搬前那版逐条对得上。
const HANDLERS_PER_ROUTE: Record<string, number> = {
  'app/api/billing/orders/[id]/intent/route.ts': 1,
  'app/api/billing/orders/[id]/report/route.ts': 1,
  'app/api/billing/orders/route.ts': 2,
  'app/api/billing/transfer/qr/route.ts': 1,
  'app/api/platform/orders/[id]/close/route.ts': 1,
  'app/api/platform/orders/[id]/confirm/route.ts': 1,
  'app/api/platform/orders/[id]/route.ts': 1,
  'app/api/platform/orders/route.ts': 1,
}
function handlerCount(rel: string): number | string {
  const p = join(DISABLED, rel)
  if (!existsSync(p)) return '缺文件'
  return (readFileSync(p, 'utf8').match(/export async function (GET|POST|PATCH|PUT|DELETE)/g) ?? []).length
}
const handlerDiff = Object.entries(HANDLERS_PER_ROUTE)
  .filter(([rel, want]) => handlerCount(rel) !== want)
  .map(([rel, want]) => `${rel} 实=${handlerCount(rel)} 应=${want}`)
check(handlerDiff.length === 0, 'A4 十条路由的 handler 一个没少', handlerDiff.join(' | '))

// —— B 组：活代码里通向计费的线全断 ——
const liveFiles = [...appFiles, ...walk('src/components'), ...walk('src/lib')]
const REF_PATTERNS: Array<[RegExp, string]> = [
  [/from '@\/lib\/billing/, "from '@/lib/billing"],
  [/from '@\/lib\/payment-provider/, "from '@/lib/payment-provider"],
  [/from '@\/components\/platform\/Order/, "from '@/components/platform/Order"],
  [/['"`]\/api\/billing/, "'/api/billing"],
  [/['"`]\/api\/platform\/orders/, "'/api/platform/orders"],
]
const refHits: string[] = []
for (const f of liveFiles) {
  if (f.startsWith(DISABLED)) continue
  const text = readFileSync(f, 'utf8')
  for (const [re, name] of REF_PATTERNS) if (re.test(text)) refHits.push(`${f} → ${name}`)
}
check(refHits.length === 0, 'B1 活代码零处引用计费实现', refHits.slice(0, 5).join(' | '))

const layoutText = readFileSync('src/app/platform/layout.tsx', 'utf8')
check(!layoutText.includes('/platform/orders'), 'B2 后台导航没有「订单」那项')
check(!layoutText.includes('Receipt'), 'B2b Receipt 图标也不再被 import')
check(!/订单/.test(layoutText), 'B2c 导航里没有「订单」二字')

const accessText = readFileSync('src/lib/platform-access.ts', 'utf8')
// 断的是 import 这条边，不是"文件名不许出现在注释里"：注释会说清这口径原来住在哪，那不算连着计费。
check(!/^\s*import\s[^\n]*from\s+['"]@\/lib\/billing/m.test(accessText), 'B3 写闸门不再 import billing-pricing', accessText.split('\n').filter(l => /^\s*import\s[^\n]*from\s+['"]@\/lib\/billing/.test(l)).join(' | '))
check(/export function isUnlimitedQuota/.test(accessText), 'B3b 写闸门自带 isUnlimitedQuota')
check(accessText.includes('isUnlimitedQuota(quota.maxStorageGB)'), 'B3c 存储闸门那一处调用没变')

// 语义必须逐字不变：<=0 是无限，正数是限额。搬前那份还在 billing-pricing 里，所以这里容错 import。
let isUnlimited: ((v: number) => boolean) | undefined
try {
  isUnlimited = (await import('../src/lib/platform-access')).isUnlimitedQuota
} catch {
  isUnlimited = undefined
}
if (!isUnlimited) {
  check(false, 'B4 isUnlimitedQuota 语义实测', 'platform-access 没导出它')
} else {
  const semantics = [[-1, true], [0, true], [1, false], [10, false], [Number.NaN, false]] as const
  const wrong = semantics.filter(([v, want]) => isUnlimited!(v) !== want).map(([v, want]) => `${v}→${isUnlimited!(v)}(要 ${want})`)
  check(wrong.length === 0, 'B4 isUnlimitedQuota 语义实测', wrong.join(' '))
}

// —— C 组：库和表不碰 ——
const schema = readFileSync('prisma/schema.prisma', 'utf8')
for (const model of ['Plan', 'Order', 'OrderEvent']) {
  check(new RegExp(`^model\\s+${model}\\s*\\{`, 'm').test(schema), `C1 schema 里 model ${model} 没删`)
}
check(existsSync('prisma/migrations/20260924180000_add_billing_orders'), 'C2 那次建表迁移目录还在')

// —— D 组：运行时（本地 dev 现问）——
async function codeOf(path: string): Promise<number | string> {
  try {
    const r = await fetch(`${BASE}${path}`, { redirect: 'manual' })
    return r.status
  } catch (e) {
    return `err:${(e as Error).message.slice(0, 40)}`
  }
}
const before = new Map<string, number | string>()
for (const p of MUST_404) before.set(p, await codeOf(p))
console.log(`首轮状态码：${[...before].map(([p, c]) => `${p}=${c}`).join(' ')}`)

const got404 = new Map<string, boolean>()
for (const p of MUST_404) got404.set(p, before.get(p) === 404)
const passLimit = Number(process.env.BILLING_CHECK_PASSES || 24)
let passes = 1
while ([...got404.values()].some(v => !v) && passes < passLimit) {
  await new Promise(r => setTimeout(r, 5000))
  passes++
  for (const [p, ok] of got404) if (!ok) got404.set(p, (await codeOf(p)) === 404)
}
for (const p of MUST_404) {
  check(got404.get(p) === true, `D1 ${p} 现在 404`, `首轮=${String(before.get(p))}，轮询 ${passes}/${passLimit} 轮`)
}

for (const p of MUST_STILL_WORK) {
  const c = await codeOf(p)
  check(c === 200 || c === 302 || c === 307, `D2 活路由 ${p} 没被带坏`, String(c))
}

if (failures.length > 0) {
  console.log(`\n共 ${ran} 条，FAIL ${failures.length} 条：\n - ${failures.join('\n - ')}`)
  process.exit(1)
}
console.log(`\nALL PASS（共 ${ran} 条）`)
