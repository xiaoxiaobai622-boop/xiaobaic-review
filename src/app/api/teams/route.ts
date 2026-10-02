import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { randomBytes } from 'crypto'
import { BETA_PLAN, BETA_QUOTA } from '@/lib/platform-access'
import {
  checkWechatText,
  CONTENT_VIOLATION_MESSAGE,
} from '@/lib/wechat-content-security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Team slugs are also used by the join link. Keep existing slugs working,
 * while assigning new teams a short, human-friendly numeric identifier.
 */
const TEAM_IDENTIFIER_SCAN_LIMIT = 1_000

/**
 * Runs inside the create transaction: the advisory lock serialises concurrent creates, so
 * the scan and the claim see one snapshot and two teams cannot take the same number.
 */
async function getNextTeamIdentifier(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(86230402)`

  const slugs = await tx.team.findMany({ select: { slug: true } })
  const taken = new Set(slugs.map((team) => team.slug))
  let maxIdentifier = 9999
  for (const { slug } of slugs) {
    if (!/^\d+$/.test(slug)) continue
    const value = Number(slug)
    if (Number.isSafeInteger(value) && value >= 10000) maxIdentifier = Math.max(maxIdentifier, value)
  }

  for (let offset = 1; offset <= TEAM_IDENTIFIER_SCAN_LIMIT; offset += 1) {
    const candidate = String(maxIdentifier + offset)
    if (!taken.has(candidate)) return candidate
  }
  throw new Error('TEAM_IDENTIFIER_LIMIT_REACHED')
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

  const team = await prisma.$transaction(async (tx) => {
    const now = new Date()
    const slug = await getNextTeamIdentifier(tx)
    const created = await tx.team.create({
      data: {
        name,
        slug,
        shareKey: `tm_${randomBytes(5).toString('hex')}`,
        createdById: authResult.id,
        subscriptionPlan: BETA_PLAN,
        subscriptionStartedAt: now,
        subscriptionExpiresAt: null,
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
        ...BETA_QUOTA,
        source: 'PLAN',
      },
    })

    return created
  })

  return NextResponse.json({ team }, { status: 201 })
}
