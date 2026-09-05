import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { randomBytes } from 'crypto'
import { TRIAL_PLAN, UNACTIVATED_PLAN, TRIAL_QUOTA } from '@/lib/platform-access'
import {
  checkWechatText,
  CONTENT_SECURITY_ERROR,
  CONTENT_VIOLATION_MESSAGE,
} from '@/lib/wechat-content-security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Team slugs are also used by the join link. Keep existing slugs working,
 * while assigning new teams a short, human-friendly numeric identifier.
 */
async function getNextTeamIdentifier() {
  const teams = await prisma.team.findMany({ select: { slug: true } })
  const maxIdentifier = teams.reduce((max, team) => {
    if (!/^\d+$/.test(team.slug)) return max
    const value = Number(team.slug)
    return Number.isSafeInteger(value) && value >= 10000 ? Math.max(max, value) : max
  }, 9999)

  let candidate = maxIdentifier + 1
  while (await prisma.team.findUnique({ where: { slug: String(candidate) }, select: { id: true } })) {
    candidate += 1
  }
  return String(candidate)
}

export async function GET(request: NextRequest) {
  const authResult = await getCurrentUserFromRequest(request)
  if (!authResult) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const memberships = await prisma.teamMember.findMany({
    where: {
      userId: authResult.id,
    },
    orderBy: { createdAt: 'asc' },
    include: {
      team: {
        select: {
          id: true,
          name: true,
          slug: true,
          avatarUrl: true,
          status: true,
          createdAt: true,
          createdBy: {
            select: { id: true, name: true, email: true },
          },
          _count: {
            select: { members: true, projects: true },
          },
        },
      },
    },
  })

  return NextResponse.json({
    teams: memberships.map((membership) => ({
      ...membership.team,
      role: membership.role,
      memberSince: membership.createdAt,
    })),
  })
}

export async function POST(request: NextRequest) {
  const authResult = await getCurrentUserFromRequest(request)
  if (!authResult) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!authResult.phone) {
    return NextResponse.json({ error: '创建团队前请先绑定手机号', code: 'PHONE_REQUIRED' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 80) {
    return NextResponse.json({ error: 'Team name is required' }, { status: 400 })
  }

  const securityCheck = await checkWechatText(name, { userId: authResult.id, scene: 1 })
  if (!securityCheck.passed) {
    return NextResponse.json(
      { error: securityCheck.error },
      { status: securityCheck.error === CONTENT_VIOLATION_MESSAGE ? 400 : 503 },
    )
  }

  const slug = await getNextTeamIdentifier()

  const team = await prisma.$transaction(async (tx) => {
    const existingTeamCount = await tx.team.count({ where: { createdById: authResult.id } })
    const isFirstTeam = existingTeamCount === 0
    const now = new Date()
    const created = await tx.team.create({
      data: {
        name,
        slug,
        shareKey: `tm_${randomBytes(5).toString('hex')}`,
        createdById: authResult.id,
        subscriptionPlan: isFirstTeam ? TRIAL_PLAN : UNACTIVATED_PLAN,
        subscriptionStartedAt: now,
        subscriptionExpiresAt: isFirstTeam ? new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000) : null,
      },
    })

    await tx.teamMember.create({
      data: {
        teamId: created.id,
        userId: authResult.id,
        role: 'OWNER',
      },
    })

    await tx.teamQuota.create({
      data: {
        teamId: created.id,
        ...TRIAL_QUOTA,
      },
    })

    return created
  })

  return NextResponse.json({ team }, { status: 201 })
}
