import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePlatformAuth } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const user = await requirePlatformAuth(request)
  if (user instanceof Response) return user

  const teams = await prisma.team.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      slug: true,
      shareKey: true,
      status: true,
      createdAt: true,
      createdBy: { select: { id: true, name: true, email: true } },
      _count: { select: { members: true, projects: true } },
      members: {
        where: { role: 'OWNER', status: 'ACTIVE' },
        take: 1,
        select: { user: { select: { id: true, name: true, email: true } } },
      },
    },
  })

  return NextResponse.json({ teams })
}
