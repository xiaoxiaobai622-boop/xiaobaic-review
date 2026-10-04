import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePlatformAuth } from '@/lib/auth'
import { toOrderDto } from '@/disabled-billing/lib/billing-dto'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// 运营队列的三个视图：等确认的、已下单未付的、全部（含 FULFILLED / CLOSED 历史）。
const STATUS_FILTERS = ['REPORTED', 'OPEN', 'ALL'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

// 白名单判据单独成函数：`status` 是查询串里的自由文本，任何非法值（`PAID`、`BOGUS`、空、
// 拼错）都按 `REPORTED` 出队列，**不 500**。后台缺陷体检里记过同一类缺陷（项目列表 sort
// 非法值把整页判死）：队列是运营核对钱的唯一入口，给它一个能被打挂的形状，比给错一份筛选
// 结果更糟。白名单也不包含 PAID —— 那是 confirm 与 fulfill 之间的瞬时状态，一期没有能停在
// 那里的通道，做成 tab 只会多一个恒为 0 的空壳。
function isStatusFilter(value: unknown): value is StatusFilter {
  return typeof value === 'string' && (STATUS_FILTERS as readonly string[]).includes(value)
}

// 鉴权用 `requirePlatformAuth`（`src/lib/auth.ts:439`），与 `/api/platform/**` 下现有 7 个
// route 同一枚：它只接平台令牌受众（`decoded.type !== 'platform_access'` 即拒），并在回库读
// User 时判 `isPlatformAdmin`（`:436`）。换成 `requirePlatformAdmin` 会把这个目录里唯一的
// 「动客户权益」写入口放宽到团队令牌 —— 那枚令牌是发给客户侧的。没有平台会话时是 401。
export async function GET(request: NextRequest) {
  const user = await requirePlatformAuth(request)
  if (user instanceof Response) return user

  const raw = new URL(request.url).searchParams.get('status')
  const filter: StatusFilter = isStatusFilter(raw) ? raw : 'REPORTED'

  try {
    // `where` 单独成值：`findMany` 与 `count` 必须用**同一枚谓词**（裁定 D-18）。
    // `take: 100` 截的是当前筛选这一列的长度，而界面要回答的是「这个筛选下一共有几单」——
    // 从被截断的 100 行里数，第 101 单在控制台里就没有任何发现途径了（`[id]`/confirm/close
    // 都按 orderId 走，技术上够得着，但列表是唯一给运营看 id 的地方）。
    const where = filter === 'ALL' ? {} : { status: filter }

    // 三次读并发，但 `counts` 必须是**单独一次 groupBy**：它要回答的是「全局还有几单等确认」，
    // 与当前筛选无关；徽标从被截断的 100 行里数会说谎。
    const [rows, grouped, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { team: { select: { name: true } }, plan: { select: { name: true } } },
      }),
      prisma.order.groupBy({ by: ['status'], _count: true }),
      // **不是**把 `counts` 各值求和 —— 那是全状态合计，跟筛选后的列表对不上（D-18）。
      prisma.order.count({ where }),
    ])

    const counts: Record<string, number> = {}
    for (const row of grouped) counts[row.status] = row._count

    // 行形状 = `OrderDto`（白名单，`billing-dto.ts`）+ 团队名 + 套餐名。`createdById` /
    // `fulfilledById` 这类内部 id 不出门，收款配置（`Settings.transfer*`）这条链路从不读 ——
    // 银行账号的唯一出口仍然是 intent 路由（spec §11.3）。
    return NextResponse.json({
      orders: rows.map((row) => ({ ...toOrderDto(row), teamName: row.team.name, planName: row.plan.name })),
      counts,
      // `total` = 与当前 `status` 筛选同谓词的行数（不限 100）。界面在 `total > orders.length`
      // 时明示「仅显示最近 100 条」；真分页（`skip`/`page`）留二期，本期只要求**可见**（D-18）。
      total,
    })
  } catch (error) {
    logError('[PLATFORM:ORDERS] list failed', error)
    return NextResponse.json({ error: '订单列表读取失败，请重试' }, { status: 500 })
  }
}
