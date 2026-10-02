import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePlatformAuth } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/platform/feedback — 运营端：用户反馈收件箱（带提交人信息）。 */
export async function GET(request: NextRequest) {
  const platformAuth = await requirePlatformAuth(request)
  if (platformAuth instanceof Response) return platformAuth

  const items = await prisma.platformFeedback.findMany({
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 100,
    include: {
      user: { select: { id: true, name: true, phone: true, email: true } },
    },
  })

  return NextResponse.json({
    items: items.map((f) => ({
      id: f.id,
      content: f.content,
      status: f.status,
      reply: f.reply,
      repliedAt: f.repliedAt,
      createdAt: f.createdAt,
      user: {
        id: f.user.id,
        name: f.user.name,
        contact: f.user.phone || f.user.email || null,
      },
    })),
  })
}
