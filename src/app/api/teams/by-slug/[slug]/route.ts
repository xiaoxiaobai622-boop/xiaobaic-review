import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const user = await getCurrentUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { slug } = await params
  const team = await prisma.team.findUnique({
    where: { slug },
    // 这个接口对任何登录用户开放（申请加入页要靠 slug 把团队名字显示出来），所以不能顺手
    // 交出成员数与项目数——那是可以被逐个 slug 枚举出来的经营信息。申请人只需要确认
    // 「我输对了团队」，审批的细节由提交后的那句说明承担。
    select: {
      id: true,
      name: true,
      slug: true,
    },
  })
  if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 })
  return NextResponse.json({ team })
}
