import { PrismaClient } from '@prisma/client'
import { closeOrder, confirmAndFulfill, createOrder, fulfillOrder, loadFulfillmentOrder, reportOrderPaid } from '../lib/billing'
import { BillingError } from '../lib/billing-pricing'
import { hashPassword } from '@/lib/encryption'

const prisma = new PrismaClient()
const DAY = 86_400_000
let passed = 0
const failures: string[] = []
function expect(name: string, actual: unknown, want: unknown) {
  const ok = typeof want === 'number' && typeof actual === 'number'
    ? Math.abs(actual - want) < 1e-9
    : actual === want
  if (ok) passed += 1
  else failures.push(`${name}\n      expected ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`)
}

async function main() {
  const stamp = Date.now()
  const user = await prisma.user.create({
    // User.password is required and has no default (prisma/schema.prisma:6); the column
    // is named `password`, not `passwordHash`. A throwaway bcrypt value keeps this user
    // un-loggable while satisfying the NOT NULL.
    data: { email: `billing-check-${stamp}@example.invalid`, name: 'billing-check', password: await hashPassword(`billing-check-${stamp}`) },
  })
  // M-7: `try` starts immediately after user.create, so a throwing team.create still reaches the
  // cleanup below — otherwise the throwaway user would stay in a database that holds real teams.
  let teamId: string | null = null
  let reporterId: string | null = null
  try {
    const team = await prisma.team.create({
      data: { name: `billing-check-${stamp}`, slug: `billing-check-${stamp}`, shareKey: `bc-${stamp}`, createdById: user.id },
    })
    teamId = team.id
    // I-3 needs a second identity: if reporter === createdById, both branches of the fallback
    // write the same id and the assertion could never fail.
    const reporter = await prisma.user.create({
      data: { email: `billing-check-reporter-${stamp}@example.invalid`, name: 'billing-check-reporter', password: await hashPassword(`billing-check-reporter-${stamp}`) },
    })
    reporterId = reporter.id
    const first = await prisma.$transaction((tx) => createOrder(tx, { teamId: team.id, planKey: 'MONTHLY', periods: 3, actorUserId: user.id }))
    expect('first order opens', first.reused, false)
    // 种子计划是 0 分（spec 禁止编造定价），所以这里 `0 × 3 === 0` 是一条永真断言。
    // 「金额由服务端按 plan 算」的真正证明在下面自建的非 0 价计划上。
    expect('status starts OPEN', first.order.status, 'OPEN')
    const refShape = /^RV-[A-HJ-NP-Z2-9]{6}$/.test(first.order.reference)
    expect('reference shaped', refShape, true)
    expect('manual attempt written', await prisma.paymentAttempt.count({ where: { orderId: first.order.id, provider: 'manual' } }), 1)

    // 平台端预览的读入口（M-6）：此刻团队还没有 TeamQuota 行，正好是 `quota: null` 那条分支。
    const preview = await loadFulfillmentOrder(first.order.id)
    expect('preview finds the order', preview?.order.id, first.order.id)
    expect('preview carries the plan', preview?.order.plan.key, 'MONTHLY')
    expect('preview carries the team', preview?.order.team.id, team.id)
    expect('preview quota is null with no quota row', preview?.quota, null)

    // 幂等：已有 OPEN 单时复用同一张，而不是造第二张
    const again = await prisma.$transaction((tx) => createOrder(tx, { teamId: team.id, planKey: 'MONTHLY', periods: 3, actorUserId: user.id }))
    expect('reused same order', again.reused, true)
    expect('same id returned', again.order.id, first.order.id)
    expect('still one open order', await prisma.order.count({ where: { teamId: team.id } }), 1)

    // I-2：复用分支不许吞掉发票请求（那是服务申请，不是展示入参），后到的覆盖先到的。
    const againInvoice = await prisma.$transaction((tx) => createOrder(tx, { teamId: team.id, planKey: 'MONTHLY', periods: 3, actorUserId: user.id, invoice: { requested: true, title: '甲方抬头', taxNo: 'TAX-1' } }))
    expect('reuse still returns the live order', againInvoice.order.id, first.order.id)
    expect('reuse carries the invoice request', againInvoice.order.invoiceTitle, '甲方抬头')
    expect('reuse persists the invoice request', (await prisma.order.findUniqueOrThrow({ where: { id: first.order.id } })).invoiceTaxNo, 'TAX-1')
    const againInvoice2 = await prisma.$transaction((tx) => createOrder(tx, { teamId: team.id, planKey: 'MONTHLY', periods: 3, actorUserId: user.id, invoice: { requested: true, title: '换成这一家' } }))
    expect('later invoice overwrites, not merges', againInvoice2.order.invoiceTitle, '换成这一家')
    expect('omitted taxNo cleared to null', againInvoice2.order.invoiceTaxNo, null)
    const againNoInvoice = await prisma.$transaction((tx) => createOrder(tx, { teamId: team.id, planKey: 'MONTHLY', periods: 3, actorUserId: user.id }))
    expect('reuse without invoice leaves it intact', againNoInvoice.order.invoiceTitle, '换成这一家')

    // 报付款只允许一次
    const reported = await prisma.$transaction((tx) => reportOrderPaid(tx, { orderId: first.order.id, teamId: team.id, reportNote: '尾号 1234' }))
    expect('report accepted', reported.ok, true)
    // I-3 的回落一侧：调用方没给 actorUserId 时才记 createdById。
    expect('report without actor falls back to the creator',
      (await prisma.orderEvent.findFirstOrThrow({ where: { orderId: first.order.id, type: 'REPORTED' } })).actorUserId,
      first.order.createdById)
    const again2 = await prisma.$transaction((tx) => reportOrderPaid(tx, { orderId: first.order.id, teamId: team.id }))
    expect('second report refused', again2.ok, false)
    expect('second report leaves note intact', (await prisma.order.findUniqueOrThrow({ where: { id: first.order.id } })).reportNote, '尾号 1234')
    expect('second report leaves reportedAt intact',
      (await prisma.order.findUniqueOrThrow({ where: { id: first.order.id } })).reportedAt!.getTime(),
      reported.order!.reportedAt!.getTime())

    // 报付款不许跨团队
    const crossTeam = await prisma.$transaction((tx) => reportOrderPaid(tx, { orderId: first.order.id, teamId: 'other-team' }))
    expect('cross-team report refused', crossTeam.ok, false)

    // 确认到账 → 权益落地，且恰好 +90 天
    const before = await prisma.team.findUniqueOrThrow({ where: { id: team.id } })
    const confirmed = await prisma.$transaction((tx) => confirmAndFulfill(tx, { orderId: first.order.id, actorUserId: user.id }))
    expect('confirm accepted', confirmed.ok, true)
    const after = await prisma.team.findUniqueOrThrow({ where: { id: team.id } })
    expect('team reactivated', after.status, 'ACTIVE')
    expect('plan written', after.subscriptionPlan, 'MONTHLY')
    const days = after.subscriptionExpiresAt!.getTime() - (before.subscriptionExpiresAt?.getTime() ?? after.subscriptionStartedAt.getTime())
    expect('expiry moved by exactly 90 days', Math.round(days / DAY), 90)
    const quota = await prisma.teamQuota.findUniqueOrThrow({ where: { teamId: team.id } })
    expect('quota members from seed plan', quota.maxMembers, 10)
    expect('quota storage from seed plan', quota.maxStorageGB, 50)
    expect('quota source recorded', quota.source, 'PLAN')
    expect('quota points at the order', quota.sourceOrderId, first.order.id)
    const done = await prisma.order.findUniqueOrThrow({ where: { id: first.order.id } })
    expect('order fulfilled', done.status, 'FULFILLED')
    expect('paidAt and fulfilledAt both set', Boolean(done.paidAt && done.fulfilledAt), true)
    expect('periodEnd equals expiry', done.periodEnd?.getTime(), after.subscriptionExpiresAt!.getTime())
    expect('two events logged', await prisma.orderEvent.count({ where: { orderId: done.id, type: { in: ['CONFIRMED', 'FULFILLED'] } } }), 2)

    // 双点确认：第二次必须失败，且不许再加 90 天
    const second = await prisma.$transaction((tx) => confirmAndFulfill(tx, { orderId: done.id, actorUserId: user.id }))
    expect('second confirm refused', second.ok, false)
    expect('expiry not moved again',
      (await prisma.team.findUniqueOrThrow({ where: { id: team.id } })).subscriptionExpiresAt!.getTime(),
      after.subscriptionExpiresAt!.getTime())

    // 关单：只作用于未终结单，且不许动权益
    const o2 = await prisma.$transaction((tx) => createOrder(tx, { teamId: team.id, planKey: 'MONTHLY', periods: 1, actorUserId: user.id }))
    // I-3 的另一侧：另一个成员代报付款时，事件记的是代报人，不是下单人。
    const reportedByOther = await prisma.$transaction((tx) => reportOrderPaid(tx, { orderId: o2.order.id, teamId: team.id, reportNote: '同事代报', actorUserId: reporter.id }))
    expect('report by another member accepted', reportedByOther.ok, true)
    expect('REPORTED event credits the reporter, not the creator',
      (await prisma.orderEvent.findFirstOrThrow({ where: { orderId: o2.order.id, type: 'REPORTED' } })).actorUserId, reporter.id)
    const expiryBeforeClose = (await prisma.team.findUniqueOrThrow({ where: { id: team.id } })).subscriptionExpiresAt!.getTime()
    expect('close accepted', (await prisma.$transaction((tx) => closeOrder(tx, { orderId: o2.order.id, actorUserId: user.id, reason: '客户取消' }))).ok, true)
    expect('closed order reason stored', (await prisma.order.findUniqueOrThrow({ where: { id: o2.order.id } })).closeReason, '客户取消')
    expect('close does not touch expiry',
      (await prisma.team.findUniqueOrThrow({ where: { id: team.id } })).subscriptionExpiresAt!.getTime(), expiryBeforeClose)
    expect('closing twice refused',
      (await prisma.$transaction((tx) => closeOrder(tx, { orderId: o2.order.id, actorUserId: user.id, reason: '再点一次' }))).ok, false)
    // 关单之后可以重新下单
    const o3 = await prisma.$transaction((tx) => createOrder(tx, { teamId: team.id, planKey: 'MONTHLY', periods: 1, actorUserId: user.id }))
    expect('new order after close', o3.reused, false)

    // 超 7 天的 OPEN 单在下次下单时被惰性关掉并新建
    await prisma.order.update({ where: { id: o3.order.id }, data: { createdAt: new Date(Date.now() - 8 * DAY) } })
    const o4 = await prisma.$transaction((tx) => createOrder(tx, { teamId: team.id, planKey: 'MONTHLY', periods: 1, actorUserId: user.id }))
    expect('stale order not reused', o4.reused, false)
    expect('stale order closed', (await prisma.order.findUniqueOrThrow({ where: { id: o3.order.id } })).status, 'CLOSED')

    // 自建一支非 0 价、非常见天数的计划：证「金额与时长都取自 plan」而不是硬编码
    const pricePlan = await prisma.plan.create({
      data: { key: `BCHECK-${stamp}`, name: 'billing-check', priceCents: 39800, durationDays: 31, maxMembers: 3, maxProjects: 4, maxVideos: 5, maxStorageGB: 6 },
    })
    await prisma.$transaction((tx) => closeOrder(tx, { orderId: o4.order.id, actorUserId: user.id, reason: '切换到自建计划' }))
    const expiryBeforePrice = (await prisma.team.findUniqueOrThrow({ where: { id: team.id } })).subscriptionExpiresAt!.getTime()
    // I-4：把额度行手工改成运营值，第二次成功落地必须走 upsert 的 update 分支把它翻回 PLAN。
    // 第一次落地吃的是 create 分支，而 TeamQuota.source 的 schema 默认值就是 PLAN
    // （prisma/schema.prisma:176），所以只有这一条腿能证到 billing.ts 显式写入的两个字段。
    await prisma.teamQuota.update({ where: { teamId: team.id }, data: { source: 'MANUAL', sourceOrderId: null } })
    expect('quota hand-forced to MANUAL before the second fulfilment',
      (await prisma.teamQuota.findUniqueOrThrow({ where: { teamId: team.id } })).source, 'MANUAL')
    const priced = await prisma.$transaction((tx) => createOrder(tx, { teamId: team.id, planKey: pricePlan.key, periods: 6, actorUserId: user.id }))
    expect('amount = plan price × periods', priced.order.amountCents, 39800 * 6)
    expect('currency copied from plan', priced.order.currency, 'CNY')
    const pricedDone = await prisma.$transaction((tx) => confirmAndFulfill(tx, { orderId: priced.order.id, actorUserId: user.id }))
    expect('priced order confirmed', pricedDone.ok, true)
    expect('expiry stacks by plan durationDays',
      (await prisma.team.findUniqueOrThrow({ where: { id: team.id } })).subscriptionExpiresAt!.getTime(),
      expiryBeforePrice + 31 * 6 * DAY)
    const pricedQuota = await prisma.teamQuota.findUniqueOrThrow({ where: { teamId: team.id } })
    expect('quota members from plan', pricedQuota.maxMembers, 3)
    expect('quota storage from plan', pricedQuota.maxStorageGB, 6)
    expect('second fulfilment flips MANUAL back to PLAN', pricedQuota.source, 'PLAN')
    expect('second fulfilment rewrites sourceOrderId', pricedQuota.sourceOrderId, priced.order.id)

    // 非法入参
    await expectRejects('unknown plan', () => prisma.$transaction((tx) => createOrder(tx, { teamId: team.id, planKey: 'YEARLY', periods: 1, actorUserId: user.id })), 'INVALID_PLAN')
    await expectRejects('periods off whitelist', () => prisma.$transaction((tx) => createOrder(tx, { teamId: team.id, planKey: 'MONTHLY', periods: 2, actorUserId: user.id })), 'INVALID_PERIODS')
    // I-1：fulfillOrder 的状态门是白名单，只放过 PAID。o2 早在上面就被运营关掉了（CLOSED），
    // 直接 fulfil 必须抛 STATE_CONFLICT；抛出即回滚，库里不会留下「已履约的死单」。
    await expectRejects('closed order cannot be fulfilled directly', () => prisma.$transaction((tx) => fulfillOrder(tx, o2.order.id, user.id)), 'STATE_CONFLICT')
  } finally {
    // 删除顺序由 FK 决定：Order.teamId / Order.createdById / OrderEvent.actorUserId 都是
    // RESTRICT（Task 1），先删团队或用户会直接被拒。attempts/events 随 Order CASCADE。
    // 这里不吞异常：清不干净就是污染了本地库，必须让它响。
    if (teamId) await prisma.order.deleteMany({ where: { teamId } })
    await prisma.plan.deleteMany({ where: { key: `BCHECK-${stamp}` } })
    if (teamId) await prisma.team.delete({ where: { id: teamId } })
    if (reporterId) await prisma.user.delete({ where: { id: reporterId } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) { console.log(failures.join('\n')); process.exit(1) }
}

async function expectRejects(name: string, fn: () => Promise<unknown>, code: string) {
  try { await fn(); failures.push(`${name}\n      expected BillingError ${code}, got none`) }
  catch (e) {
    if (e instanceof BillingError && e.code === code) passed += 1
    else failures.push(`${name}\n      expected ${code}, got ${String(e)}`)
  }
}
main()
