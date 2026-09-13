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
  if (!actor || actor.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const target = await getTeamMember(id, userId)
  if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  const profileFields = ['teamNickname', 'teamProfession', 'department', 'bio'] as const
  const hasProfileFields = profileFields.some((field) => Object.prototype.hasOwnProperty.call(body || {}, field))
  if (hasProfileFields) {
    const canEditProfile = actor.userId === userId || actor.role === 'OWNER' || actor.role === 'ADMIN'
    if (!canEditProfile) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    const profileData: Record<string, string | null> = {}
    for (const field of profileFields) {
      if (!Object.prototype.hasOwnProperty.call(body || {}, field)) continue
      const value = body?.[field]
      if (value !== null && typeof value !== 'string') return NextResponse.json({ error: '个人信息格式无效' }, { status: 400 })
      const normalized = typeof value === 'string' ? value.trim() : null
      const limit = field === 'bio' ? 240 : 80
      if (normalized && normalized.length > limit) return NextResponse.json({ error: `${field} 长度超出限制` }, { status: 400 })
      profileData[field] = normalized || null
    }
    const updated = await prisma.teamMember.update({ where: { id: target.id }, data: profileData })
    return NextResponse.json({ member: updated })
  }

  if (actor.role !== 'OWNER') {
    return NextResponse.json({ error: 'Only the team owner can change member roles' }, { status: 403 })
  }
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
