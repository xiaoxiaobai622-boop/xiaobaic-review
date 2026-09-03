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

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
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

  const baseSlug = slugify(name) || `team-${randomBytes(3).toString('hex')}`
  let slug = baseSlug
  let counter = 1
  while (await prisma.team.findUnique({ where: { slug }, select: { id: true } })) {
    slug = `${baseSlug}-${counter}`
    counter += 1
  }

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
