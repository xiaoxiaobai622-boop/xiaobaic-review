import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiUser } from '@/lib/auth'
import { getTeamMember } from '@/lib/team-access'
import { recordTeamAuditEvent } from '@/lib/team-audit'
import { canDisableMember } from '@/lib/project-policy'
import { assertSeatAvailable, lockTeamSeats, SeatLimitError } from '@/lib/team-seat'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const authResult = await requireApiUser(request)
  if (authResult instanceof Response) return authResult
  const { id, userId } = await params
  const actor = await getTeamMember(id, authResult.id)
  if (!actor || actor.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const target = await getTeamMember(id, userId)
  if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  const profileFields = ['teamNickname', 'teamProfession', 'department', 'bio'] as const
  const hasProfileFields = profileFields.some((field) => Object.prototype.hasOwnProperty.call(body || {}, field))
  if (hasProfileFields) {
    const canEditProfile = actor.userId === userId || actor.role === 'OWNER' || actor.role === 'ADMIN'
    if (!canEditProfile) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    const profileData: Record<string, string | null> = {}
    for (const field of profileFields) {
      if (!Object.prototype.hasOwnProperty.call(body || {}, field)) continue
      const value = body?.[field]
      if (value !== null && typeof value !== 'string') return NextResponse.json({ error: '个人信息格式无效' }, { status: 400 })
      const normalized = typeof value === 'string' ? value.trim() : null
      const limit = field === 'bio' ? 240 : 80
      if (normalized && normalized.length > limit) return NextResponse.json({ error: `${field} 长度超出限制` }, { status: 400 })
      profileData[field] = normalized || null
    }
    const updated = await prisma.teamMember.update({ where: { id: target.id }, data: profileData })
    return NextResponse.json({ member: updated })
  }

  if (body?.status !== undefined) {
    const status = body.status
    if (!['ACTIVE', 'DISABLED'].includes(status)) {
      return NextResponse.json({ error: 'Invalid member status' }, { status: 400 })
    }
    if (!canDisableMember(actor.role, target.role)) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    }
    if (status !== target.status) {
      try {
        await prisma.$transaction(async (tx) => {
          await lockTeamSeats(tx, id)
          if (status === 'ACTIVE') await assertSeatAvailable(tx, id)
          await tx.teamMember.update({ where: { id: target.id }, data: { status } })
          await recordTeamAuditEvent(tx, {
            teamId: id,
            actorUserId: authResult.id,
            targetUserId: userId,
            action: status === 'DISABLED' ? 'MEMBER_DISABLED' : 'MEMBER_ENABLED',
            metadata: { role: target.role },
          })
        })
      } catch (error) {
        if (error instanceof SeatLimitError) {
          return NextResponse.json({ error: '当前团队的成员数量已达到配额上限', code: error.code }, { status: 403 })
        }
        throw error
      }
    }
    return NextResponse.json({ success: true, status })
  }

  const accessFields = ['projectAccessScope', 'defaultProjectRole'] as const
  const hasAccessFields = accessFields.some((field) => Object.prototype.hasOwnProperty.call(body || {}, field))
  if (hasAccessFields) {
    if (!['OWNER', 'ADMIN'].includes(actor.role)) {
      return NextResponse.json({ error: 'Administrator permission required' }, { status: 403 })
    }
    if (target.role !== 'MEMBER') {
      return NextResponse.json({ error: 'Project access settings only apply to regular members' }, { status: 400 })
    }

    const data: { projectAccessScope?: 'ALL_PROJECTS' | 'ASSIGNED_ONLY'; defaultProjectRole?: 'EDITOR' | 'REVIEWER' } = {}
    if (body?.projectAccessScope !== undefined) {
      if (!['ALL_PROJECTS', 'ASSIGNED_ONLY'].includes(body.projectAccessScope)) {
        return NextResponse.json({ error: 'Invalid project access scope' }, { status: 400 })
      }
      data.projectAccessScope = body.projectAccessScope
    }
    if (body?.defaultProjectRole !== undefined) {
      if (!['EDITOR', 'REVIEWER'].includes(body.defaultProjectRole)) {
        return NextResponse.json({ error: 'Invalid default project role' }, { status: 400 })
      }
      data.defaultProjectRole = body.defaultProjectRole
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No access setting provided' }, { status: 400 })
    }

    const updated = await prisma.teamMember.update({ where: { id: target.id }, data })
    await recordTeamAuditEvent(prisma, {
      teamId: id,
      actorUserId: authResult.id,
      targetUserId: userId,
      action: 'MEMBER_ACCESS_CHANGED',
      metadata: {
        before: {
          projectAccessScope: target.projectAccessScope,
          defaultProjectRole: target.defaultProjectRole,
        },
        after: data,
      },
    })
    return NextResponse.json({ member: updated })
  }

  if (actor.role !== 'OWNER') {
    return NextResponse.json({ error: 'Only the team owner can change member roles' }, { status: 403 })
  }
  const role = body?.role
  if (!['MEMBER', 'ADMIN'].includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }
  if (target.role === 'OWNER' && role !== 'OWNER') {
    return NextResponse.json({ error: 'The owner role cannot be changed' }, { status: 403 })
  }

  const updated = await prisma.teamMember.update({
    where: { id: target.id },
    data: { role },
  })
  await recordTeamAuditEvent(prisma, {
    teamId: id,
    actorUserId: authResult.id,
    targetUserId: userId,
    action: 'ROLE_CHANGED',
    metadata: { before: target.role, after: role },
  })
  return NextResponse.json({ member: updated })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const authResult = await requireApiUser(request)
  if (authResult instanceof Response) return authResult
  const { id, userId } = await params
  const actor = await getTeamMember(id, authResult.id)
  if (!actor || actor.status !== 'ACTIVE' || !['OWNER', 'ADMIN'].includes(actor.role)) {
    return NextResponse.json({ error: 'Administrator permission required' }, { status: 403 })
  }

  const target = await getTeamMember(id, userId)
  if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  if (target.role === 'OWNER') {
    return NextResponse.json({ error: 'The owner cannot be removed' }, { status: 403 })
  }
  if (actor.role !== 'OWNER' && target.role === 'ADMIN') {
    return NextResponse.json({ error: 'Only the owner can remove an admin' }, { status: 403 })
  }

  const projects = await prisma.project.findMany({ where: { teamId: id }, select: { id: true } })
  await prisma.$transaction(async (tx) => {
    await tx.projectMember.deleteMany({
      where: { userId, projectId: { in: projects.map((project) => project.id) } },
    })
    await tx.teamMember.delete({ where: { id: target.id } })
    await recordTeamAuditEvent(tx, {
      teamId: id,
      actorUserId: authResult.id,
      targetUserId: userId,
      action: 'MEMBER_REMOVED',
      metadata: { role: target.role, projectCount: projects.length },
    })
  })
  return NextResponse.json({ success: true })
}
