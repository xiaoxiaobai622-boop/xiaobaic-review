import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getCurrentUserFromRequest } from '@/lib/auth'
import type { AuthUser } from '@/lib/auth'
import { getActiveTeamMembership, getRequestedTeamId } from '@/lib/team-access'
import { validateRequest, safeParseBodyTolerant } from '@/lib/validation'
import { createOrder } from '@/lib/billing'
import { BillingError, isAllowedPeriods } from '@/lib/billing-pricing'
import { PLAN_CARD_SELECT, toOrderDto, toPlanCard } from '@/lib/billing-dto'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  planKey: z.string().trim().min(1).max(40),
  periods: z.number().int(),
  invoice: z.object({
    requested: z.boolean(),
    title: z.string().trim().max(80).nullish(),
    taxNo: z.string().trim().max(40).nullish(),
  }).optional(),
})

// 只有团队所有者能花钱。用房内解析器而不是自己比对 membership：团队会被平台置成
// DISABLED（platform/teams/[id]/route.ts:18），届时这条链路上就不该再产生新订单 ——
// `team-access.ts:33-35` 的注释正是在拦「路由自己重新解析、判得更松」。
async function ownerTeam(request: NextRequest, user: AuthUser) {
  const membership = await getActiveTeamMembership(user, getRequestedTeamId(request))
  if (!membership || membership.role !== 'OWNER') return null
  return membership.teamId
}

// 三条拒答口径：401 = 没有会话，403 = 有会话但没有可下单的团队，400 = 请求体本身不合法。
// 403 的文案跟 `api/teams/[id]/activate` 里「只有团队所有者可以激活团队」那一句同族（中文、说清「谁能做这件事」），而不是
// `requireTeamRole()` 的通用英文 —— 用房内解析器换来的是门禁语义一致，代价是它把
// 「不是 OWNER」和「团队被平台停用/不属于任何 ACTIVE 团队」压成同一个 null，所以这句
// 话对后者偏窄。停用的真相由 TeamExpiryBadge（Task 10）在界面上单独说，这里不重复判。
export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request)
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const teamId = await ownerTeam(request, user)
  if (!teamId) return NextResponse.json({ error: '只有团队所有者可以下单' }, { status: 403 })

  const parsed = await safeParseBodyTolerant(request)
  if (!parsed.success) return parsed.response
  const validation = validateRequest(bodySchema, parsed.data)
  if (!validation.success) {
    return NextResponse.json({ error: validation.error, details: validation.details }, { status: 400 })
  }
  const { planKey, periods, invoice } = validation.data

  // 白名单必须在进 createOrder 之前判：`periods: z.number().int()` 拦得住 2.5 拦不住 2，
  // 而 2 期会一路走到 `createOrder` 抛 BillingError —— 边界上它是 400，进了库里就只剩 500。
  if (!isAllowedPeriods(periods)) {
    return NextResponse.json({ error: '续费时长只能是 1、3、6、12 期' }, { status: 400 })
  }

  // 未定价套餐在边界上挡掉。Task 1 只 seed 了 `MONTHLY` 且 priceCents 写成 0 分（不编造定价），
  // 而 `computeAmountCents` 只拒负数 —— 不挡就能对 MONTHLY 下出一张 0 元单，运营手一抖白续一年。
  // 不改 `createOrder`：Task 13 的卡密兑换正是用 priceCents: 0 的 Plan 行走同一条路。
  // 这次读不代替 createOrder 内部的校验，只是把「不可售」变成一个能读懂的 400。
  const plan = await prisma.plan.findUnique({ where: { key: planKey }, select: { active: true, priceCents: true } })
  if (!plan || !plan.active || plan.priceCents <= 0) {
    return NextResponse.json({ error: '该套餐尚未开放，请联系运营' }, { status: 400 })
  }

  try {
    const { order, reused } = await prisma.$transaction((tx) => createOrder(tx, {
      teamId,
      planKey,
      periods,
      actorUserId: user.id,
      invoice,
    }))
    // DTO 是白名单：create 分支带回来的 `include: { plan: true }` 与嵌套的 attempts/events
    // 都不会进响应体，收款信息（Settings.transfer*）更是从来没被读过。
    return NextResponse.json({ order: toOrderDto(order), reused })
  } catch (error) {
    if (error instanceof BillingError) {
      // 与上面两道前置检查同一份文案：客户看到的 400 不该因为被哪一层拦下而不同。
      if (error.code === 'INVALID_PERIODS') {
        return NextResponse.json({ error: '续费时长只能是 1、3、6、12 期' }, { status: 400 })
      }
      if (error.code === 'INVALID_PLAN') {
        return NextResponse.json({ error: '该套餐尚未开放，请联系运营' }, { status: 400 })
      }
      logError('[BILLING:ORDERS] createOrder rejected', error)
      return NextResponse.json({ error: '下单失败，请重试' }, { status: 500 })
    }
    // `Order.reference` 是 @unique，`uniqueReference(tx)` 建行前查 5 次，剩下的窗口只有
    // 「两个人同一毫秒撞出同一个码」。撞上了就重试，而不是把 Prisma 原文吐给客户端。
    if ((error as { code?: string } | null)?.code === 'P2002') {
      logError('[BILLING:ORDERS] reference collision', error)
      return NextResponse.json({ error: '下单失败，请重试' }, { status: 500 })
    }
    logError('[BILLING:ORDERS] createOrder failed', error)
    return NextResponse.json({ error: '下单失败，请重试' }, { status: 500 })
  }
}

// 账单面（订单列表 + 可售套餐 + 当前权益）。门禁与 POST 同一个解析器、同一份团队状态谓词，
// 唯一差别是不判 `role === 'OWNER'`：看账单不需要花钱的权限，与 `/studio/team` 现状一致；
// 被平台停用的团队照样进不来（`team-access.ts:40` 连着 `team.status` 一起判）。
// 这个面是只读的，且响应是 DTO 白名单：账号/收款字段的唯一出口是 intent 路由。
export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request)
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const membership = await getActiveTeamMembership(user, getRequestedTeamId(request))
  if (!membership) return NextResponse.json({ error: '无权访问' }, { status: 403 })
  const teamId = membership.teamId

  try {
    const [orders, plans, team] = await Promise.all([
      prisma.order.findMany({ where: { teamId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      // `priceCents > 0` 是「界面说的和服务端做的要一致」：Task 1 只 seed 了一档 0 分的 MONTHLY，
      // 列出来就是一张 ¥0 的卡片、点一次被 POST 拒一次。运营填上真实价格后卡片自己回来。
      prisma.plan.findMany({
        where: { active: true, priceCents: { gt: 0 } },
        orderBy: { sort: 'asc' },
        select: PLAN_CARD_SELECT,
      }),
      prisma.team.findUnique({
        where: { id: teamId },
        select: {
          subscriptionPlan: true, subscriptionExpiresAt: true,
          quota: { select: { source: true, sourceOrderId: true } },
        },
      }),
    ])
    // 落地单的备注码。存量团队（本计划之前建的）的 TeamQuota 是 source='PLAN' + sourceOrderId=null，
    // 所以「PLAN 但没有单」是**多数派**，不是异常路径。
    const sourceOrderId = team?.quota?.sourceOrderId ?? null
    const quotaReference = sourceOrderId
      ? (await prisma.order.findUnique({ where: { id: sourceOrderId }, select: { reference: true } }))?.reference ?? null
      : null
    return NextResponse.json({
      orders: orders.map(toOrderDto),
      plan: plans.map(toPlanCard),
      team: {
        plan: team?.subscriptionPlan ?? null,
        expiresAt: team?.subscriptionExpiresAt?.toISOString() ?? null,
        quota: {
          source: team?.quota?.source ?? null,
          reference: quotaReference,
        },
      },
    })
  } catch (error) {
    logError('[BILLING:ORDERS] list failed', error)
    return NextResponse.json({ error: '账单读取失败，请重试' }, { status: 500 })
  }
}
