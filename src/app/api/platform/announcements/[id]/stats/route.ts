import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAuth } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { getAdminAnnouncement } from '@/lib/announcements/admin'
import { isPrimaryMode } from '@/lib/announcements/constants'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/platform/announcements/[id]/stats?mode=&from=&to= */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const platformAuth = await requirePlatformAuth(request)
  if (platformAuth instanceof Response) return platformAuth

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 120,
    message: '请求过于频繁，请稍后再试',
  }, 'platform-announcement-stats')
  if (limited) return limited

  const { id } = await params
  const mode = request.nextUrl.searchParams.get('mode')
  const fromRaw = request.nextUrl.searchParams.get('from')
  const toRaw = request.nextUrl.searchParams.get('to')
  const from = fromRaw ? new Date(fromRaw) : null
  const to = toRaw ? new Date(toRaw) : null

  try {
    const detail = await getAdminAnnouncement(id, {
      mode: mode && isPrimaryMode(mode) ? mode : null,
      from: from && !Number.isNaN(from.getTime()) ? from : null,
      to: to && !Number.isNaN(to.getTime()) ? to : null,
    })
    if (!detail) return NextResponse.json({ error: '公告不存在' }, { status: 404 })
    return NextResponse.json({
      stats: detail.stats,
      item: {
        id: detail.item.id,
        title: detail.item.title,
        status: detail.item.status,
        primaryMode: detail.item.primaryMode,
        audience: detail.item.audience,
        stats: detail.item.stats,
      },
      audit: detail.audit,
    })
  } catch (error) {
    logError('[ANNOUNCEMENT STATS] failed:', error)
    return NextResponse.json({ error: '统计读取失败，请刷新重试' }, { status: 500 })
  }
}
