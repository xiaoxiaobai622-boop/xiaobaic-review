import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAuth } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { listAnnouncementAudit, listGlobalAnnouncementAudit } from '@/lib/announcements/audit'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/platform/announcements/audit?announcementId=&limit= */
export async function GET(request: NextRequest) {
  const platformAuth = await requirePlatformAuth(request)
  if (platformAuth instanceof Response) return platformAuth

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 60,
    message: '请求过于频繁，请稍后再试',
  }, 'platform-announcement-audit')
  if (limited) return limited

  const announcementId = request.nextUrl.searchParams.get('announcementId')
  const limit = Math.max(1, Math.min(200, Number(request.nextUrl.searchParams.get('limit') || 100)))

  try {
    const items = announcementId
      ? await listAnnouncementAudit(announcementId, limit)
      : await listGlobalAnnouncementAudit(limit)
    return NextResponse.json({ items })
  } catch (error) {
    logError('[ANNOUNCEMENT AUDIT] list failed:', error)
    return NextResponse.json({ error: '审计日志读取失败' }, { status: 500 })
  }
}
