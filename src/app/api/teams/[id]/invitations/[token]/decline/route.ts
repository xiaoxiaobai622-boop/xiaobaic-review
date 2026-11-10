import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { recordTeamAuditEvent } from '@/lib/team-audit'
import { rateLimit } from '@/lib/rate-limit'
import { requireTeamWritable } from '@/lib/team-writeable'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function unavailable(status: string) {
  switch (status) {
    case 'ACCEPTED':
      return { status: 410, code: 'INVITE_ALREADY_ACCEPTED', error: '该邀请已被接受' }
    case 'DECLINED':
      return { status: 410, code: 'INVITE_DECLINED', error: '该邀请已被拒绝' }
    case 'REVOKED':
      return { status: 410, code: 'INVITE_REVOKED', error: '该邀请已被撤销' }
    case 'EXPIRED':
      return { status: 410, code: 'INVITE_EXPIRED', error: '该邀请已过期' }
    default:
      return { status: 409, code: 'INVITE_NOT_PENDING', error: '该邀请当前不可拒绝' }
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; token: string }> },
) {
  // LINK invites may be declined anonymously: declining grants nothing and is
  // the recipient's way out without creating an account. PHONE invites stay
  // bound to the invited account.
  const authResult = await getCurrentUserFromRequest(request)
  const { id, token } = await params

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 30,
    message: '拒绝邀请操作过于频繁，请稍后再试',
  }, 'team-invite-decline')
  if (limited) return limited

  const invite = await prisma.teamInvite.findUnique({ where: { token } })
  if (!invite || invite.teamId !== id) {
    return NextResponse.json({ error: '邀请不存在或已失效', code: 'INVITE_INVALID' }, { status: 404 })
  }

  if (invite.method === 'PHONE') {
    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
    }
    const belongsToUser =
      (invite.email && authResult.email?.toLowerCase() === invite.email.toLowerCase()) ||
      (invite.phone && authResult.phone === invite.phone)
    if (!belongsToUser) {
      return NextResponse.json(
        { error: '该邀请属于另一个账号', code: 'INVITE_OWNER_MISMATCH' },
        { status: 403 },
      )
    }
  }

  const blocked = await requireTeamWritable(invite.teamId)
  if (blocked) return blocked

  if (invite.status !== 'PENDING') {
    const result = unavailable(invite.status)
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status })
  }
  if (invite.expiresAt <= new Date()) {
    await prisma.teamInvite.updateMany({
      where: { id: invite.id, status: 'PENDING' },
      data: { status: 'EXPIRED' },
    })
    return NextResponse.json({ error: '该邀请已过期', code: 'INVITE_EXPIRED' }, { status: 410 })
  }

  // One-time link: the first decline burns the token exactly like an accept.
  const declined = await prisma.teamInvite.updateMany({
    where: { id: invite.id, status: 'PENDING' },
    data: { status: 'DECLINED', declinedAt: new Date() },
  })
  if (declined.count !== 1) {
    return NextResponse.json(
      { error: '该邀请刚刚已被处理，请刷新后重试', code: 'INVITE_ALREADY_USED' },
      { status: 409 },
    )
  }

  await recordTeamAuditEvent(prisma, {
    teamId: invite.teamId,
    actorUserId: authResult?.id ?? null,
    action: 'INVITE_DECLINED',
    metadata: { inviteId: invite.id, method: invite.method },
  })

  return NextResponse.json({ success: true, method: invite.method })
}
