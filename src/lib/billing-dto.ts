import type { Order, Plan } from '@prisma/client'
import { quotaForPlan, type PlanQuota } from '@/lib/billing-pricing'

export type OrderDto = {
  id: string
  reference: string
  planKey: string
  periods: number
  amountCents: number
  currency: string
  status: string
  createdAt: string
  reportedAt: string | null
  paidAt: string | null
  fulfilledAt: string | null
  periodEnd: string | null
  closeReason: string | null
  reportNote: string | null
  invoiceRequested: boolean
  invoiceTitle: string | null
  invoiceTaxNo: string | null
}

/** Deliberately no account fields: transfer instructions only come from the intent route. */
export function toOrderDto(order: Order): OrderDto {
  return {
    id: order.id,
    reference: order.reference,
    planKey: order.planKey,
    periods: order.periods,
    amountCents: order.amountCents,
    currency: order.currency,
    status: order.status,
    createdAt: order.createdAt.toISOString(),
    reportedAt: order.reportedAt?.toISOString() ?? null,
    paidAt: order.paidAt?.toISOString() ?? null,
    fulfilledAt: order.fulfilledAt?.toISOString() ?? null,
    periodEnd: order.periodEnd?.toISOString() ?? null,
    closeReason: order.closeReason,
    reportNote: order.reportNote,
    invoiceRequested: order.invoiceRequested,
    invoiceTitle: order.invoiceTitle,
    invoiceTaxNo: order.invoiceTaxNo,
  }
}

/**
 * 门户套餐卡片的对外形状（`GET /api/billing/orders` 的 `plan[]`）。
 * 投影放在这里而不是路由文件里：本模块 owns「服务端行 → 客户可见形状」这一个角色，
 * app-router 的路由模块只导出 HTTP 方法（Task 9 也是从这里 `import type`）。
 */
export type PlanCard = {
  key: string
  name: string
  priceCents: number
  currency: string
  durationDays: number
  quota: PlanQuota
}

// 读接口要的那几列。用 select 而不是整行：整行会把 Plan 上未来的内部列一起带进客户响应体。
export const PLAN_CARD_SELECT = {
  key: true, name: true, priceCents: true, currency: true, durationDays: true,
  maxMembers: true, maxProjects: true, maxVideos: true, maxStorageGB: true,
} as const

type PlanCardRow = Pick<Plan, keyof typeof PLAN_CARD_SELECT>

/** 四列额度走 `quotaForPlan()`（`billing-pricing.ts:55`）而不是在这里手抄一遍键名。 */
export function toPlanCard(plan: PlanCardRow): PlanCard {
  return {
    key: plan.key,
    name: plan.name,
    priceCents: plan.priceCents,
    currency: plan.currency,
    durationDays: plan.durationDays,
    quota: quotaForPlan(plan),
  }
}
