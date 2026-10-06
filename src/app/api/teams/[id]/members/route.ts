import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiUser } from '@/lib/auth'
import { getTeamMember } from '@/lib/team-access'
import { withMaskedPhone } from '@/lib/phone-field'

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

  let members: any[]
  try {
    members = await prisma.teamMember.findMany({
      where: { teamId: id },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        role: true,
        status: true,
        createdAt: true,
        user: {
          select: { id: true, name: true, email: true, phone: true, avatarUrl: true },
        },
        teamNickname: true,
        teamProfession: true,
        department: true,
        bio: true,
      },
    })
  } catch {
    const legacyMembers = await prisma.teamMember.findMany({
      where: { teamId: id },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        role: true,
        status: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true, phone: true, avatarUrl: true } },
      },
    })
    members = legacyMembers.map((member) => ({
      ...member,
      teamNickname: null,
      teamProfession: null,
      department: null,
      bio: null,
    }))
  }

  // 名单里别人的手机号只给掩码，自己的那行仍是明文；需要看全号走带留痕的查看接口。
  members = members.map((member) =>
    member.user?.id === authResult.id ? member : { ...member, user: withMaskedPhone(member.user) })

  const response = NextResponse.json({ members })
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  response.headers.set('Pragma', 'no-cache')
  response.headers.set('Expires', '0')
  return response
}
