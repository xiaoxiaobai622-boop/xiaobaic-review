import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiUser } from '@/lib/auth'
import { getTeamMember } from '@/lib/team-access'
import { recordTeamAuditEvent } from '@/lib/team-audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireApiUser(request)
  if (authResult instanceof Response) return authResult
  const { id } = await params

  const membership = await getTeamMember(id, authResult.id)
  if (!membership || membership.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'You are not a member of this team' }, { status: 404 })
  }

  if (membership.role === 'OWNER') {
    return NextResponse.json(
      {
        error: '创建人不能直接退出团队，请先转让团队或删除团队',
        code: 'OWNER_REQUIRES_TRANSFER_OR_DELETE',
      },
      { status: 409 },
    )
  }

  const projects = await prisma.project.findMany({ where: { teamId: id }, select: { id: true } })
  await prisma.$transaction(async (tx) => {
    await tx.projectMember.deleteMany({
      where: { userId: authResult.id, projectId: { in: projects.map((project) => project.id) } },
    })
    await tx.teamMember.delete({ where: { id: membership.id } })
    await recordTeamAuditEvent(tx, {
      teamId: id,
      actorUserId: authResult.id,
      targetUserId: authResult.id,
      action: 'MEMBER_LEFT',
      metadata: { role: membership.role, projectCount: projects.length },
    })
  })

  const nextMembership = await prisma.teamMember.findFirst({
    where: { userId: authResult.id, status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: { teamId: true },
  })

  return NextResponse.json({
    success: true,
    nextTeamId: nextMembership?.teamId || null,
  })
}
