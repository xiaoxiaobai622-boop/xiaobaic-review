import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePlatformAuth } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { maskPhone } from '@/lib/phone-field'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_TITLE = 60
const MAX_CONTENT = 2000

/** GET /api/platform/announcements — 运营端：已发送的通知列表（带已读人数）。 */
export async function GET(request: NextRequest) {
  const platformAuth = await requirePlatformAuth(request)
  if (platformAuth instanceof Response) return platformAuth

  const items = await prisma.platformAnnouncement.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      user: { select: { name: true, phone: true, email: true } },
      _count: { select: { reads: true } },
    },
  })

  return NextResponse.json({
    items: items.map((a) => ({
      id: a.id,
      title: a.title,
      content: a.content,
      createdAt: a.createdAt,
      broadcast: a.userId === null,
      targetName: a.user?.name || maskPhone(a.user?.phone) || a.user?.email || null,
      readCount: a._count.reads,
    })),
  })
}

/** POST /api/platform/announcements — 运营端：发一条通知（全员广播或定向单个用户）。 */
export async function POST(request: NextRequest) {
  const platformAuth = await requirePlatformAuth(request)
  if (platformAuth instanceof Response) return platformAuth

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 30,
    message: '发送过于频繁，请稍后再试',
  })
  if (limited) return limited

  const body = await request.json().catch(() => null)
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  const content = typeof body?.content === 'string' ? body.content.trim() : ''
  const target = body?.target === 'USER' ? 'USER' : 'ALL'
  const userId = typeof body?.userId === 'string' ? body.userId : null

  if (!title || !content) {
    return NextResponse.json({ error: '标题和内容不能为空' }, { status: 400 })
  }
  if (title.length > MAX_TITLE) {
    return NextResponse.json({ error: `标题不能超过 ${MAX_TITLE} 字` }, { status: 400 })
  }
  if (content.length > MAX_CONTENT) {
    return NextResponse.json({ error: `内容不能超过 ${MAX_CONTENT} 字` }, { status: 400 })
  }

  if (target === 'USER') {
    if (!userId) return NextResponse.json({ error: '请选择接收用户' }, { status: 400 })
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
    if (!user) return NextResponse.json({ error: '接收用户不存在' }, { status: 400 })
  }

  const item = await prisma.platformAnnouncement.create({
    data: { title, content, userId: target === 'USER' ? userId : null },
  })

  return NextResponse.json({ item })
}
