import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params

  const invite = await prisma.teamInvite.findUnique({
    where: { token },
    select: {
      id: true,
      teamId: true,
      role: true,
      status: true,
      expiresAt: true,
      team: {
        select: {
          id: true,
          name: true,
          slug: true,
          avatarUrl: true,
          _count: { select: { members: true, projects: true } },
        },
      },
    },
  })

  if (!invite) {
    return NextResponse.json({ error: '邀请不存在' }, { status: 404 })
  }

  return NextResponse.json({ invite })
}
