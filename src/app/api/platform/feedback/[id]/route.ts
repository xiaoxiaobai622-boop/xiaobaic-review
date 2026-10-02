import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePlatformAuth } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_REPLY = 2000

/** PATCH /api/platform/feedback/[id] — 运营端：回复一条反馈（回复即视为已处理）。 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const platformAuth = await requirePlatformAuth(request)
  if (platformAuth instanceof Response) return platformAuth

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 60,
    message: '操作过于频繁，请稍后再试',
  })
  if (limited) return limited

  const { id } = await params
  const body = await request.json().catch(() => null)
  const reply = typeof body?.reply === 'string' ? body.reply.trim() : ''
  if (!reply) return NextResponse.json({ error: '回复内容不能为空' }, { status: 400 })
  if (reply.length > MAX_REPLY) {
    return NextResponse.json({ error: `回复不能超过 ${MAX_REPLY} 字` }, { status: 400 })
  }

  const existing = await prisma.platformFeedback.findUnique({ where: { id }, select: { id: true } })
  if (!existing) return NextResponse.json({ error: '反馈不存在' }, { status: 404 })

  const item = await prisma.platformFeedback.update({
    where: { id },
    data: { reply, status: 'RESOLVED', repliedAt: new Date() },
  })

  return NextResponse.json({ item })
}
