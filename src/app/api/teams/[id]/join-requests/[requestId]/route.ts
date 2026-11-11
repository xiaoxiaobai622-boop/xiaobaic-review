import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { notifyApplicantOfJoinDecision } from '@/lib/join-request-notifications'
import { requireApiUser } from '@/lib/auth'
import { getTeamMember } from '@/lib/team-access'
import { requireTeamWritable } from '@/lib/team-writeable'
import { recordTeamAuditEvent } from '@/lib/team-audit'
import { assertSeatAvailable, lockTeamSeats, SeatLimitError } from '@/lib/team-seat'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; requestId: string }> },
) {
  const authResult = await requireApiUser(request)
  if (authResult instanceof Response) return authResult
  const { id, requestId } = await params
  const membership = await getTeamMember(id, authResult.id)
  if (!membership || membership.status !== 'ACTIVE' || !['OWNER', 'ADMIN'].includes(membership.role)) {
    return NextResponse.json({ error: 'Administrator permission required' }, { status: 403 })
  }

  const blocked = await requireTeamWritable(id)
  if (blocked) return blocked

  const body = await request.json().catch(() => null)
  const decision = body?.status
  if (!['APPROVED', 'REJECTED'].includes(decision)) {
    return NextResponse.json({ error: 'Invalid decision' }, { status: 400 })
  }

  const joinRequest = await prisma.teamJoinRequest.findUnique({
    where: { id: requestId },
  })
  if (!joinRequest || joinRequest.teamId !== id || joinRequest.status !== 'PENDING') {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  }

  if (decision === 'APPROVED') {
    try {
      await prisma.$transaction(async (tx) => {
        await lockTeamSeats(tx, id)
        const existing = await tx.teamMember.findUnique({
          where: { teamId_userId: { teamId: id, userId: joinRequest.userId } },
        })
        if (!existing || existing.status !== 'ACTIVE') {
          await assertSeatAvailable(tx, id)
        }

        if (existing) {
          // A pending join request must never demote a member who was promoted
          // after applying (or an OWNER). Reactivating a disabled member also
          // keeps their previous role.
          await tx.teamMember.update({
            where: { id: existing.id },
            data: { status: 'ACTIVE', role: existing.role },
          })
        } else {
          await tx.teamMember.create({
            data: {
              teamId: id,
              userId: joinRequest.userId,
              role: 'MEMBER',
              status: 'ACTIVE',
              projectAccessScope: 'ALL_PROJECTS',
              defaultProjectRole: 'REVIEWER',
            },
          })
        }

        await tx.teamJoinRequest.update({
          where: { id: requestId },
          data: { status: 'APPROVED', reviewedById: authResult.id, reviewedAt: new Date() },
        })
      })
    } catch (error) {
      if (error instanceof SeatLimitError) {
        await recordTeamAuditEvent(prisma, {
          teamId: id,
          actorUserId: authResult.id,
          targetUserId: joinRequest.userId,
          action: 'SEAT_LIMIT_HIT',
          metadata: { source: 'JOIN_APPROVAL' },
        })
        return NextResponse.json({ error: '成员席位已满，请先停用/移除成员，或升级套餐', code: error.code }, { status: 403 })
      }
      throw error
    }
  } else {
    await prisma.teamJoinRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED', reviewedById: authResult.id, reviewedAt: new Date() },
    })
  }

  await recordTeamAuditEvent(prisma, {
    teamId: id,
    actorUserId: authResult.id,
    targetUserId: joinRequest.userId,
    action: decision === 'APPROVED' ? 'JOIN_APPROVED' : 'JOIN_REJECTED',
    metadata: { requestId },
  })

  // 决定落库了就得让申请人知道，否则 TA 只能自己反复回来看那张卡。
  // 这里不 await：通知挂了也不能把审批打成失败（辅助函数自己兜异常）。
  const notified = await prisma.team.findUnique({ where: { id }, select: { name: true } })
  void notifyApplicantOfJoinDecision({
    applicantUserId: joinRequest.userId,
    teamName: notified?.name ?? id,
    approved: decision === 'APPROVED',
  })

  return NextResponse.json({ success: true })
}
