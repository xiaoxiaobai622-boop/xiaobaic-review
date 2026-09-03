import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiUser } from '@/lib/auth'
import { getTeamMember } from '@/lib/team-access'
import { getTeamQuota, getTeamUsage } from '@/lib/platform-access'

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
    const existing = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: id, userId: joinRequest.userId } },
    })
    if (!existing) {
      const [quota, usage] = await Promise.all([
        getTeamQuota(id),
        getTeamUsage(id),
      ])
      if (quota.maxMembers > 0 && usage.members >= quota.maxMembers) {
        return NextResponse.json({ error: '当前团队的成员数量已达到配额上限' }, { status: 403 })
      }
    }
    await prisma.$transaction([
      existing
        ? prisma.teamMember.update({
            where: { id: existing.id },
            data: { status: 'ACTIVE', role: 'MEMBER' },
          })
        : prisma.teamMember.create({
            data: {
              teamId: id,
              userId: joinRequest.userId,
              role: 'MEMBER',
              status: 'ACTIVE',
            },
          }),
      prisma.teamJoinRequest.update({
        where: { id: requestId },
        data: { status: 'APPROVED', reviewedById: authResult.id, reviewedAt: new Date() },
      }),
    ])
  } else {
    await prisma.teamJoinRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED', reviewedById: authResult.id, reviewedAt: new Date() },
    })
  }

  return NextResponse.json({ success: true })
}
