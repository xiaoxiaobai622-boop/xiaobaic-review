import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiUser } from '@/lib/auth'
import { getTeamMember } from '@/lib/team-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireApiUser(request)
  if (authResult instanceof Response) return authResult
  const { id } = await params
  const membership = await getTeamMember(id, authResult.id)
  if (!membership || membership.status !== 'ACTIVE' || !['OWNER', 'ADMIN'].includes(membership.role)) {
    return NextResponse.json({ error: 'Administrator permission required' }, { status: 403 })
  }

  const url = new URL(request.url)
  const action = url.searchParams.get('action')?.trim() || null
  const actorUserId = url.searchParams.get('actorUserId')?.trim() || null
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  const take = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 100)))

  const where: any = { teamId: id }
  if (action) where.action = action
  if (actorUserId) where.actorUserId = actorUserId
  if (from || to) {
    where.createdAt = {}
    if (from) where.createdAt.gte = new Date(from)
    if (to) {
      const end = new Date(to)
      end.setHours(23, 59, 59, 999)
      where.createdAt.lte = end
    }
  }

  const events = await prisma.teamAuditEvent.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take,
  })
  const userIds = [...new Set(events.flatMap((event) => [event.actorUserId, event.targetUserId]).filter(Boolean))] as string[]
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
    : []
  const userMap = new Map(users.map((user) => [user.id, user]))

  return NextResponse.json({
    events: events.map((event) => ({
      id: event.id,
      action: event.action,
      metadata: event.metadata,
      createdAt: event.createdAt,
      actor: event.actorUserId ? userMap.get(event.actorUserId) || { id: event.actorUserId, name: null, email: null } : null,
      target: event.targetUserId ? userMap.get(event.targetUserId) || { id: event.targetUserId, name: null, email: null } : null,
    })),
  })
}
