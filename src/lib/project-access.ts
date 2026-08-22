import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest, getShareContext } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getClientIpAddress } from '@/lib/utils'
import type { AuthUser } from '@/lib/auth'
import type { Prisma, PrismaClient } from '@prisma/client'

type DbClient = PrismaClient | Prisma.TransactionClient

export function projectAccessWhere(user: AuthUser, teamId?: string | null): Prisma.ProjectWhereInput {
  const scopedTeamId = teamId || user.authorizedTeamId
  return {
    team: {
      members: {
        some: {
          userId: user.id,
          status: 'ACTIVE',
        },
      },
    },
    ...(scopedTeamId ? { teamId: scopedTeamId } : {}),
    ...(user.teamRole === 'MEMBER' && user.projectAccessScope === 'ASSIGNED_ONLY'
      ? { members: { some: { userId: user.id } } }
      : {}),
  }
}

export async function canAccessProject(db: DbClient, user: AuthUser, projectId: string) {
  // The request user may not carry the selected team's role (for example on
  // direct video-token requests). Resolve access from the membership stored on
  // the project's own team so a member cannot bypass project assignments.
  const assignmentAccess: Prisma.ProjectWhereInput = user.projectAccessScope === 'ASSIGNED_ONLY'
    ? {
        OR: [
          {
            team: {
              members: {
                some: {
                  userId: user.id,
                  status: 'ACTIVE',
                  role: { in: ['OWNER', 'ADMIN'] },
                },
              },
            },
          },
          { members: { some: { userId: user.id } } },
        ],
      }
    : {}

  const project = await db.project.findFirst({
    where: {
      id: projectId,
      ...(user.authorizedTeamId ? { teamId: user.authorizedTeamId } : {}),
      team: {
        members: {
          some: {
            userId: user.id,
            status: 'ACTIVE',
          },
        },
      },
      ...assignmentAccess,
    },
    select: { id: true },
  })
  return Boolean(project)
}

export async function canAdministerProject(db: DbClient, user: AuthUser, projectId: string) {
  const project = await db.project.findFirst({
    where: {
      id: projectId,
      ...(user.authorizedTeamId ? { teamId: user.authorizedTeamId } : {}),
      team: {
        status: 'ACTIVE',
        members: {
          some: {
            userId: user.id,
            status: 'ACTIVE',
            role: { in: ['OWNER', 'ADMIN'] },
          },
        },
      },
    },
    select: { id: true },
  })
  return Boolean(project)
}

export async function canManageProjectApproval(db: DbClient, user: AuthUser, projectId: string) {
  const project = await db.project.findFirst({
    where: {
      id: projectId,
      ...(user.authorizedTeamId ? { teamId: user.authorizedTeamId } : {}),
      team: {
        status: 'ACTIVE',
        members: {
          some: {
            userId: user.id,
            status: 'ACTIVE',
          },
        },
      },
      OR: [
        { createdById: user.id },
        {
          team: {
            members: {
              some: {
                userId: user.id,
                status: 'ACTIVE',
                role: { in: ['OWNER', 'ADMIN'] },
              },
            },
          },
        },
      ],
    },
    select: { id: true },
  })

  return Boolean(project)
}

export async function nextProjectCode(db: DbClient, teamId: string) {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(86230401)`
  const existing = await db.project.findMany({
    where: { teamId },
    select: { projectCode: true },
  })
  const used = new Set(existing.map((item) => Number(item.projectCode)))
  for (let value = 1; value <= 999; value += 1) {
    if (!used.has(value)) return String(value).padStart(3, '0')
  }
  throw new Error('PROJECT_CODE_LIMIT_REACHED')
}

/**
 * Verify project access using dual authentication pattern
 *
 * Two authentication paths:
 * 1. Admin Path: JWT authentication (bypasses password protection)
 * 2. Share Path: bearer share token scoped to project
 *
 * This replaces duplicate auth logic in 6+ API routes.
 *
 * @param request - Next.js request object
 * @param projectId - Project ID to verify access for
 * @param sharePassword - Project's share password (null if not password-protected)
 * @returns Object with authorization status and user type
 */
export async function verifyProjectAccess(
  request: NextRequest,
  projectId: string,
  _sharePassword: string | null,
  authMode: string = 'PASSWORD',
  options?: {
    requiredPermission?: string
    requiredAnyPermission?: string[]
    allowGuest?: boolean
  }
): Promise<{
  authorized: boolean
  isAdmin: boolean
  isAuthenticated: boolean
  isGuest?: boolean
  permissions?: string[]
  shareTokenSessionId?: string
  errorResponse?: NextResponse
}> {
  const allowGuest = options?.allowGuest ?? true
  const requiredPermission = options?.requiredPermission
  const requiredAnyPermission = options?.requiredAnyPermission

  // Check if user is admin (admins bypass password protection)
  const currentUser = await getCurrentUserFromRequest(request)
  const isAdmin = Boolean(currentUser)
  const shareContext = await getShareContext(request)

  const hasTeamAccess = currentUser
    ? await canAccessProject(prisma, currentUser, projectId)
    : false

  if (currentUser && hasTeamAccess) {
    return {
      authorized: true,
      isAdmin: true,
      isAuthenticated: true,
      permissions: ['view', 'comment', 'download', 'approve'],
      shareTokenSessionId: currentUser.sessionId
        ? `admin:${currentUser.sessionId}`
        : `member:${currentUser.id}`,
    }
  }

  const isUnauthenticated = authMode === 'NONE'
  if (isUnauthenticated && !shareContext) {
    const sessionId = `none:${projectId}:${getClientIpAddress(request)}`
    return {
      authorized: true,
      isAdmin: false,
      isAuthenticated: true,
      isGuest: false,
      permissions: ['view', 'comment', 'download', 'approve'],
      shareTokenSessionId: sessionId,
    }
  }

  if (!shareContext) {
    return {
      authorized: false,
      isAdmin: false,
      isAuthenticated: false,
      errorResponse: NextResponse.json(
        { error: 'Authentication required', authMode },
        { status: 401 }
      )
    }
  }

  if (shareContext.projectId !== projectId) {
    return {
      authorized: false,
      isAdmin: false,
      isAuthenticated: false,
      errorResponse: NextResponse.json(
        { error: 'Access denied' },
        { status: 401 }
      )
    }
  }

  const isGuest = !!shareContext.guest
  const permissions = Array.isArray(shareContext.permissions) ? shareContext.permissions : []

  if (!allowGuest && isGuest) {
    return {
      authorized: false,
      isAdmin: false,
      isAuthenticated: true,
      isGuest: true,
      permissions,
      errorResponse: NextResponse.json(
        { error: 'Guest access is restricted for this action' },
        { status: 403 }
      )
    }
  }

  if (requiredPermission && !permissions.includes(requiredPermission)) {
    return {
      authorized: false,
      isAdmin: false,
      isAuthenticated: true,
      isGuest,
      permissions,
      errorResponse: NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      )
    }
  }

  if (
    requiredAnyPermission &&
    requiredAnyPermission.length > 0 &&
    !requiredAnyPermission.some(permission => permissions.includes(permission))
  ) {
    return {
      authorized: false,
      isAdmin: false,
      isAuthenticated: true,
      isGuest,
      permissions,
      errorResponse: NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      )
    }
  }

  return {
    authorized: true,
    isAdmin: false,
    isAuthenticated: true,
    isGuest,
    permissions,
    shareTokenSessionId: shareContext.sessionId,
  }
}

export async function fetchProjectWithVideos(
  token: string,
  isGuest: boolean,
  guestLatestOnly: boolean,
  projectId: string
) {
  if (isGuest && guestLatestOnly) {
    const allVideos = await prisma.video.findMany({
      where: {
        projectId,
        status: 'READY',
      },
      orderBy: { version: 'desc' },
    })

    const latestVideoIds: string[] = []
    const seenNames = new Set<string>()
    for (const video of allVideos) {
      if (!seenNames.has(video.name)) {
        latestVideoIds.push(video.id)
        seenNames.add(video.name)
      }
    }

    return prisma.project.findUnique({
      where: { slug: token },
      include: {
        videos: {
          where: {
            id: { in: latestVideoIds },
            status: 'READY',
          },
          orderBy: { version: 'desc' },
          include: {
            _count: { select: { assets: { where: { uploadCompletedAt: { not: null } } } } },
          },
        },
      },
    })
  }

  return prisma.project.findUnique({
    where: { slug: token },
    include: {
      videos: {
        where: { status: 'READY' as const },
        orderBy: { version: 'desc' },
        include: {
          _count: { select: { assets: { where: { uploadCompletedAt: { not: null } } } } },
        },
      },
    },
  })
}
