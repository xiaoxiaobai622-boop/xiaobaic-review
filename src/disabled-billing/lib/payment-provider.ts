import type { Order, Team, TeamQuota } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getTransferConfig } from '@/lib/settings'
import { BillingError } from '@/lib/billing-pricing'
import { confirmAndFulfill } from '@/lib/billing'

export type PaymentProviderKey = 'manual' | 'wechat'

export type OrderLike = {
  id: string
  reference: string
  amountCents: number
  currency: string
}

export type PaymentIntent =
  | {
      kind: 'instructions'
      accountName: string
      accountNo: string
      bank: string | null
      amountCents: number
      currency: string
      reference: string
      note: string | null
      qrPath: string | null
    }
  | { kind: 'native'; codeUrl: string; expiresAt: string }

/**
 * `markPaid` returns the confirmation outcome rather than `void` (spec §6 sketches
 * `Promise<void>`): "someone already confirmed this order" is the one failure the ops
 * button must show, and a void return forces the route to guess. Discriminated exactly
 * like `confirmAndFulfill` — an `ok: true` caller gets the order without a `!`, and a
 * future provider that answers `ok: true` with no payload does not compile.
 */
export type ConfirmResult =
  | { ok: true; order: Order; team: Team; quota: TeamQuota }
  | { ok: false }

/**
 * Two channels have different shapes, which is why PAID and FULFILLED are
 * separate states: the manual provider settles both in one click, a wechat
 * callback can only write PAID and leaves fulfilment retryable without
 * charging twice. Phase 1 ships `manual` only; `verifyCallback`/`refund`
 * stay declared so adding wechat is a new class, not an interface change.
 */
export interface PaymentProvider {
  readonly key: PaymentProviderKey
  createIntent(order: OrderLike): Promise<PaymentIntent>
  markPaid(input: { orderId: string; actorUserId: string }): Promise<ConfirmResult>
  verifyCallback(request: Request): Promise<never>
  refund(input: { orderId: string; amountCents: number }): Promise<never>
}

class ManualTransferProvider implements PaymentProvider {
  readonly key = 'manual' as const

  async createIntent(order: OrderLike): Promise<PaymentIntent> {
    const config = await getTransferConfig()
    if (!config.configured) throw new BillingError('NO_TRANSFER_CONFIG')
    return {
      kind: 'instructions',
      accountName: config.accountName!,
      accountNo: config.accountNo!,
      bank: config.bank,
      amountCents: order.amountCents,
      currency: order.currency,
      reference: order.reference,
      note: config.note,
      qrPath: config.qrPath,
    }
  }

  async markPaid({ orderId, actorUserId }: { orderId: string; actorUserId: string }): Promise<ConfirmResult> {
    // 两次写必须在同一个事务里。落章是「这次点击」的审计记录，而败者的点击永远进不了
    // 下面的分支 —— 所以一旦订单先提交、落章后失败，那张单就再也无人能把它盖成
    // SUCCEEDED（后续点击全部 CAS 失败），钱账对不上且不可恢复。
    return prisma.$transaction(async (tx) => {
      const result = await confirmAndFulfill(tx, { orderId, actorUserId })
      // Only a won race settles the attempt: stamping SUCCEEDED on a losing click would
      // report a payment this click never made.
      if (result.ok) {
        await tx.paymentAttempt.updateMany({
          where: { orderId, provider: this.key, status: 'CREATED' },
          data: { status: 'SUCCEEDED', providerRef: `confirmed:${actorUserId}` },
        })
      }
      return result
    })
  }

  async verifyCallback(): Promise<never> {
    throw new BillingError('NOT_IMPLEMENTED')
  }

  async refund(): Promise<never> {
    throw new BillingError('NOT_IMPLEMENTED')
  }
}

const providers: Record<PaymentProviderKey, PaymentProvider | null> = { manual: new ManualTransferProvider(), wechat: null }

export function getPaymentProvider(key: PaymentProviderKey = 'manual'): PaymentProvider {
  const provider = providers[key]
  if (!provider) throw new BillingError('NOT_IMPLEMENTED', `provider ${key} is not configured`)
  return provider
}
