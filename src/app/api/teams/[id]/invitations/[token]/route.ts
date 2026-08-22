import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiUser } from '@/lib/auth'
import { getTeamMember } from '@/lib/team-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; token: string }> },
) {
  const authResult = await requireApiUser(request)
  if (authResult instanceof Response) return authResult
  const { id, token: inviteId } = await params

  const membership = await getTeamMember(id, authResult.id)
  if (
    !membership ||
    membership.status !== 'ACTIVE' ||
    !['OWNER', 'ADMIN'].includes(membership.role)
  ) {
    return NextResponse.json({ error: 'Administrator permission required' }, { status: 403 })
  }

  const invite = await prisma.teamInvite.findUnique({ where: { id: inviteId } })
  if (!invite || invite.teamId !== id) {
    return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
  }

  if (invite.status !== 'PENDING') {
    return NextResponse.json({ error: 'Only pending invitations can be revoked' }, { status: 409 })
  }

  await prisma.teamInvite.update({
    where: { id: invite.id },
    data: { status: 'REVOKED' },
  })

  return NextResponse.json({ success: true })
}
