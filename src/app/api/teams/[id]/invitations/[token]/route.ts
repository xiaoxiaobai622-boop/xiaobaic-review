import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiUser } from '@/lib/auth'
import { getTeamMember } from '@/lib/team-access'
import { recordTeamAuditEvent } from '@/lib/team-audit'
import { rateLimit } from '@/lib/rate-limit'
import { requireTeamWritable } from '@/lib/team-writeable'

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

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 30,
    message: '邀请操作过于频繁，请稍后再试',
  }, 'team-invitations-revoke', `${authResult.id}:${id}`)
  if (limited) return limited

  const blocked = await requireTeamWritable(id)
  if (blocked) return blocked

  const invite = await prisma.teamInvite.findUnique({ where: { id: inviteId } })
  if (!invite || invite.teamId !== id) {
    return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
  }

  if (invite.status !== 'PENDING') {
    return NextResponse.json({ error: 'Only pending invitations can be revoked' }, { status: 409 })
  }

  const revoked = await prisma.teamInvite.updateMany({
    where: { id: invite.id, status: 'PENDING' },
    data: { status: 'REVOKED' },
  })
  if (revoked.count !== 1) {
    return NextResponse.json({ error: 'Only pending invitations can be revoked' }, { status: 409 })
  }

  await recordTeamAuditEvent(prisma, {
    teamId: id,
    actorUserId: authResult.id,
    action: 'INVITE_REVOKED',
    metadata: { inviteId: invite.id, method: invite.method },
  })

  return NextResponse.json({ success: true })
}
