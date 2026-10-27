import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { isFeedbackCategory } from '@/lib/feedback-categories'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_CONTENT = 2000

/** GET /api/feedback — 我提交过的反馈（含运营回复）。 */
export async function GET(request: NextRequest) {
  // 反馈是账号自己的记录，不属于团队：还没建团队的账号也要读得到。
  const authResult = await getCurrentUserFromRequest(request)
  if (!authResult) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 60,
    message: '请求过于频繁，请稍后再试',
  }, 'platform-feedback-list')
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
  // 提交反馈同样只认身份；侧栏按钮对所有账号可见。
  const authResult = await getCurrentUserFromRequest(request)
  if (!authResult) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limited = await rateLimit(request, {
    windowMs: 10 * 60 * 1000,
    maxRequests: 5,
    message: '反馈提交过于频繁，请稍后再试',
  }, 'platform-feedback-create')
  if (limited) return limited

  const body = await request.json().catch(() => null)
  const content = typeof body?.content === 'string' ? body.content.trim() : ''
  if (!content) return NextResponse.json({ error: '反馈内容不能为空' }, { status: 400 })
  if (content.length > MAX_CONTENT) {
    return NextResponse.json({ error: `反馈内容不能超过 ${MAX_CONTENT} 字` }, { status: 400 })
  }
  // 类型只认那六枚（不选就是 null）。正文可以随便写，类型不能——运营后台按这一列分拣。
  const rawCategory: unknown = body?.category
  const category = isFeedbackCategory(rawCategory) ? rawCategory : null

  const item = await prisma.platformFeedback.create({
    data: { userId: authResult.id, content, category },
  })

  return NextResponse.json({ item })
}
