import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePlatformAuth } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { maskPhone } from '@/lib/phone-field'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/platform/feedback — 运营端：用户反馈收件箱（带提交人信息）。 */
export async function GET(request: NextRequest) {
  const platformAuth = await requirePlatformAuth(request)
  if (platformAuth instanceof Response) return platformAuth

  // 一次只取最近 100 条，但界面那句「N 条」说的是整张表：所以总数单独数一次，别拿窗口里的行数冒充。
  const [rows, total] = await Promise.all([
    prisma.platformFeedback.findMany({
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 100,
      include: {
        user: { select: { id: true, name: true, phone: true, email: true } },
      },
    }),
    prisma.platformFeedback.count(),
  ])

  return NextResponse.json({
    total,
    items: rows.map((f) => ({
      id: f.id,
      content: f.content,
      status: f.status,
      reply: f.reply,
      repliedAt: f.repliedAt,
      createdAt: f.createdAt,
      user: {
        id: f.user.id,
        name: f.user.name,
        contact: maskPhone(f.user.phone) || f.user.email || null,
      },
    })),
  })
}
