import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { getTeamQuota, getTeamUsage } from '@/lib/platform-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; token: string }> },
) {
  const authResult = await getCurrentUserFromRequest(request)
  if (!authResult) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!authResult.phone) {
    return NextResponse.json({ error: '接受团队邀请前请先绑定手机号', code: 'PHONE_REQUIRED' }, { status: 403 })
  }
  const { id, token } = await params

  const invite = await prisma.teamInvite.findUnique({ where: { token } })
  if (!invite || invite.teamId !== id || invite.status !== 'PENDING') {
    return NextResponse.json({ error: 'Invitation is invalid' }, { status: 404 })
  }
  if (invite.expiresAt < new Date()) {
    await prisma.teamInvite.update({ where: { id: invite.id }, data: { status: 'EXPIRED' } })
    return NextResponse.json({ error: 'Invitation has expired' }, { status: 410 })
  }

  if (invite.email && authResult.email?.toLowerCase() !== invite.email.toLowerCase()) {
    return NextResponse.json({ error: 'This invitation belongs to another email address' }, { status: 403 })
  }
  if (invite.phone && authResult.phone !== invite.phone) {
    return NextResponse.json({ error: 'This invitation belongs to another phone number' }, { status: 403 })
  }

  const existing = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId: invite.teamId, userId: authResult.id } },
  })

  if (!existing) {
    const [quota, usage] = await Promise.all([
      getTeamQuota(invite.teamId),
      getTeamUsage(invite.teamId),
    ])
    if (usage.members >= quota.maxMembers) {
      return NextResponse.json({ error: '当前团队的成员数量已达到配额上限' }, { status: 403 })
    }
  }

  await prisma.$transaction([
    existing
      ? prisma.teamMember.update({
          where: { id: existing.id },
          data: { status: 'ACTIVE', role: invite.role },
        })
      : prisma.teamMember.create({
          data: {
            teamId: invite.teamId,
            userId: authResult.id,
            role: invite.role,
            status: 'ACTIVE',
          },
        }),
    prisma.teamInvite.update({
      where: { id: invite.id },
      data: { status: 'ACCEPTED', acceptedAt: new Date() },
    }),
  ])

  return NextResponse.json({ success: true, teamId: invite.teamId })
}
