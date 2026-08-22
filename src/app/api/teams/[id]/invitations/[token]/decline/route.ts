import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUserFromRequest } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; token: string }> },
) {
  const authResult = await getCurrentUserFromRequest(request)
  if (!authResult) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, token } = await params

  const invite = await prisma.teamInvite.findUnique({ where: { token } })
  if (!invite || invite.teamId !== id || invite.status !== 'PENDING') {
    return NextResponse.json({ error: 'Invitation is invalid' }, { status: 404 })
  }

  const belongsToUser =
    (invite.email && authResult.email?.toLowerCase() === invite.email.toLowerCase()) ||
    (invite.phone && authResult.phone === invite.phone)

  if (!belongsToUser) {
    return NextResponse.json({ error: 'This invitation belongs to another account' }, { status: 403 })
  }

  await prisma.teamInvite.update({
    where: { id: invite.id },
    data: { status: 'REVOKED' },
  })

  return NextResponse.json({ success: true })
}
