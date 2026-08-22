import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiUser } from '@/lib/auth'
import { getTeamMember } from '@/lib/team-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireApiUser(request)
  if (authResult instanceof Response) return authResult
  const { id } = await params

  const actor = await getTeamMember(id, authResult.id)
  if (!actor || actor.status !== 'ACTIVE' || actor.role !== 'OWNER') {
    return NextResponse.json({ error: 'Owner permission required' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const targetUserId = typeof body?.targetUserId === 'string' ? body.targetUserId.trim() : ''
  if (!targetUserId || targetUserId === authResult.id) {
    return NextResponse.json({ error: '请选择要转让的团队成员' }, { status: 400 })
  }

  const target = await getTeamMember(id, targetUserId)
  if (!target || target.status !== 'ACTIVE') {
    return NextResponse.json({ error: '目标成员不存在' }, { status: 404 })
  }

  await prisma.$transaction([
    prisma.teamMember.update({
      where: { id: target.id },
      data: { role: 'OWNER' },
    }),
    prisma.teamMember.update({
      where: { id: actor.id },
      data: { role: 'ADMIN' },
    }),
    prisma.team.update({
      where: { id },
      data: { createdById: targetUserId },
    }),
  ])

  return NextResponse.json({ success: true, newOwnerId: targetUserId })
}
