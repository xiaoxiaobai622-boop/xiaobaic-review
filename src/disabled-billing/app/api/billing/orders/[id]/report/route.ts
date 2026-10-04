import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { getActiveTeamMembership, getRequestedTeamId } from '@/lib/team-access'
import { validateRequest, safeParseBodyTolerant } from '@/lib/validation'
import { reportOrderPaid } from '@/disabled-billing/lib/billing'
import { toOrderDto } from '@/disabled-billing/lib/billing-dto'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// 只接受 `reportNote` 一个键。截断与 trim 都在 `reportOrderPaid` 里（`src/lib/billing.ts`：trim 之后
// `slice(0, 200)`），路由不重复做一遍 —— 两处各切一次的话，谁改了长度上限都不会有人发现。体积上界由
// `safeParseBodyTolerant` 的 1MB 硬顶（超了 413）负责，不在这里再设一道跟截断对不上号的数。
// 尤其没有 `actorUserId` / `teamId` / `status` 这三个键：它们只能由服务端从会话、membership、CAS 派生。
const bodySchema = z.object({
  reportNote: z.string().nullish(),
})

// 报付款 = 「钱我们已经打了，请运营核对」：一期没有银行流水可对，这张单据的价值全在审计轨迹上 ——
// 谁、在什么时候、替哪个团队说了这句话（spec §7.2）。
//
// 门禁与账单读面（`orders/route.ts` 的 GET、`[id]/intent` 的 GET）用同一个解析器、同一份谓词，
// 唯一区别是**不查 `membership.role === 'OWNER'`**：花钱下单的要 OWNER，报付款不要 —— 转账常常是
// 团队里管钱的那个人做的，看得到账单就该报得出去。团队被平台置成 DISABLED 时整条账单面（含这个
// 写侧）一起消失，这件事由 `team-access.ts:40` 连着 `team.status` 一起判，路由不自己重新解析团队。
// `teamId` 同样只能从 membership 取：请求头 `x-team-id` 只是意图，不是授权来源。
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUserFromRequest(request)
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const membership = await getActiveTeamMembership(user, getRequestedTeamId(request))
  if (!membership) return NextResponse.json({ error: '无权访问' }, { status: 403 })

  const { id } = await params

  const parsed = await safeParseBodyTolerant(request)
  if (!parsed.success) return parsed.response
  const validation = validateRequest(bodySchema, parsed.data)
  if (!validation.success) {
    return NextResponse.json({ error: validation.error, details: validation.details }, { status: 400 })
  }

  try {
    const result = await prisma.$transaction((tx) => reportOrderPaid(tx, {
      orderId: id,
      teamId: membership.teamId,
      reportNote: validation.data.reportNote,
      // Task 3 评审 I-3：这一行是整条链路里唯一署名机会，缺了它就回落到 `createdById`（下单人），
      // 而报付款的人完全可以不是下单人 —— 那时审计轨迹就把「谁替团队说了这句话」写成了「谁下的单」。
      // 值**只能取自会话**：`reportOrderPaid` 不校验 `actorUserId` 是否属于 `teamId`（Task 3 fix
      // round 1 的 T3-R2 交接项），一旦允许从请求体取这个值，客户就能替别的团队的人署名，审计意义归零。
      actorUserId: user.id,
    }))
    // 抢不到单就是抢不到。`reportOrderPaid` 的 `updateMany` 谓词是 `{ id, teamId, status: 'OPEN' }`，
    // 于是「这张单不属于你的团队」与「这张单已经不是 OPEN」得到同一个答案（409 + 同一句文案），
    // 与 intent 路由把「单不存在」和「单不属于你」压成同一个 404 是一个道理：不替调用方确认哪一半成立。
    // 特别是这里**不能**给越权请求一个 403 —— 那等于公开说「这张单存在，只是不是你的」。
    if (!result.ok) {
      return NextResponse.json({ error: '该订单当前状态无法报付款' }, { status: 409 })
    }
    // 响应走 DTO 白名单（`billing-dto.ts`）：`reportOrderPaid` 回读的是不带 include 的整行 Order，
    // 里面的 `createdById`/`fulfilledById` 不会进响应体；收款账号更从来不在这条链路上被读过。
    return NextResponse.json({ order: toOrderDto(result.order) })
  } catch (error) {
    logError('[BILLING:REPORT] reportOrderPaid failed', error)
    return NextResponse.json({ error: '报付款失败，请重试' }, { status: 500 })
  }
}
