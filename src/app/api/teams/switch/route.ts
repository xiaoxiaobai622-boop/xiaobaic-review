import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { getTeamMember } from '@/lib/team-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const authResult = await getCurrentUserFromRequest(request)
  if (!authResult) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const teamId = typeof body?.teamId === 'string' ? body.teamId.trim() : ''
  if (!teamId) {
    return NextResponse.json({ error: 'teamId is required' }, { status: 400 })
  }

  const membership = await getTeamMember(teamId, authResult.id)
  if (!membership || membership.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true, name: true, slug: true, avatarUrl: true, status: true },
  })

  return NextResponse.json({ team, role: membership.role })
}
