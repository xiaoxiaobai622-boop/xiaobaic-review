import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAuth } from '@/lib/auth'
import { getPaymentProvider } from '@/lib/payment-provider'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// 「确认到账」是全站唯一会把某个团队的 `subscriptionExpiresAt` 前移、并覆盖它额度的按钮
// （spec §8.2：误点代价等同对生产跑一条 UPDATE）。它只做两件事：认人、把点击转交给 provider。
//
// 为什么必须走 `getPaymentProvider().markPaid()` 而不是直接调 `confirmAndFulfill()`
// （Task 11 Step 2）：「这笔钱算不算到账」二期换通道时只有 provider 知道 —— `confirmAndFulfill`
// 是 Task 3 的权益落地入口，绕过 provider 就等于把通道逻辑写回控制器，届时换通道要在每个调用点
// 找一遍。`markPaid` 内部调的就是 `confirmAndFulfill`（`payment-provider.ts:80`）。
//
// 事务归谁（本任务最容易写反的一处）：`markPaid` **自己开** `prisma.$transaction`
// （`payment-provider.ts:79`），在里面抢单 + 落权益 + 把 `PaymentAttempt` 盖成 `SUCCEEDED`。
// ⇒ 本路由**绝不再包一层 `$transaction`**：包了就把 provider 的一个原子事务切成两段
// （订单先提交、章后盖失败 → 这张单再也没人能盖成 SUCCEEDED，钱账对不上且不可恢复）。
// 对照 `[id]/close/route.ts`：`closeOrder(tx, …)` 吃外部事务，那一侧才由路由自己开。
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePlatformAuth(request)
  if (user instanceof Response) return user
  const { id } = await params

  try {
    // 署名只能取自会话（`user.id`）：请求体在这条链路上根本没有可读的键，
    // 一旦允许从 body 取 actorUserId，运营台账里「谁确认的这笔钱」就变成客户端说了算。
    const result = await getPaymentProvider().markPaid({ orderId: id, actorUserId: user.id })

    // 抢不到单 = 「这张单已经被人处理过了，或者根本不存在」。两种来源压成同一句话同一个码，
    // 与 report 路由不替调用方确认哪一半成立是同一条口径。`ok: false` 由 provider 的 CAS 给出，
    // 两个运营同时点只有一枚 200（Task 11 Step 4 断言 6）。
    if (!result.ok) return NextResponse.json({ error: '该订单已被处理' }, { status: 409 })

    // 200 的信封仍是 Task 11 的 Produces 契约 `{ ok, team, quota }`：运营点完确认要立刻在队列里
    // 看到新到期日与新额度，Task 12 不必再猜哪几列变了。但 `team` 在这里**做投影**，只发
    // `{ id, name, status, subscriptionExpiresAt }` 四列，不发 `result.team` 那一整行 ——
    // `result.team` 是 provider 事务里读出的完整 `Team`（`payment-provider.ts:38`），含
    // `shareKey` / `createdById` / `avatarUrl` / `updatedAt` 这些界面用不着也不该用到的列。
    // 收窄的理由只有一句（F-10：原先这里写的论据是假的 —— 平台侧的团队读面 `GET /api/platform/teams`
    // 走的确实是 `select` 投影，但它投影里就带着 `createdBy` 的 id/name/email 与 owner 的 user.id，
    // 「从不发内部 id」在这枚路由上根本不成立，不能拿来给另一条路由当理由）：
    // **回显只发弹窗要显示的那四列，不比 `Team` 整行宽** —— 弹窗要的是团队名、状态、新到期日加一张
    // 额度行，`shareKey` 之类一列都用不上。真正管得住内部 id 的那条不变量住在订单读面：
    // `api/platform/orders/route.ts` 里 `toOrderDto` 那段注释（`createdById` / `fulfilledById` 这类内部 id 不出门）。
    // `quota` 仍是整行 `TeamQuota`：四列额度 + `source` + `sourceOrderId` 都是弹窗要显示的数字。
    // 收款配置（`Settings` 那五列 transfer*）从头到尾没在这条链路上被读过（只有 `createIntent` 读）。
    return NextResponse.json({
      ok: true,
      team: {
        id: result.team.id,
        name: result.team.name,
        status: result.team.status,
        subscriptionExpiresAt: result.team.subscriptionExpiresAt,
      },
      quota: result.quota,
    })
  } catch (error) {
    // 拿不到结果 ⇒ 只能建议刷新后重试：这一发到底落没落地，从这个 catch 里**看不出来**
    // （事务已提交但响应没回到客户端、或连接池在 Postgres 提交之后超时，都会走到这里）。
    // 「重试安全」不靠这个判断成立，靠的是 confirmAndFulfill 的 CAS：单行已是 PAID/FULFILLED
    // 时重试只会拿到 409，不会双份加天数。
    logError('[PLATFORM:ORDER] markPaid failed', error)
    return NextResponse.json({ error: '确认到账失败，请刷新队列后重试' }, { status: 500 })
  }
}
