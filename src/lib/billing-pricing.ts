export const ALLOWED_PERIODS = [1, 3, 6, 12] as const
export const OPEN_ORDER_TTL_MS = 7 * 24 * 60 * 60 * 1000

export const ORDER_STATUSES = ['OPEN', 'REPORTED', 'PAID', 'FULFILLED', 'CLOSED'] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

// F-11：只列**有生产者**的码 —— 全仓 `throw new BillingError` 出的是这五枚（`billing.ts` / `billing-pricing.ts` / `card-redeem.ts` / `payment-provider.ts`）。到期与停用的 403 由写闸门 `src/lib/team-writeable.ts` 给，词表是那一侧的 `TeamWriteBlockCode`；鉴权失败由 `src/lib/auth.ts` 直接回 `{ error: 'Unauthorized' }`。两枚都不经 `BillingError`，留在这里就是广告三枚没人抛的码。
export type BillingErrorCode =
  | 'INVALID_PLAN' | 'INVALID_PERIODS' | 'NO_TRANSFER_CONFIG' | 'NOT_IMPLEMENTED' | 'STATE_CONFLICT'

export class BillingError extends Error {
  constructor(public code: BillingErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'BillingError'
  }
}

export type PlanQuota = { maxMembers: number; maxProjects: number; maxVideos: number; maxStorageGB: number }
export type FulfillmentPlan = { durationDays: number; quota: PlanQuota }

export function isAllowedPeriods(value: unknown): value is number {
  return typeof value === 'number' && (ALLOWED_PERIODS as readonly number[]).includes(value)
}

// Order.amountCents / Plan.priceCents 都是 Postgres INT4（Prisma 的 `Int`）。
// 超出去要到 INSERT 才炸，等于让客户点一次「下单」看到一次 500。
const MAX_AMOUNT_CENTS = 2_147_483_647

export function computeAmountCents(planPriceCents: number, periods: number): number {
  if (!Number.isInteger(planPriceCents) || planPriceCents < 0) throw new BillingError('INVALID_PLAN')
  if (!isAllowedPeriods(periods)) throw new BillingError('INVALID_PERIODS')
  const amount = planPriceCents * periods
  if (amount > MAX_AMOUNT_CENTS) throw new BillingError('INVALID_PLAN', 'amount exceeds Int4 ceiling')
  return amount
}

// 去掉了 I/O/0/1：转账备注要人手抄进银行界面，易混字符就是坏账的开头。
const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function randomReference(rand: () => number = Math.random): string {
  let body = ''
  for (let i = 0; i < 6; i += 1) {
    const index = Math.min(REFERENCE_ALPHABET.length - 1, Math.floor(rand() * REFERENCE_ALPHABET.length))
    body += REFERENCE_ALPHABET[index]
  }
  return `RV-${body}`
}

/** 时刻语义住在 `src/lib/billing.ts` 的 `fulfillOrder`（它先 `const now = new Date()`、再读团队 `subscriptionExpiresAt` 递进本函数，卡密兑换经 `src/lib/card-redeem.ts` 走的是同一个 `fulfillOrder`）：未到期则从现到期日往后叠，否则从现在起算。 */
export function nextExpiryMs(currentExpiresAt: Date | null, nowMs: number, durationDays: number): number {
  const base = currentExpiresAt && currentExpiresAt.getTime() > nowMs ? currentExpiresAt.getTime() : nowMs
  return base + durationDays * 86_400_000
}

export function quotaForPlan(plan: PlanQuota): PlanQuota {
  return {
    maxMembers: plan.maxMembers,
    maxProjects: plan.maxProjects,
    maxVideos: plan.maxVideos,
    maxStorageGB: plan.maxStorageGB,
  }
}

export type PreviewInput = {
  currentExpiresAt: Date | null
  nowMs: number
  periods: number
  plan: FulfillmentPlan
  currentQuota?: PlanQuota
  quotaSource?: 'PLAN' | 'MANUAL'
}

export type PreviewResult = {
  fromExpiry: number
  toExpiry: number
  toExpiryDate: Date
  willResetManual: boolean
  quotaChanged: boolean
  nextQuota: PlanQuota
}

/** 确认到账弹窗里「旧 → 新」的唯一算式来源；不查库，所以平台端和测试用同一段代码。 */
export function computeFulfillmentPreview(input: PreviewInput): PreviewResult {
  const { currentExpiresAt, nowMs, periods, plan } = input
  const toExpiryMs = nextExpiryMs(currentExpiresAt, nowMs, plan.durationDays * periods)
  const nextQuota = quotaForPlan(plan.quota)
  const current = input.currentQuota ?? null
  return {
    fromExpiry: currentExpiresAt ? currentExpiresAt.getTime() : nowMs,
    toExpiry: toExpiryMs,
    toExpiryDate: new Date(toExpiryMs),
    willResetManual: current !== null && input.quotaSource === 'MANUAL' && !sameQuota(current, nextQuota),
    quotaChanged: current === null ? true : !sameQuota(current, nextQuota),
    nextQuota,
  }
}

function sameQuota(a: PlanQuota, b: PlanQuota): boolean {
  return a.maxMembers === b.maxMembers
    && a.maxProjects === b.maxProjects
    && a.maxVideos === b.maxVideos
    && a.maxStorageGB === b.maxStorageGB
}

/**
 * F-12：「不限」的唯一口径 —— spec §4.1 写的是「0 或负数=不限」，所以判据是 `<= 0` 而不是 `=== 0`。
 * 写闸门（`platform-access.ts` 的 `checkTeamStorageQuota`）与两枚渲染方（平台队列 `OrderQueue.tsx` 的
 * `quotaText`、客户账单页 `studio/team/billing` 的额度四列）从这里取同一个判断，负数额度才不会
 * 「行为上不限、显示上写 -3 人」。住在枚纯函数模块而不是 `platform-access.ts`，是因为后两枚都是
 * `'use client'`，而那枚文件第一行就 `import { prisma }` —— Prisma 不许进浏览器包。
 */
export function isUnlimitedQuota(value: number): boolean {
  return value <= 0
}
