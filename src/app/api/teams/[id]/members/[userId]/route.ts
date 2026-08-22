import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiUser } from '@/lib/auth'
import { getTeamMember } from '@/lib/team-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const authResult = await requireApiUser(request)
  if (authResult instanceof Response) return authResult
  const { id, userId } = await params
  const actor = await getTeamMember(id, authResult.id)
  if (!actor || actor.status !== 'ACTIVE' || actor.role !== 'OWNER') {
    return NextResponse.json({ error: 'Only the team owner can change member roles' }, { status: 403 })
  }

  const target = await getTeamMember(id, userId)
  if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  const role = body?.role
  if (!['MEMBER', 'ADMIN'].includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }
  if (target.role === 'OWNER' && role !== 'OWNER') {
    return NextResponse.json({ error: 'The owner role cannot be changed' }, { status: 403 })
  }

  const updated = await prisma.teamMember.update({
    where: { id: target.id },
    data: { role },
  })
  return NextResponse.json({ member: updated })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const authResult = await requireApiUser(request)
  if (authResult instanceof Response) return authResult
  const { id, userId } = await params
  const actor = await getTeamMember(id, authResult.id)
  if (!actor || actor.status !== 'ACTIVE' || !['OWNER', 'ADMIN'].includes(actor.role)) {
    return NextResponse.json({ error: 'Administrator permission required' }, { status: 403 })
  }

  const target = await getTeamMember(id, userId)
  if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  if (target.role === 'OWNER') {
    return NextResponse.json({ error: 'The owner cannot be removed' }, { status: 403 })
  }
  if (actor.role !== 'OWNER' && target.role === 'ADMIN') {
    return NextResponse.json({ error: 'Only the owner can remove an admin' }, { status: 403 })
  }

  await prisma.teamMember.delete({ where: { id: target.id } })
  return NextResponse.json({ success: true })
}
