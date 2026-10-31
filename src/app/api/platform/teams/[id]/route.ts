import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePlatformAuth } from '@/lib/auth'
import { logPlatformAudit } from '@/lib/platform-audit'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePlatformAuth(request)
  if (user instanceof Response) return user
  const { id } = await params

  const body = await request.json().catch(() => null)
  const status = typeof body?.status === 'string' ? body.status : ''
  if (!['ACTIVE', 'DISABLED'].includes(status)) {
    return NextResponse.json({ error: 'Invalid team status' }, { status: 400 })
  }

  const before = await prisma.team.findUnique({ where: { id }, select: { status: true } })
  const team = await prisma.team.update({
    where: { id },
    data: { status },
    select: { id: true, name: true, status: true },
  })

  await logPlatformAudit({
    request,
    actorId: user.id,
    action: 'TEAM_STATUS_CHANGE',
    teamId: id,
    targetType: 'Team',
    targetId: id,
    details: { from: before?.status ?? null, to: status },
  }).catch(error => logError('[PLATFORM] Failed to audit team status change:', error))

  return NextResponse.json({ team })
}
