import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { ProjectRole } from '@prisma/client'
import { prisma } from './db'
import { requireApiUser, type AuthUser } from './auth'
import { canProject, resolveProjectRole, type ProjectAction } from './project-policy'

export type ProjectAccessContext = {
  id: string
  teamId: string
  restricted: boolean
}

export type ProjectAccess = {
  user: AuthUser
  project: ProjectAccessContext
  role: ProjectRole
}

export async function getProjectAccessContext(userId: string, projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      teamId: true,
      restricted: true,
      team: { select: { status: true } },
    },
  })
  if (!project || project.team.status !== 'ACTIVE') return null

  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId: project.teamId, userId } },
    select: {
      role: true,
      status: true,
      projectAccessScope: true,
      defaultProjectRole: true,
    },
  })
  if (!membership || membership.status !== 'ACTIVE') return null

  const projectMember = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { role: true },
  })

  const role = resolveProjectRole({
    teamRole: membership.role,
    projectAccessScope: membership.projectAccessScope,
    defaultProjectRole: membership.defaultProjectRole,
    restricted: project.restricted,
    projectMemberRole: projectMember?.role ?? null,
  })

  return {
    project: { id: project.id, teamId: project.teamId, restricted: project.restricted },
    membership,
    projectMemberRole: projectMember?.role ?? null,
    role,
  }
}

/**
 * The one gate for project-level writes. It intentionally runs requireApiUser
 * first so the phone/team checks stay identical to the rest of the console.
 */
export async function requireProjectAction(
  request: NextRequest,
  projectId: string,
  action: ProjectAction,
): Promise<ProjectAccess | Response> {
  const user = await requireApiUser(request)
  if (user instanceof Response) return user

  const context = await getProjectAccessContext(user.id, projectId)
  if (!context || context.project.teamId !== user.authorizedTeamId) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  if (!canProject(context.role, action)) {
    return NextResponse.json(
      { error: 'Insufficient project permissions', code: 'PROJECT_PERMISSION_DENIED', action },
      { status: 403 },
    )
  }

  return { user, project: context.project, role: context.role as ProjectRole }
}
