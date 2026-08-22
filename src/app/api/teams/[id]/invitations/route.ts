import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiUser } from '@/lib/auth'
import { getTeamMember } from '@/lib/team-access'
import { randomBytes } from 'crypto'

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
  if (!membership || membership.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const invites = await prisma.teamInvite.findMany({
    where: { teamId: id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      email: true,
      phone: true,
      role: true,
      status: true,
      expiresAt: true,
      createdAt: true,
      acceptedAt: true,
    },
  })
  return NextResponse.json({ invites })
}

export async function POST(
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

  const body = await request.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : null
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : null
  if (!email && !phone) {
    return NextResponse.json({ error: 'Email or phone is required' }, { status: 400 })
  }
  const role = body?.role === 'ADMIN' ? 'ADMIN' : 'MEMBER'

  const invite = await prisma.teamInvite.create({
    data: {
      teamId: id,
      email,
      phone,
      role,
      createdById: authResult.id,
      token: randomBytes(24).toString('base64url'),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  })

  return NextResponse.json({ invite }, { status: 201 })
}
