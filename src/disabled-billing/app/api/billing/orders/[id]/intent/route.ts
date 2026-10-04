import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { getActiveTeamMembership, getRequestedTeamId } from '@/lib/team-access'
import { getPaymentProvider } from '@/disabled-billing/lib/payment-provider'
import { BillingError, type OrderStatus } from '@/disabled-billing/lib/billing-pricing'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// 全局约束「`status` 一律 String 列 + TS 字面量联合 + 常量数组」的房规读法写在 `billing.ts:13-16`：
// `Order.status` 是裸 String 列，Prisma 会把状态字面量放宽成 `string`，`'REPORTT ED'` 也能编译。
// 这道 409 是「钱不该再发给已结的单」的唯一闸门，所以读常量而不是裸字面量。
const OPEN: OrderStatus = 'OPEN'

// 对公转账说明的唯一出口：账号/户名/开户行/备注/收款码键只从这里下发
// （`billing-dto.ts` 的 OrderDto 刻意不带它们，列表/下单接口也从来不读 Settings）。
//
// 门禁与订单列表 GET 同一口径：任意 ACTIVE 团队的 ACTIVE 成员都能看（付这笔钱的不一定是 OWNER），
// 团队被平台停用即整条账单面消失。`teamId` 只从 membership 派生，请求头只是意图不是授权来源。
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUserFromRequest(request)
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const membership = await getActiveTeamMembership(user, getRequestedTeamId(request))
  if (!membership) return NextResponse.json({ error: '无权访问' }, { status: 403 })

  const { id } = await params
  // `findFirst({ where: { id, teamId } })` 而不是先按 id 查再比团队：后者要给越权请求一个
  // 单独的 403，等于把「这张单存在但不属于你」这件事公开说出去。合在一个谓词里天然只有 404。
  const order = await prisma.order.findFirst({ where: { id, teamId: membership.teamId } })
  if (!order) return NextResponse.json({ error: '订单不存在' }, { status: 404 })
  // 只有 OPEN 还需要人付款：REPORTED 在运营队列里、PAID/FULFILLED 已结、CLOSED 已作废，
  // 再发一份账号出去只可能收到一笔没人认领的转账。
  if (order.status !== OPEN) return NextResponse.json({ error: '该订单已不需要付款' }, { status: 409 })

  try {
    const intent = await getPaymentProvider().createIntent(order)
    return NextResponse.json(intent)
  } catch (error) {
    // 平台还没配收款账户时，客户看到的不是「服务器坏了」而是一句能照着做的话：
    // 一期只有对公转账，账号要运营在后台填了才可能有。503 而不是 404 —— 订单是真的，
    // 缺的是服务端依赖的配置。
    if (error instanceof BillingError && error.code === 'NO_TRANSFER_CONFIG') {
      return NextResponse.json({ error: '平台尚未配置收款账户，请联系运营' }, { status: 503 })
    }
    logError('[BILLING:INTENT] createIntent failed', error)
    return NextResponse.json({ error: '获取收款信息失败，请重试' }, { status: 500 })
  }
}
