import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/announcements — 发给我的平台通知（定向给我的 + 全员广播）。
 * 每条带出我自己的已读时间（没读过就是 null），未读数由前端累计。
 */
export async function GET(request: NextRequest) {
  // 平台通知按用户投递，不属于任何团队：还没建团队/入队的账号也得读得到，
  // 否则侧栏每 30 秒轮询一次就是一次 403。
  const authResult = await getCurrentUserFromRequest(request)
  if (!authResult) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 60,
    message: '请求过于频繁，请稍后再试',
  }, 'platform-announcements')
  if (limited) return limited

  const items = await prisma.platformAnnouncement.findMany({
    where: { OR: [{ userId: null }, { userId: authResult.id }] },
    orderBy: { createdAt: 'desc' },
    take: 30,
    include: {
      reads: { where: { userId: authResult.id }, select: { readAt: true } },
    },
  })

  return NextResponse.json({
    items: items.map((a) => ({
      id: a.id,
      title: a.title,
      content: a.content,
      createdAt: a.createdAt,
      broadcast: a.userId === null,
      readAt: a.reads[0]?.readAt ?? null,
    })),
    unread: items.filter((a) => a.reads.length === 0).length,
  })
}
