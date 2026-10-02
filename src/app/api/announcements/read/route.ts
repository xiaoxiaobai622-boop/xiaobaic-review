import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiUser } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/announcements/read — 把一批通知标记为我已读（幂等，重复标不报错）。 */
export async function POST(request: NextRequest) {
  const authResult = await requireApiUser(request)
  if (authResult instanceof Response) return authResult

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 60,
    message: '请求过于频繁，请稍后再试',
  })
  if (limited) return limited

  const body = await request.json().catch(() => null)
  const ids: unknown = body?.ids
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== 'string')) {
    return NextResponse.json({ error: 'ids required' }, { status: 400 })
  }

  // 只标记确实存在、且（定向的）确实是发给我的，避免伪造 id 塞脏数据。
  const valid = await prisma.platformAnnouncement.findMany({
    where: { id: { in: ids as string[] }, OR: [{ userId: null }, { userId: authResult.id }] },
    select: { id: true },
  })
  if (valid.length === 0) return NextResponse.json({ ok: true, marked: 0 })

  await prisma.platformAnnouncementRead.createMany({
    data: valid.map((a) => ({ announcementId: a.id, userId: authResult.id })),
    skipDuplicates: true,
  })

  return NextResponse.json({ ok: true, marked: valid.length })
}
