import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { getTeamMember } from '@/lib/team-access'
import { MONTHLY_PLAN, isTeamSubscriptionActive } from '@/lib/platform-access'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function hashCardCode(code: string) {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex')
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await getCurrentUserFromRequest(request)
  if (!authResult) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const membership = await getTeamMember(id, authResult.id)
  if (!membership || membership.status !== 'ACTIVE' || membership.role !== 'OWNER') {
    return NextResponse.json({ error: '只有团队所有者可以激活团队' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const code = typeof body?.code === 'string' ? body.code.trim().toUpperCase() : ''
  if (code.length < 8) return NextResponse.json({ error: '请输入有效的卡密' }, { status: 400 })

  try {
    const result = await prisma.$transaction(async (tx) => {
      const team = await tx.team.findUnique({
        where: { id },
        select: { subscriptionPlan: true, subscriptionExpiresAt: true },
      })
      if (!team) return { kind: 'missing' as const }

      const card = await tx.teamActivationCard.findUnique({
        where: { codeHash: hashCardCode(code) },
      })
      if (!card || card.status !== 'AVAILABLE') return { kind: 'invalid' as const }

      const claimed = await tx.teamActivationCard.updateMany({
        where: { id: card.id, status: 'AVAILABLE' },
        data: {
          status: 'REDEEMED',
          redeemedAt: new Date(),
          redeemedByTeamId: id,
          redeemedByUserId: authResult.id,
        },
      })
      if (claimed.count !== 1) return { kind: 'invalid' as const }

      const now = new Date()
      const currentExpiry = team.subscriptionExpiresAt && team.subscriptionExpiresAt > now
        ? team.subscriptionExpiresAt
        : now
      const expiresAt = new Date(currentExpiry.getTime() + card.durationDays * 24 * 60 * 60 * 1000)
      const updatedTeam = await tx.team.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          subscriptionPlan: card.planKey || MONTHLY_PLAN,
          subscriptionStartedAt: now,
          subscriptionExpiresAt: expiresAt,
        },
        select: { subscriptionPlan: true, subscriptionStartedAt: true, subscriptionExpiresAt: true },
      })
      const quota = await tx.teamQuota.upsert({
        where: { teamId: id },
        create: {
          teamId: id,
          maxMembers: card.maxMembers,
          maxProjects: card.maxProjects,
          maxVideos: card.maxVideos,
          maxStorageGB: card.maxStorageGB,
        },
        update: {
          maxMembers: card.maxMembers,
          maxProjects: card.maxProjects,
          maxVideos: card.maxVideos,
          maxStorageGB: card.maxStorageGB,
        },
      })

      return { kind: 'activated' as const, team: updatedTeam, quota }
    })

    if (result.kind === 'missing') return NextResponse.json({ error: '团队不存在' }, { status: 404 })
    if (result.kind === 'invalid') return NextResponse.json({ error: '卡密无效、已使用或已停用' }, { status: 400 })
    return NextResponse.json({
      team: result.team,
      quota: result.quota,
      active: isTeamSubscriptionActive(result.team),
    })
  } catch {
    return NextResponse.json({ error: '激活失败，请稍后重试' }, { status: 500 })
  }
}
