import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { maskPhone } from '@/lib/phone-field'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 60,
    message: '邀请查询过于频繁，请稍后再试',
  }, 'team-invite-view')
  if (limited) return limited

  const invite = await prisma.teamInvite.findUnique({
    where: { token },
    select: {
      teamId: true,
      method: true,
      phone: true,
      role: true,
      projectAccessScope: true,
      defaultProjectRole: true,
      status: true,
      expiresAt: true,
      acceptedAt: true,
      declinedAt: true,
      team: {
        select: {
          id: true,
          name: true,
          slug: true,
          avatarUrl: true,
          status: true,
          _count: { select: { members: true, projects: true } },
        },
      },
    },
  })

  if (!invite) {
    return NextResponse.json({ error: '邀请不存在', code: 'INVITE_INVALID' }, { status: 404 })
  }

  const viewerUser = await getCurrentUserFromRequest(request)
  const viewerMembership = viewerUser
    ? await prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId: invite.teamId, userId: viewerUser.id } },
        select: { status: true, role: true },
      })
    : null

  const status = invite.status === 'PENDING' && invite.expiresAt <= new Date()
    ? 'EXPIRED'
    : invite.status

  const response = NextResponse.json({
    invite: {
      teamId: invite.teamId,
      method: invite.method,
      phone: invite.method === 'PHONE' ? maskPhone(invite.phone) : null,
      role: invite.role,
      projectAccessScope: invite.projectAccessScope,
      defaultProjectRole: invite.defaultProjectRole,
      status,
      expiresAt: invite.expiresAt,
      acceptedAt: invite.acceptedAt,
      declinedAt: invite.declinedAt,
      team: invite.team,
      viewer: {
        authenticated: Boolean(viewerUser),
        isMember: viewerMembership?.status === 'ACTIVE',
        memberRole: viewerMembership?.status === 'ACTIVE' ? viewerMembership.role : null,
        hasPhone: Boolean(viewerUser?.phone),
      },
    },
  })
  // The payload varies per viewer (membership/phone) and the token is a secret.
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  return response
}
