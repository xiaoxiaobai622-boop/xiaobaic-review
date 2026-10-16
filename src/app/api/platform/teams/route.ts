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
      subscriptionPlan: true,
      subscriptionStartedAt: true,
      subscriptionExpiresAt: true,
      createdBy: { select: { id: true, name: true, email: true } },
      // 成员数只算在队的（TeamMemberStatus 还有 DISABLED 这一档）：额度检查与团队详情的用量走
      // getTeamUsage，数的就是 status=ACTIVE，这两处要是对不上，运营会拿一个偏大的数去比一个 5 人的额度。
      _count: { select: { members: { where: { status: 'ACTIVE' } }, projects: true } },
      members: {
        where: { role: 'OWNER', status: 'ACTIVE' },
        take: 1,
        select: { user: { select: { id: true, name: true, email: true } } },
      },
    },
  })

  return NextResponse.json({ teams })
}
