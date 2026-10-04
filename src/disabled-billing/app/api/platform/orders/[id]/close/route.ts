import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePlatformAuth } from '@/lib/auth'
import { closeOrder } from '@/lib/billing'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// 关单：一期没有定时任务，过期的 `OPEN` 单要靠运营手关（`src/lib/billing.ts` 里 `createOrder`
// 开头那段「一期没有定时任务」的注释就是在说这件事），
// 关掉的唯一凭据就是这句理由 —— 它会出现在客户的账单页上（spec §8.2），所以它是必填项而不是选填。
//
// 事务归谁（与 confirm 那一侧**相反**，本任务最容易写反的一处）：`closeOrder(tx, input)`
// 吃的是外部 `tx`（签名第一个形参就是它，见 `src/lib/billing.ts`），它自己不连接数据库，所以 **本路由自己开事务**，
// 让「状态 CAS + `CLOSED` 审计事件」落在同一个原子块里。两枚函数签名同为 `(tx, input)` 形状
// 但事务归属完全相反：confirm 那侧多包一层是 bug，这一侧不包是 bug。
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePlatformAuth(request)
  if (user instanceof Response) return user
  const { id } = await params

  // trim 只用来**判空**，不用来改写入库值：去空白与截 200 字符是 `closeOrder` 一个人的活
  // （`closeOrder` 开头那句 `input.reason.trim().slice(0, 200)`）。路由再切一遍的话，将来谁改了上限就只有 provider 那一侧生效。
  const body = await request.json().catch(() => null)
  const reason = typeof body?.reason === 'string' ? body.reason : ''
  // 平台控制台中文硬编码，不走 `t('reasonRequired')`（那是客户门户那一侧的口径，Step 2）。
  // 判空排在鉴权之后、事务之前：`{}`、`''`、`'   '`、非字符串、无 body 全部 400。
  if (!reason.trim()) return NextResponse.json({ error: '请填写关单理由' }, { status: 400 })

  try {
    const result = await prisma.$transaction((tx) => closeOrder(tx, { orderId: id, actorUserId: user.id, reason }))
    // 与 confirm 同一个道理：`closeOrder` 的 CAS 谓词是 `status in (OPEN, REPORTED)`（`src/lib/billing.ts`
    // 里它自己那次 `updateMany` 的 `where`），于是「单不存在」「单已 FULFILLED（钱已落地）」「单已被别人关掉」得到同一个答案。已落地的那张
    // 单**关不动**是刻意的：`CLOSED` 不该抹掉一条已经改过客户权益的付款记录。
    if (!result.ok) return NextResponse.json({ error: '该订单已被处理，无法关单' }, { status: 409 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    logError('[PLATFORM:ORDER] closeOrder failed', error)
    return NextResponse.json({ error: '关单失败，请刷新队列后重试' }, { status: 500 })
  }
}
