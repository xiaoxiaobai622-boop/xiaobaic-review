import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { getRequestedTeamId } from '@/lib/team-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const authResult = await getCurrentUserFromRequest(request)
  if (!authResult) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [memberships, invitations, joinRequests] = await Promise.all([
    prisma.teamMember.findMany({
      where: {
        userId: authResult.id,
        status: 'ACTIVE',
      },
      orderBy: { createdAt: 'asc' },
      select: {
        role: true,
        createdAt: true,
        team: {
          select: {
            id: true,
            name: true,
            slug: true,
            avatarUrl: true,
            status: true,
            subscriptionPlan: true,
            subscriptionExpiresAt: true,
            createdBy: {
              select: { id: true, name: true, email: true },
            },
            _count: {
              select: { members: true, projects: true },
            },
          },
        },
      },
    }),
    prisma.teamInvite.findMany({
      where: {
        status: 'PENDING',
        expiresAt: { gt: new Date() },
        OR: [
          ...(authResult.email
            ? [{ email: authResult.email.toLowerCase() }]
            : []),
          ...(authResult.phone ? [{ phone: authResult.phone }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        teamId: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        token: true,
        expiresAt: true,
        createdAt: true,
        team: {
          select: {
            id: true,
            name: true,
            slug: true,
            avatarUrl: true,
            _count: { select: { members: true, projects: true } },
          },
        },
      },
    }),
    prisma.teamJoinRequest.findMany({
      where: { userId: authResult.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        teamId: true,
        message: true,
        status: true,
        createdAt: true,
        reviewedAt: true,
        team: {
          select: {
            id: true,
            name: true,
            slug: true,
            avatarUrl: true,
            _count: { select: { members: true, projects: true } },
          },
        },
      },
    }),
  ])

  const teams = memberships.map((membership) => ({
    role: membership.role,
    memberSince: membership.createdAt,
    team: membership.team,
  }))

  const requestedTeamId = getRequestedTeamId(request)
  let activeTeamId: string | null
  if (requestedTeamId && memberships.some((item) => item.team.id === requestedTeamId)) {
    activeTeamId = requestedTeamId
  } else {
    activeTeamId =
      memberships.find((item) => item.team.status === 'ACTIVE')?.team.id ||
      memberships[0]?.team.id ||
      null
  }

  const response = NextResponse.json({
    teams,
    invitations,
    joinRequests,
    activeTeamId,
  })
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  response.headers.set('Pragma', 'no-cache')
  response.headers.set('Expires', '0')
  return response
}
