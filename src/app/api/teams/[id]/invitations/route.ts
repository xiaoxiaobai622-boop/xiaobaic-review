import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiUser } from '@/lib/auth'
import { getTeamMember } from '@/lib/team-access'
import { randomBytes } from 'crypto'
import { phoneStoreFields, withMaskedPhone } from '@/lib/phone-field'
import { recordTeamAuditEvent } from '@/lib/team-audit'
import { rateLimit } from '@/lib/rate-limit'
import { requireTeamWritable } from '@/lib/team-writeable'
import { assertSeatAvailable, lockTeamSeats, SeatLimitError } from '@/lib/team-seat'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const INVITE_METHODS = new Set(['PHONE', 'LINK'])
const INVITE_PROJECT_ROLES = new Set(['PROJECT_ADMIN', 'EDITOR', 'REVIEWER'])

type InviteProjectGrant = {
  projectId: string
  role: 'PROJECT_ADMIN' | 'EDITOR' | 'REVIEWER'
}

class RegenerateConflictError extends Error {}

function isExpiredPending(invite: { status: string; expiresAt: Date }) {
  return invite.status === 'PENDING' && invite.expiresAt.getTime() <= Date.now()
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireApiUser(request)
  if (authResult instanceof Response) return authResult
  const { id } = await params
  const membership = await getTeamMember(id, authResult.id)
  if (!membership || membership.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 120,
    message: '邀请列表请求过于频繁，请稍后再试',
  }, 'team-invitations-list', authResult.id)
  if (limited) return limited

  const invites = await prisma.teamInvite.findMany({
    where: { teamId: id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      method: true,
      email: true,
      phone: true,
      role: true,
      projectAccessScope: true,
      defaultProjectRole: true,
      status: true,
      expiresAt: true,
      acceptedAt: true,
      declinedAt: true,
      createdAt: true,
      projects: {
        select: {
          projectId: true,
          role: true,
          project: { select: { title: true } },
        },
      },
    },
  })
  // Read paths do not write. A pending row past its deadline is shown as EXPIRED;
  // accept/decline persist that transition when the token is actually used.
  return NextResponse.json({
    invites: invites.map((invite) => withMaskedPhone(
      isExpiredPending(invite) ? { ...invite, status: 'EXPIRED' as const } : invite,
    )),
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireApiUser(request)
  if (authResult instanceof Response) return authResult
  const { id } = await params
  const membership = await getTeamMember(id, authResult.id)
  if (!membership || membership.status !== 'ACTIVE' || !['OWNER', 'ADMIN'].includes(membership.role)) {
    return NextResponse.json({ error: 'Administrator permission required' }, { status: 403 })
  }

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 20,
    message: '创建邀请过于频繁，请稍后再试',
  }, 'team-invitations-create', `${authResult.id}:${id}`)
  if (limited) return limited

  const blocked = await requireTeamWritable(id)
  if (blocked) return blocked

  const body = await request.json().catch(() => null)
  const regenerateFromId = typeof body?.regenerateFrom === 'string' ? body.regenerateFrom : null

  let method: 'PHONE' | 'LINK'
  let email: string | null
  let phone: string | null
  let role: 'ADMIN' | 'MEMBER'
  let projectAccessScope: 'ALL_PROJECTS' | 'ASSIGNED_ONLY'
  let defaultProjectRole: 'REVIEWER' | 'EDITOR'
  let inviteProjects: InviteProjectGrant[] = []

  if (regenerateFromId) {
    // Re-generating must copy the stored contact server-side. The list endpoint
    // only ever returns a masked phone; echoing that back would create an invite
    // nobody can accept.
    const source = await prisma.teamInvite.findFirst({
      where: { id: regenerateFromId, teamId: id },
      select: {
        method: true,
        email: true,
        phone: true,
        role: true,
        projectAccessScope: true,
        defaultProjectRole: true,
        status: true,
        projects: { select: { projectId: true, role: true } },
      },
    })
    if (!source) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
    }
    if (source.status !== 'PENDING') {
      return NextResponse.json(
        { error: '只有待接受的邀请可以重新生成', code: 'INVITE_NOT_PENDING' },
        { status: 409 },
      )
    }
    method = source.method
    email = source.email
    phone = source.phone
    // Legacy rows can only be ADMIN/MEMBER, but never let a regeneration mint an OWNER.
    role = source.role === 'ADMIN' ? 'ADMIN' : 'MEMBER'
    projectAccessScope = source.projectAccessScope
    defaultProjectRole = source.defaultProjectRole === 'EDITOR' ? 'EDITOR' : 'REVIEWER'
    inviteProjects = source.projects.map((project) => ({
      projectId: project.projectId,
      role: project.role,
    }))
  } else {
    const requestedMethod = body?.method
    if (requestedMethod !== undefined && !INVITE_METHODS.has(requestedMethod)) {
      return NextResponse.json({ error: '不支持的邀请方式', code: 'INVITE_METHOD_INVALID' }, { status: 400 })
    }
    method = requestedMethod === 'LINK' ? 'LINK' : 'PHONE'

    if (body?.role === 'OWNER') {
      return NextResponse.json(
        { error: '邀请不能授予负责人角色', code: 'INVITE_ROLE_OWNER' },
        { status: 400 },
      )
    }
    role = body?.role === 'ADMIN' ? 'ADMIN' : 'MEMBER'
    projectAccessScope = body?.projectAccessScope === 'ASSIGNED_ONLY' ? 'ASSIGNED_ONLY' : 'ALL_PROJECTS'
    // New normal members default to EDITOR so the invite matches the target model.
    // ASSIGNED_ONLY collaborators default to REVIEWER until a project row grants more.
    defaultProjectRole = body?.defaultProjectRole === 'REVIEWER'
      ? 'REVIEWER'
      : body?.defaultProjectRole === 'EDITOR'
        ? 'EDITOR'
        : projectAccessScope === 'ASSIGNED_ONLY' ? 'REVIEWER' : 'EDITOR'

    if (body?.projects !== undefined) {
      if (projectAccessScope !== 'ASSIGNED_ONLY') {
        return NextResponse.json(
          { error: '只有“指定项目”的邀请可以携带项目', code: 'INVITE_PROJECTS_REQUIRE_ASSIGNED' },
          { status: 400 },
        )
      }
      if (!Array.isArray(body.projects) || body.projects.length > 100) {
        return NextResponse.json({ error: '项目列表格式无效', code: 'INVITE_PROJECTS_INVALID' }, { status: 400 })
      }
      const seen = new Set<string>()
      const parsedProjects: InviteProjectGrant[] = []
      for (const raw of body.projects) {
        const projectId = typeof raw?.projectId === 'string' ? raw.projectId : ''
        const projectRole = raw?.role
        if (!projectId || !INVITE_PROJECT_ROLES.has(projectRole) || seen.has(projectId)) {
          return NextResponse.json({ error: '项目或角色格式无效', code: 'INVITE_PROJECTS_INVALID' }, { status: 400 })
        }
        seen.add(projectId)
        parsedProjects.push({ projectId, role: projectRole })
      }
      if (parsedProjects.length > 0) {
        const owned = await prisma.project.findMany({
          where: { teamId: id, id: { in: parsedProjects.map((project) => project.projectId) } },
          select: { id: true },
        })
        if (owned.length !== parsedProjects.length) {
          return NextResponse.json({ error: '包含不属于本团队的项目', code: 'INVITE_PROJECT_NOT_IN_TEAM' }, { status: 400 })
        }
      }
      inviteProjects = parsedProjects
    }

    if (method === 'LINK') {
      // Possession of the token is the whole authorization; no contact is stored.
      email = null
      phone = null
    } else {
      email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : null
      phone = typeof body?.phone === 'string' ? body.phone.trim() : null
      if (!email && !phone) {
        return NextResponse.json({ error: 'Email or phone is required' }, { status: 400 })
      }
    }
  }

  let invite
  try {
    invite = await prisma.$transaction(async (tx) => {
      await lockTeamSeats(tx, id)
      await assertSeatAvailable(tx, id)

      if (regenerateFromId) {
        const revoked = await tx.teamInvite.updateMany({
          where: { id: regenerateFromId, teamId: id, status: 'PENDING' },
          data: { status: 'REVOKED' },
        })
        if (revoked.count !== 1) throw new RegenerateConflictError()
      }

      const created = await tx.teamInvite.create({
        data: {
          teamId: id,
          method,
          email,
          ...phoneStoreFields(phone),
          role,
          projectAccessScope,
          defaultProjectRole,
          createdById: authResult.id,
          token: randomBytes(24).toString('base64url'),
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          ...(inviteProjects.length > 0
            ? { projects: { create: inviteProjects } }
            : {}),
        },
      })

      await recordTeamAuditEvent(tx, {
        teamId: id,
        actorUserId: authResult.id,
        action: 'INVITE_CREATED',
        metadata: {
          inviteId: created.id,
          method,
          role,
          projectAccessScope,
          defaultProjectRole,
          projectCount: inviteProjects.length,
          ...(regenerateFromId ? { regeneratedFrom: regenerateFromId } : {}),
        },
      })
      if (regenerateFromId) {
        await recordTeamAuditEvent(tx, {
          teamId: id,
          actorUserId: authResult.id,
          action: 'INVITE_REVOKED',
          metadata: { inviteId: regenerateFromId, method, reason: 'REGENERATED' },
        })
      }
      return created
    })
  } catch (error) {
    if (error instanceof SeatLimitError) {
      await recordTeamAuditEvent(prisma, {
        teamId: id,
        actorUserId: authResult.id,
        action: 'SEAT_LIMIT_HIT',
        metadata: { source: 'INVITE_CREATED' },
      })
      return NextResponse.json(
        { error: '成员席位已满，请先停用/移除成员，或升级套餐', code: error.code },
        { status: 403 },
      )
    }
    if (error instanceof RegenerateConflictError) {
      return NextResponse.json(
        { error: '该邀请已不是待接受状态，无法重新生成', code: 'INVITE_NOT_PENDING' },
        { status: 409 },
      )
    }
    throw error
  }

  return NextResponse.json({ invite: { ...withMaskedPhone(invite), projects: inviteProjects } }, { status: 201 })
}
