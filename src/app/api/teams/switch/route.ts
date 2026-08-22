import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiUser } from '@/lib/auth'
import { getTeamMember } from '@/lib/team-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const authResult = await requireApiUser(request)
  if (authResult instanceof Response) return authResult

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
    select: { id: true, name: true, slug: true, avatarUrl: true },
  })

  return NextResponse.json({ team, role: membership.role })
}
