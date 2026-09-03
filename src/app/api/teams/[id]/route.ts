import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUserFromRequest, requireApiUser } from '@/lib/auth'
import { getTeamMember } from '@/lib/team-access'
import {
  checkWechatText,
  CONTENT_SECURITY_ERROR,
  CONTENT_VIOLATION_MESSAGE,
} from '@/lib/wechat-content-security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await getCurrentUserFromRequest(request)
  if (!authResult) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const membership = await getTeamMember(id, authResult.id)
  if (!membership || membership.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const team = await prisma.team.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      avatarUrl: true,
      status: true,
      createdAt: true,
      createdById: true,
      subscriptionPlan: true,
      subscriptionStartedAt: true,
      subscriptionExpiresAt: true,
      members: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          role: true,
          status: true,
            createdAt: true,
            updatedAt: true,
            user: {
            select: { id: true, name: true, email: true, phone: true, updatedAt: true },
          },
        },
      },
      _count: { select: { projects: true, members: true } },
    },
  })

  if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 })
  return NextResponse.json({ team, currentRole: membership.role })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireApiUser(request)
  if (authResult instanceof Response) return authResult
  const { id } = await params

  const membership = await getTeamMember(id, authResult.id)
  if (!membership || membership.status !== 'ACTIVE' || membership.role !== 'OWNER') {
    return NextResponse.json({ error: 'Owner permission required' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const data: Record<string, string> = {}
  if (typeof body?.name === 'string') {
    const name = body.name.trim()
    if (!name || name.length > 80) return NextResponse.json({ error: 'Invalid team name' }, { status: 400 })
    const securityCheck = await checkWechatText(name, { userId: authResult.id, scene: 1 })
    if (!securityCheck.passed) {
      return NextResponse.json(
        { error: securityCheck.error },
        { status: securityCheck.error === CONTENT_VIOLATION_MESSAGE ? 400 : 503 },
      )
    }
    data.name = name
  }
  if (typeof body?.avatarUrl === 'string') data.avatarUrl = body.avatarUrl
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const team = await prisma.team.update({ where: { id }, data })
  return NextResponse.json({ team })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireApiUser(request)
  if (authResult instanceof Response) return authResult
  const { id } = await params

  const membership = await getTeamMember(id, authResult.id)
  if (!membership || membership.status !== 'ACTIVE' || membership.role !== 'OWNER') {
    return NextResponse.json({ error: 'Owner permission required' }, { status: 403 })
  }

  const [projectCount, activeMemberCount] = await Promise.all([
    prisma.project.count({ where: { teamId: id } }),
    prisma.teamMember.count({ where: { teamId: id, status: 'ACTIVE' } }),
  ])

  if (projectCount > 0) {
    return NextResponse.json(
      { error: '团队中还有项目，请先删除或转移项目后再删除团队' },
      { status: 409 },
    )
  }

  if (activeMemberCount > 1) {
    return NextResponse.json(
      { error: '团队中还有其他成员，请先移除成员或转让团队' },
      { status: 409 },
    )
  }

  await prisma.team.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
