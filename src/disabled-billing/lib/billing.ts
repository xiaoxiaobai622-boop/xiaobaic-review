import { randomUUID } from 'crypto'
import type { Order, Plan, Prisma, Team, TeamQuota } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  BillingError, OPEN_ORDER_TTL_MS, computeAmountCents, isAllowedPeriods,
  nextExpiryMs, quotaForPlan, randomReference, type OrderStatus,
} from '@/disabled-billing/lib/billing-pricing'

export type Tx = Prisma.TransactionClient

// `Order.status` is a plain String column (Task 1), so Prisma widens every status literal to
// `string` and a typo such as 'REPORTT ED' compiles. Declaring the literals once against the
// union Task 2 exports (`OrderStatus`, derived from ORDER_STATUSES) moves the check onto these
// declaration lines; every site below reads them instead of a bare string.
const OPEN: OrderStatus = 'OPEN'
const REPORTED: OrderStatus = 'REPORTED'
const PAID: OrderStatus = 'PAID'
const FULFILLED: OrderStatus = 'FULFILLED'
const CLOSED: OrderStatus = 'CLOSED'
/** Orders still in play: reusable by `createOrder`, reportable, confirmable, closable. */
const LIVE_ORDER_STATUSES: OrderStatus[] = [OPEN, REPORTED]

/**
 * The only place in this codebase allowed to write a team's entitlements
 * (subscription columns + quota). Order fulfilment and activation-card
 * redemption both funnel here, so "what did this purchase buy" has one answer.
 */
export async function fulfillOrder(
  tx: Tx,
  orderId: string,
  actorUserId: string,
  opts: { markPaid?: boolean } = {},
): Promise<{ team: Team; quota: TeamQuota; order: Order }> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { plan: true },
  })
  if (!order) throw new BillingError('STATE_CONFLICT', 'order missing')
  // Allowlist, not a denylist: PAID is the only state this function may mint entitlements
  // from, so an order ops already CLOSED can never be fulfilled by a direct caller.
  if (order.status !== PAID) throw new BillingError('STATE_CONFLICT', `order is ${order.status}, not PAID`)

  const now = new Date()
  // 权益基准列由这把**按团队维度**的事务级锁护住：键 `'team:' + order.teamId` 从订单行本身推导（手法照仓里现成的先例 `api/videos/[id]/duplicate/route.ts` 的 `pg_advisory_xact_lock(hashtext(key))`），拿到锁才读下面那一列，锁随事务 COMMIT 才释放。
  // `confirmAndFulfill` 的 CAS 只锁 `Order` 行、从不锁 `Team` 行：两位运营同时确认同一团队的两枚不同订单时，后进入的那一发排在锁后面，读到的是前一发写回的到期日，于是两期天数都叠得上（时长算法依旧在 `nextExpiryMs()`/`billing-pricing.ts`，没有搬进 SQL）。
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'team:' + order.teamId}))`
  const current = await tx.team.findUniqueOrThrow({
    where: { id: order.teamId },
    select: { subscriptionExpiresAt: true },
  })
  const durationDays = order.plan.durationDays * order.periods
  const expiryMs = nextExpiryMs(current.subscriptionExpiresAt, now.getTime(), durationDays)
  const quotaValues = quotaForPlan(order.plan)

  // Sequential, not Promise.all: an interactive $transaction runs every query on one
  // pooled connection anyway, and the four writes here share the same `now`/`expiryMs`.
  const team = await tx.team.update({
    where: { id: order.teamId },
    data: {
      status: 'ACTIVE',
      subscriptionPlan: order.planKey,
      subscriptionStartedAt: now,
      subscriptionExpiresAt: new Date(expiryMs),
    },
  })
  // `source: 'PLAN'` is written, not defaulted: this function IS the PLAN definition.
  // `sourceOrderId` has no FK and no relation (Task 1 ruling) — it is a human-readable
  // provenance clue, never a join key.
  const quota = await tx.teamQuota.upsert({
    where: { teamId: order.teamId },
    create: { teamId: order.teamId, ...quotaValues, source: 'PLAN', sourceOrderId: order.id },
    update: { ...quotaValues, source: 'PLAN', sourceOrderId: order.id },
  })
  const updated = await tx.order.update({
    where: { id: order.id },
    data: {
      status: FULFILLED,
      fulfilledAt: now,
      fulfilledById: actorUserId,
      ...(opts.markPaid ? { paidAt: now } : {}),
      periodStart: now,
      periodEnd: new Date(expiryMs),
    },
  })
  await tx.orderEvent.create({
    data: { orderId: order.id, actorUserId, type: 'FULFILLED', note: `+${durationDays}d` },
  })

  return { team, quota, order: updated }
}

async function findLiveOrder(tx: Tx, teamId: string) {
  return tx.order.findFirst({ where: { teamId, status: { in: LIVE_ORDER_STATUSES } }, orderBy: { createdAt: 'desc' } })
}

export async function createOrder(
  tx: Tx,
  input: {
    teamId: string
    planKey: string
    periods: number
    actorUserId: string
    invoice?: { requested: boolean; title?: string | null; taxNo?: string | null }
    /**
     * Never hand back an order that is already in play — always open a fresh one.
     *
     * Card redemption is the only caller that needs this: it stamps whatever `createOrder` returns
     * as PAID with a `CD-…` reference and a zero amount. Reusing the customer's live order would do
     * exactly that to the order they are already waiting on — the reference they copied into the
     * bank transfer gets replaced, and the row disappears from the ops queue without anyone
     * confirming a payment. That is a lie on the money path, so the reuse branch has to be able to
     * turn itself off (D-37). Default `false` keeps every other caller's behaviour exactly as it
     * was. The arm that closes a timed-out OPEN order is deliberately left alone: that is
     * bookkeeping every caller wants, card paths included, and it never hands the closed order back.
     */
    noReuse?: boolean
  },
) {
  if (!isAllowedPeriods(input.periods)) throw new BillingError('INVALID_PERIODS')
  const plan = await tx.plan.findUnique({ where: { key: input.planKey } })
  if (!plan || !plan.active) throw new BillingError('INVALID_PLAN')

  // 一期没有定时任务，所以"过期"只在有人来下单这一刻判定一次；没人再点续费的话，
  // 旧单会留在 OPEN 里由运营手关（spec §7.1）。
  const live = await findLiveOrder(tx, input.teamId)
  if (live && live.status === OPEN && Date.now() - live.createdAt.getTime() > OPEN_ORDER_TTL_MS) {
    // M-10: writes no OrderEvent on purpose — OrderEvent.actorUserId is NOT NULL with a User FK, and a timeout has no actor to sign it with.
    await tx.order.updateMany({
      where: { id: live.id, status: OPEN },
      data: { status: CLOSED, closeReason: '超时未付款，自动关闭' },
    })
  } else if (live && !input.noReuse) {
    // The guard sits on this arm rather than on the `return` below it: falling past that return
    // would land in the invoice branch, which dereferences `input.invoice` and is only reached
    // today because the early return above it guarantees one exists.
    if (!input.invoice) return { order: live, reused: true }
    // An invoice request is a service request, not a display input like planKey/periods, so the
    // reuse path must carry it: otherwise a customer who asks for an invoice while an order is
    // still live gets `reused: true` and the request vanishes silently. Latest request wins,
    // which is exactly what the create path below writes.
    const withInvoice = await tx.order.update({
      where: { id: live.id },
      data: {
        invoiceRequested: input.invoice.requested,
        invoiceTitle: input.invoice.title ?? null,
        invoiceTaxNo: input.invoice.taxNo ?? null,
      },
    })
    return { order: withInvoice, reused: true }
  }

  const amountCents = computeAmountCents(plan.priceCents, input.periods)
  const order = await tx.order.create({
    data: {
      teamId: input.teamId,
      planKey: plan.key,
      periods: input.periods,
      amountCents,
      currency: plan.currency,
      reference: await uniqueReference(tx),
      status: OPEN,
      createdById: input.actorUserId,
      invoiceRequested: input.invoice?.requested ?? false,
      invoiceTitle: input.invoice?.title ?? null,
      invoiceTaxNo: input.invoice?.taxNo ?? null,
      attempts: { create: { provider: 'manual', outTradeNo: `MANUAL-${randomUUID()}`, amountCents } },
      events: { create: { actorUserId: input.actorUserId, type: 'CREATED' } },
    },
    include: { plan: true },
  })
  return { order, reused: false }
}

async function uniqueReference(tx: Tx): Promise<string> {
  for (let i = 0; i < 5; i += 1) {
    const candidate = randomReference()
    const hit = await tx.order.findUnique({ where: { reference: candidate }, select: { id: true } })
    if (!hit) return candidate
  }
  // Exhaustion path keeps sampling randomReference() instead of deriving from a UUID: an
  // uppercased hex slice reintroduces 0 and 1, which the alphabet drops on purpose
  // (「转账备注要人手抄进银行界面」) and which this task's own reference regex rejects.
  // Uniqueness is still unchecked, as before — that is the concurrent-P2002 question, parked
  // for Task 6 (error -> HTTP mapping is the route's job).
  return randomReference()
}

export async function reportOrderPaid(
  tx: Tx,
  input: { orderId: string; teamId: string; reportNote?: string | null; actorUserId?: string },
) {
  const note = typeof input.reportNote === 'string' ? input.reportNote.trim().slice(0, 200) : null
  const claimed = await tx.order.updateMany({
    where: { id: input.orderId, teamId: input.teamId, status: OPEN },
    data: { status: REPORTED, reportedAt: new Date(), reportNote: note },
  })
  if (claimed.count !== 1) return { ok: false as const }
  const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId } })
  // The audit trail names whoever reported the payment, not whoever happened to create the order:
  // any team owner can report another member's transfer. createdById remains only as the fallback
  // for callers that genuinely have no user in hand (Task 4's provider callback).
  await tx.orderEvent.create({
    data: { orderId: order.id, actorUserId: input.actorUserId ?? order.createdById, type: 'REPORTED', note },
  })
  return { ok: true as const, order }
}

export async function confirmAndFulfill(tx: Tx, input: { orderId: string; actorUserId: string }) {
  const claimed = await tx.order.updateMany({
    where: { id: input.orderId, status: { in: LIVE_ORDER_STATUSES } },
    data: { status: PAID, paidAt: new Date() },
  })
  if (claimed.count !== 1) return { ok: false as const }
  await tx.orderEvent.create({ data: { orderId: input.orderId, actorUserId: input.actorUserId, type: 'CONFIRMED' } })
  const result = await fulfillOrder(tx, input.orderId, input.actorUserId, { markPaid: true })
  const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId } })
  return { ok: true as const, order, team: result.team, quota: result.quota }
}

export async function closeOrder(tx: Tx, input: { orderId: string; actorUserId: string; reason: string }) {
  const reason = input.reason.trim().slice(0, 200)
  const claimed = await tx.order.updateMany({
    where: { id: input.orderId, status: { in: LIVE_ORDER_STATUSES } },
    data: { status: CLOSED, closeReason: reason },
  })
  if (claimed.count !== 1) return { ok: false as const }
  await tx.orderEvent.create({ data: { orderId: input.orderId, actorUserId: input.actorUserId, type: 'CLOSED', note: reason } })
  return { ok: true as const }
}

/** 平台端预览用：不开放事务，自己读一次。 */
export async function loadFulfillmentOrder(
  orderId: string,
): Promise<{ order: Order & { plan: Plan; team: Team }; quota: TeamQuota | null } | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { plan: true, team: true },
  })
  if (!order) return null
  const quota = await prisma.teamQuota.findUnique({ where: { teamId: order.teamId } })
  return { order, quota }
}
