import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import type { AuthUser } from '@/lib/auth'

export const TEAM_HEADER = 'x-team-id'

export type TeamRoleName = 'OWNER' | 'ADMIN' | 'MEMBER'

export async function getTeamMember(teamId: string, userId: string) {
  return prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
    select: {
      id: true,
      role: true,
      status: true,
      teamId: true,
      userId: true,
      team: { select: { status: true } },
    },
  })
}

export function getRequestedTeamId(request: NextRequest): string | null {
  return request.headers.get(TEAM_HEADER)?.trim() || null
}

/**
 * The one place that decides which team a request acts on. Routes must not re-resolve
 * this themselves: a looser query can silently pick a team the caller was never
 * authorized for (e.g. a DISABLED one), so writes land outside the team the UI is showing.
 */
export async function getActiveTeamMembership(user: AuthUser, requestedTeamId?: string | null) {
  if (requestedTeamId) {
    const membership = await getTeamMember(requestedTeamId, user.id)
    if (!membership || membership.status !== 'ACTIVE' || membership.team?.status !== 'ACTIVE') return null
    return membership
  }

  return prisma.teamMember.findFirst({
    where: {
      userId: user.id,
      status: 'ACTIVE',
      team: { status: 'ACTIVE' },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      role: true,
      status: true,
      teamId: true,
      userId: true,
      team: { select: { status: true } },
    },
  })
}

export async function resolveActiveTeamId(user: AuthUser, requestedTeamId?: string | null) {
  const membership = await getActiveTeamMembership(user, requestedTeamId)
  return membership?.teamId || null
}

export async function requireTeamRole(
  request: NextRequest,
  user: AuthUser,
  roles: TeamRoleName[],
): Promise<{ teamId: string; role: TeamRoleName } | NextResponse> {
  const membership = await getActiveTeamMembership(user, getRequestedTeamId(request))

  if (!membership) {
    return NextResponse.json({ error: 'You do not belong to a team' }, { status: 403 })
  }

  if (!roles.includes(membership.role as TeamRoleName)) {
    return NextResponse.json({ error: 'Insufficient team permissions' }, { status: 403 })
  }

  return { teamId: membership.teamId, role: membership.role as TeamRoleName }
}

export async function requireTeamOwner(
  request: NextRequest,
  user: AuthUser,
): Promise<{ teamId: string } | NextResponse> {
  const result = await requireTeamRole(request, user, ['OWNER'])
  if (result instanceof NextResponse) return result
  return { teamId: result.teamId }
}

export async function canAccessTeamProject(
  user: AuthUser,
  teamId: string,
  projectId: string,
) {
  const membership = await getTeamMember(teamId, user.id)
  if (
    !membership ||
    membership.status !== 'ACTIVE' ||
    membership.team?.status !== 'ACTIVE'
  ) {
    return false
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, teamId },
    select: { id: true },
  })
  return Boolean(project)
}

export function teamProjectWhere(user: AuthUser, teamId: string) {
  return {
    teamId,
  }
}
