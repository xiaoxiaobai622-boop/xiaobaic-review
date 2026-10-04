import {
  ALLOWED_PERIODS, BillingError, OPEN_ORDER_TTL_MS, ORDER_STATUSES, computeAmountCents,
  computeFulfillmentPreview, isAllowedPeriods, nextExpiryMs, quotaForPlan, randomReference,
} from '../lib/billing-pricing'

const DAY = 86_400_000
let passed = 0
const failures: string[] = []
function expect(name: string, actual: unknown, want: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(want)
  if (ok) passed += 1
  else failures.push(`${name}\n      expected ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`)
}
function expectThrows(name: string, fn: () => unknown, code: string) {
  try { fn(); failures.push(`${name}\n      expected throw ${code}, got none`) }
  catch (e) {
    if (e instanceof BillingError && e.code === code) passed += 1
    else failures.push(`${name}\n      expected BillingError ${code}, got ${String(e)}`)
  }
}

// 状态常量数组必须钉住：Task 3 的状态机、Task 11 的队列筛选都按名字取
expect('order statuses pinned', ORDER_STATUSES, ['OPEN', 'REPORTED', 'PAID', 'FULFILLED', 'CLOSED'])

// 周期白名单
expect('periods 1 allowed', isAllowedPeriods(1), true)
expect('periods 2 rejected', isAllowedPeriods(2), false)
expect('periods "3" rejected (string)', isAllowedPeriods('3'), false)
expect('periods 12 is the max', ALLOWED_PERIODS, [1, 3, 6, 12])

// 金额只由服务端算
expect('amount scales with periods', computeAmountCents(39800, 3), 119400)
expect('free plan prices to 0', computeAmountCents(0, 12), 0)
expectThrows('negative price rejected', () => computeAmountCents(-1, 1), 'INVALID_PLAN')
expectThrows('non-integer price rejected', () => computeAmountCents(1.5, 1), 'INVALID_PLAN')
expectThrows('bad periods rejected', () => computeAmountCents(100, 7), 'INVALID_PERIODS')
// amountCents 落库是 Postgres INT4，超出去就是运行期写入炸
expectThrows('one cent beyond Int4 ceiling rejected', () => computeAmountCents(716_000_000, 3), 'INVALID_PLAN')
expect('exactly at Int4 ceiling still fine', computeAmountCents(2_147_483_647, 1), 2_147_483_647)

// 转账备注码：大写、无易混字符、形如 RV-XXXXXX
const fixedRand = () => 0.999999
const ref = randomReference(fixedRand)
expect('reference shape', /^RV-[A-HJ-NP-Z2-9]{6}$/.test(ref), true)
expect('reference is deterministic given rand', randomReference(fixedRand), ref)
// 逐个索引扫，别只采 6 个点：只采 6 个点时把字母表换回完整 A-Z0-9 也照样全绿（已实测）。
// (k + 0.5) / 32 * 32 下取整正好是 k，所以 32 个位置每个都被命中一次。
const every = Array.from({ length: 32 }, (_, k) => () => (k + 0.5) / 32)
expect('no I/O/0/1 anywhere in the 32-char alphabet',
  every.map(f => randomReference(f)).join('').match(/[IO01]/g), null)
expect('all 32 alphabet positions are distinct',
  new Set(every.map(f => randomReference(f).slice(3)).flat()).size, 32)

// 到期叠加：`nextExpiryMs` 就是生产那一路（`src/lib/billing.ts` 的 `fulfillOrder` 读团队
// `subscriptionExpiresAt` + 它自己的 `new Date()` 递进本函数；卡密兑换经 `src/lib/card-redeem.ts` 走同一个
// `fulfillOrder`），这里给三个时刻把它的三分支钉住。
const now = Date.parse('2026-09-24T00:00:00.000Z')
expect('no expiry starts from now', nextExpiryMs(null, now, 30), now + 30 * DAY)
expect('future expiry stacks', nextExpiryMs(new Date(now + 5 * DAY), now, 30), now + 35 * DAY)
expect('past expiry restarts from now', nextExpiryMs(new Date(now - 40 * DAY), now, 30), now + 30 * DAY)

// 确认前预览（平台端二次确认框的数据源）
const plan = { durationDays: 30, quota: { maxMembers: 10, maxProjects: 0, maxVideos: 0, maxStorageGB: 50 } }
// 注意：预览结果有 6 个字段，别拿 3 个字段的字面量去 JSON 比（永远不等，断言会假失败）。逐字段取。
const p1 = computeFulfillmentPreview({ currentExpiresAt: new Date(now + 10 * DAY), nowMs: now, periods: 3, plan })
expect('preview: unexpired team 旧→新', [p1.fromExpiry, p1.toExpiry, p1.willResetManual, p1.quotaChanged],
  [now + 10 * DAY, now + 100 * DAY, false, true])
expect('preview: toExpiryDate 与 toExpiry 是同一个数', p1.toExpiryDate.getTime(), now + 100 * DAY)
expect('preview: nextQuota 就是套餐额度', p1.nextQuota, plan.quota)
expect('preview: manual quota is flagged',
  computeFulfillmentPreview({
    currentExpiresAt: null, nowMs: now, periods: 1, plan,
    currentQuota: { maxMembers: 99, maxProjects: 0, maxVideos: 0, maxStorageGB: 999 }, quotaSource: 'MANUAL',
  }).willResetManual, true)
// spec §8.2 只看 source==='MANUAL'；这里额外要求额度真的不同才报警（§8.3 的口径）。
// 这条分支是刻意收窄，Task 11 的弹窗按它写，所以必须钉住两侧。
expect('preview: MANUAL quota already equal to plan => no reset warning',
  computeFulfillmentPreview({
    currentExpiresAt: null, nowMs: now, periods: 1, plan,
    currentQuota: plan.quota, quotaSource: 'MANUAL',
  }).willResetManual, false)
expect('preview: identical quota reports no change',
  computeFulfillmentPreview({
    currentExpiresAt: null, nowMs: now, periods: 1, plan,
    currentQuota: plan.quota, quotaSource: 'PLAN',
  }).quotaChanged, false)
expect('quotaForPlan copies only the four allowance columns',
  quotaForPlan({ ...plan.quota, extra: 1 } as never), plan.quota)
expect('OPEN orders live a week', OPEN_ORDER_TTL_MS, 7 * DAY)

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) { console.log(failures.join('\n')); process.exit(1) }
