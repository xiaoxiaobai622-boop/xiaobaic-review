import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { requireTeamWritable } from '@/lib/team-writeable'
import { resolveAcceptedRole, type TeamRoleName } from '@/lib/team-role'
import { recordTeamAuditEvent } from '@/lib/team-audit'
import { assertSeatAvailable, lockTeamSeats, SeatLimitError } from '@/lib/team-seat'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

class InviteAcceptError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function statusError(status: string): InviteAcceptError {
  switch (status) {
    case 'ACCEPTED':
      return new InviteAcceptError(410, 'INVITE_ALREADY_ACCEPTED', '该邀请已被接受')
    case 'DECLINED':
      return new InviteAcceptError(410, 'INVITE_DECLINED', '该邀请已被拒绝')
    case 'REVOKED':
      return new InviteAcceptError(410, 'INVITE_REVOKED', '该邀请已被撤销')
    case 'EXPIRED':
      return new InviteAcceptError(410, 'INVITE_EXPIRED', '该邀请已过期')
    default:
      return new InviteAcceptError(409, 'INVITE_NOT_PENDING', '该邀请当前不可接受')
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; token: string }> },
) {
  const authResult = await getCurrentUserFromRequest(request)
  if (!authResult) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
  const { id, token } = await params

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 30,
    message: '接受邀请操作过于频繁，请稍后再试',
  }, 'team-invite-accept', `${authResult.id}:${id}`)
  if (limited) return limited

  const invite = await prisma.teamInvite.findUnique({
    where: { token },
    include: { projects: { select: { projectId: true, role: true } } },
  })
  if (!invite || invite.teamId !== id) {
    return NextResponse.json({ error: '邀请不存在或已失效', code: 'INVITE_INVALID' }, { status: 404 })
  }

  const blocked = await requireTeamWritable(invite.teamId)
  if (blocked) return blocked

  // Replaying an accept after it succeeded is not an error: the token is spent,
  // but this account is already a member. Return the same success shape.
  if (invite.status === 'ACCEPTED') {
    const existing = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: invite.teamId, userId: authResult.id } },
    })
    if (existing?.status === 'ACTIVE') {
      return NextResponse.json({
        success: true,
        teamId: invite.teamId,
        role: existing.role,
        method: invite.method,
        alreadyMember: true,
      })
    }
  }

  if (invite.status !== 'PENDING') {
    const error = statusError(invite.status)
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
  }
  if (invite.expiresAt <= new Date()) {
    await prisma.teamInvite.updateMany({
      where: { id: invite.id, status: 'PENDING' },
      data: { status: 'EXPIRED' },
    })
    return NextResponse.json({ error: '该邀请已过期', code: 'INVITE_EXPIRED' }, { status: 410 })
  }

  // PHONE invites are bound to the invited account. LINK invites deliberately
  // skip this: possession of the token is the invitation, with no phone/email.
  if (invite.method === 'PHONE') {
    if (!authResult.phone) {
      return NextResponse.json(
        { error: '接受团队邀请前请先绑定手机号', code: 'PHONE_REQUIRED' },
        { status: 403 },
      )
    }
    if (invite.email && authResult.email?.toLowerCase() !== invite.email.toLowerCase()) {
      return NextResponse.json(
        { error: '该邀请属于另一个邮箱账号', code: 'INVITE_EMAIL_MISMATCH' },
        { status: 403 },
      )
    }
    if (invite.phone && authResult.phone !== invite.phone) {
      return NextResponse.json(
        { error: '该邀请属于另一个手机号', code: 'INVITE_PHONE_MISMATCH' },
        { status: 403 },
      )
    }
  }

  let acceptedRole: TeamRoleName = invite.role
  let alreadyMember = false

  try {
    await prisma.$transaction(async (tx) => {
      // Serialises membership changes for this team; the seat count below stays
      // stable until commit, so two concurrent accepts cannot both pass.
      await lockTeamSeats(tx, invite.teamId)

      const current = await tx.teamInvite.findUnique({
        where: { token },
        include: { projects: { select: { projectId: true, role: true } } },
      })
      if (!current || current.teamId !== id) {
        throw new InviteAcceptError(404, 'INVITE_INVALID', '邀请不存在或已失效')
      }

      const existing = await tx.teamMember.findUnique({
        where: { teamId_userId: { teamId: current.teamId, userId: authResult.id } },
      })

      // Repeating an accept is idempotent: the token is already spent, but this
      // account really is a member. Never consume anything twice.
      if (current.status === 'ACCEPTED' && existing?.status === 'ACTIVE') {
        alreadyMember = true
        acceptedRole = existing.role as TeamRoleName
        return
      }
      if (current.status !== 'PENDING') throw statusError(current.status)
      if (current.expiresAt <= new Date()) {
        throw new InviteAcceptError(410, 'INVITE_EXPIRED', '该邀请已过期')
      }

      // A LINK invite accepted by an active member adds nothing. Leave the
      // token untouched so it can still onboard a different person.
      if (current.method === 'LINK' && existing?.status === 'ACTIVE') {
        alreadyMember = true
        acceptedRole = existing.role as TeamRoleName
        return
      }

      const isActive = existing?.status === 'ACTIVE'
      if (!isActive) await assertSeatAvailable(tx, current.teamId)

      // One-time semantics under concurrency: only the transaction that flips
      // PENDING -> ACCEPTED may write a membership.
      const claimed = await tx.teamInvite.updateMany({
        where: { id: current.id, status: 'PENDING' },
        data: { status: 'ACCEPTED', acceptedAt: new Date() },
      })
      if (claimed.count !== 1) {
        throw new InviteAcceptError(409, 'INVITE_ALREADY_USED', '该邀请刚刚被使用，请刷新后重试')
      }

      // A disabled membership is a clean slate, so it comes back at the invited
      // role. An active one keeps whichever role is higher: accepting a member
      // invite must not silently demote an existing admin or owner.
      acceptedRole = isActive
        ? resolveAcceptedRole(existing?.role as TeamRoleName, current.role as TeamRoleName)
        : current.role

      if (existing) {
        await tx.teamMember.update({
          where: { id: existing.id },
          data: {
            status: 'ACTIVE',
            role: acceptedRole,
            // An already-active member keeps their current scope/role overrides.
            // A disabled membership comes back cleanly on the invite's terms.
            ...(isActive
              ? {}
              : {
                  projectAccessScope: current.projectAccessScope,
                  defaultProjectRole: current.defaultProjectRole,
                }),
          },
        })
      } else {
        await tx.teamMember.create({
          data: {
            teamId: current.teamId,
            userId: authResult.id,
            role: current.role,
            status: 'ACTIVE',
            projectAccessScope: current.projectAccessScope,
            defaultProjectRole: current.defaultProjectRole,
          },
        })
      }

      if (current.projects.length > 0 && current.projectAccessScope === 'ASSIGNED_ONLY') {
        for (const grant of current.projects) {
          const existingGrant = await tx.projectMember.findUnique({
            where: {
              projectId_userId: { projectId: grant.projectId, userId: authResult.id },
            },
            select: { id: true },
          })
          if (!existingGrant) {
            await tx.projectMember.create({
              data: { projectId: grant.projectId, userId: authResult.id, role: grant.role },
            })
          } else if (!isActive) {
            // A disabled member comes back on the invite's terms; an active
            // member keeps any higher role they already had on the project.
            await tx.projectMember.update({
              where: { id: existingGrant.id },
              data: { role: grant.role },
            })
          }
        }
      }
    })
  } catch (error) {
    if (error instanceof SeatLimitError) {
      await recordTeamAuditEvent(prisma, {
        teamId: invite.teamId,
        actorUserId: authResult.id,
        targetUserId: authResult.id,
        action: 'SEAT_LIMIT_HIT',
        metadata: { source: 'INVITE_ACCEPT' },
      })
      return NextResponse.json(
        { error: '成员席位已满，请先停用/移除成员，或升级套餐', code: error.code },
        { status: 403 },
      )
    }
    if (error instanceof InviteAcceptError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    throw error
  }

  if (!alreadyMember) {
    await recordTeamAuditEvent(prisma, {
      teamId: invite.teamId,
      actorUserId: authResult.id,
      targetUserId: authResult.id,
      action: 'INVITE_ACCEPTED',
      metadata: {
        inviteId: invite.id,
        method: invite.method,
        role: acceptedRole,
        projectAccessScope: invite.projectAccessScope,
        projectCount: invite.projects.length,
      },
    })
  }

  return NextResponse.json({
    success: true,
    teamId: invite.teamId,
    role: acceptedRole,
    method: invite.method,
    alreadyMember,
  })
}
