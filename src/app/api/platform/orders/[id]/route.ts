import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAuth } from '@/lib/auth'
import { loadFulfillmentOrder } from '@/lib/billing'
import { toOrderDto } from '@/lib/billing-dto'
import { computeFulfillmentPreview, quotaForPlan } from '@/lib/billing-pricing'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// 二次确认弹窗里「到期日 旧 → 新」「额度 旧 → 新」的数据源（spec §8.2）。
//
// 本路由存在的理由：预览必须与 `fulfillOrder()` 落地时用的是**同一个算式**，否则运营点下去
// 看到的数字就是骗人的。所以这里只调 `computeFulfillmentPreview()`，把入参原样递进去，
// 绝不在路由里自己乘一遍天数、自己拼一遍额度 —— 一旦两处各算各的，改了 `nextExpiryMs()`
// 的叠加规则时没人记得改弹窗。
//
// 只读，且没有状态闸门：`FULFILLED` / `CLOSED` 的单也要能点开看历史（Task 12 的每行详情），
// 判「还能不能确认」是 confirm 那一侧 CAS 的活。
//
// `loadFulfillmentOrder(orderId)`（`src/lib/billing.ts` 最后一个导出）不开放事务、自己读一次，所以本路由
// 不套 `$transaction` —— 单条读包事务没有任何收益，只多占一枚连接。
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePlatformAuth(request)
  if (user instanceof Response) return user
  const { id } = await params

  try {
    const loaded = await loadFulfillmentOrder(id)
    if (!loaded) return NextResponse.json({ error: '订单不存在' }, { status: 404 })
    const { order, quota } = loaded

    // 三个容易写错的地方，逐条说明：
    // 1) `currentExpiresAt` 取**团队列本身**（可为 null），不取 `order.periodEnd`：叠加的基准
    //    是团队当前的到期时刻，与这张单无关（`billing.ts:47` 读的就是同一列）。
    // 2) `quota` 为 null 时 `currentQuota` / `quotaSource` 一律留 `undefined`，**不兜任何默认值**。
    //    预览函数把「没有额度行」报成 `quotaChanged: true`（首次落地即新建），而这里若顺手兜一份
    //    schema 默认（10 人 / 5 项目 / 50 视频 / 20GB），它会同时对上 `quotaChanged: false` 和
    //    `willResetManual: false` —— 弹窗说额度不变，实际写进去的是套餐额度（台账：TeamQuota
    //    建行不许落到默认 20GB，同一族缺陷）。
    // 3) `quotaSource` 只认 `MANUAL` 这一个字面值，其余（含未来新增的 source）塌成 `PLAN`：
    //    报警只在真要覆盖手改特例时亮，宁可少报一次也不要把每单确认都染红。
    const preview = computeFulfillmentPreview({
      currentExpiresAt: order.team.subscriptionExpiresAt,
      nowMs: Date.now(),
      periods: order.periods,
      plan: { durationDays: order.plan.durationDays, quota: quotaForPlan(order.plan) },
      currentQuota: quota ? quotaForPlan(quota) : undefined,
      quotaSource: quota ? (quota.source === 'MANUAL' ? 'MANUAL' : 'PLAN') : undefined,
    })

    // `order` 与列表行同一个形状（OrderDto + teamName/planName），Task 12 的详情面板与队列行
    // 因此共用一个 row 类型。`preview` 原样是 `PreviewResult`：注意 `fromExpiry`/`toExpiry` 是
    // **毫秒数**、`toExpiryDate` 才是 Date（JSON 后成 ISO 串），三者语义不同，界面别混用。
    //
    // `currentQuota`（裁定 D-25）：与 `preview` **同级**，不是塞进 `preview` 里 —— `PreviewResult`
    // 一个字段都不许多（Task 11 断言 5 逐字段比对 preview）。它是上面第 2) 条喂进预览函数的那一枚
    // 真实额度行的四列回显，用途只有一个：让弹窗把「额度 旧 → 新」的**旧**字真摊出来。
    // **没有 TeamQuota 行时给 `null`**，界面必须按 null 处理，绝不兜成 0 或套餐默认四列
    //（台账 #57 那一族缺陷的形状：缺行被兜成默认值，界面就此说谎）。
    return NextResponse.json({
      order: { ...toOrderDto(order), teamName: order.team.name, planName: order.plan.name },
      preview,
      currentQuota: quota ? quotaForPlan(quota) : null,
    })
  } catch (error) {
    logError('[PLATFORM:ORDER] preview failed', error)
    return NextResponse.json({ error: '订单预览读取失败，请重试' }, { status: 500 })
  }
}
