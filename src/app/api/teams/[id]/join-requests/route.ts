import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUserFromRequest, requireApiUser } from '@/lib/auth'
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

  const requests = await prisma.teamJoinRequest.findMany({
    where: { teamId: id, status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    include: {
      user: { select: { id: true, name: true, email: true, phone: true } },
    },
  })
  return NextResponse.json({ requests })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await getCurrentUserFromRequest(request)
  if (!authResult) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!authResult.phone) {
    return NextResponse.json({ error: '加入团队前请先绑定手机号', code: 'PHONE_REQUIRED' }, { status: 403 })
  }
  const { id } = await params

  const existingMember = await getTeamMember(id, authResult.id)
  if (existingMember?.status === 'ACTIVE') {
    return NextResponse.json({ error: 'You are already a member of this team' }, { status: 409 })
  }

  const body = await request.json().catch(() => null)
  const message = typeof body?.message === 'string' ? body.message.slice(0, 500) : null

  const existingRequest = await prisma.teamJoinRequest.findFirst({
    where: { teamId: id, userId: authResult.id, status: 'PENDING' },
  })
  if (existingRequest) {
    return NextResponse.json({ request: existingRequest }, { status: 200 })
  }

  const joinRequest = await prisma.teamJoinRequest.create({
    data: {
      teamId: id,
      userId: authResult.id,
      message,
    },
  })

  return NextResponse.json({ request: joinRequest }, { status: 201 })
}
