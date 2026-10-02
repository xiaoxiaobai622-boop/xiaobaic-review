import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiUser } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_CONTENT = 2000

/** GET /api/feedback — 我提交过的反馈（含运营回复）。 */
export async function GET(request: NextRequest) {
  const authResult = await requireApiUser(request)
  if (authResult instanceof Response) return authResult

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 60,
    message: '请求过于频繁，请稍后再试',
  })
  if (limited) return limited

  const items = await prisma.platformFeedback.findMany({
    where: { userId: authResult.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  return NextResponse.json({ items })
}

/** POST /api/feedback — 提交一条反馈给平台运营。 */
export async function POST(request: NextRequest) {
  const authResult = await requireApiUser(request)
  if (authResult instanceof Response) return authResult

  const limited = await rateLimit(request, {
    windowMs: 10 * 60 * 1000,
    maxRequests: 5,
    message: '反馈提交过于频繁，请稍后再试',
  })
  if (limited) return limited

  const body = await request.json().catch(() => null)
  const content = typeof body?.content === 'string' ? body.content.trim() : ''
  if (!content) return NextResponse.json({ error: '反馈内容不能为空' }, { status: 400 })
  if (content.length > MAX_CONTENT) {
    return NextResponse.json({ error: `反馈内容不能超过 ${MAX_CONTENT} 字` }, { status: 400 })
  }

  const item = await prisma.platformFeedback.create({
    data: { userId: authResult.id, content },
  })

  return NextResponse.json({ item })
}
