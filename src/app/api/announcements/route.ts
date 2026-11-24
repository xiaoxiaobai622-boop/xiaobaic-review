import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import {
  loadAnnouncementFeed,
  loadAnnouncementHistoryPage,
} from '@/lib/announcements/feed'
import { logError } from '@/lib/logging'
import { isAnnouncementCategorySlug, type AnnouncementCategorySlug } from '@/lib/announcements/categories'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/announcements — the single feed for INBOX, BANNER, MODAL and TOAST.
 * The default (and `surface=notifications`) feed excludes RELEASE rows; the
 * `surface=whats-new` feed is the only one that returns release notes.
 * The legacy fields (id/title/content/createdAt/broadcast/readAt + unread) stay
 * intact; mode/priority/ack/dismiss/impression fields are additive.
 */
export async function GET(request: NextRequest) {
  const authResult = await getCurrentUserFromRequest(request)
  if (!authResult) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 60,
    message: '请求过于频繁，请稍后再试',
  }, 'platform-announcements', authResult.id)
  if (limited) return limited

  try {
    const surfaceParam = request.nextUrl.searchParams.get('surface')
    const surface = surfaceParam === 'whats-new'
      ? 'whats-new' as const
      : surfaceParam === 'notifications'
        ? 'notifications' as const
        : undefined
    const categoryRaw = request.nextUrl.searchParams.get('category')?.trim() || null
    let category: AnnouncementCategorySlug | undefined
    if (categoryRaw) {
      if (!isAnnouncementCategorySlug(categoryRaw)) {
        return NextResponse.json({ error: '未知分类' }, { status: 400 })
      }
      category = categoryRaw
    }
    const historyCursor = request.nextUrl.searchParams.get('historyCursor')?.trim() || null
    if (historyCursor) {
      const historyLimit = Number(request.nextUrl.searchParams.get('historyLimit') || 50)
      const page = await loadAnnouncementHistoryPage(authResult.id, historyCursor, historyLimit, { surface, category })
      if (!page) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      return NextResponse.json(page, {
        headers: { 'Cache-Control': 'no-store' },
      })
    }

    const feed = await loadAnnouncementFeed(authResult.id, { surface, category })
    if (!feed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return NextResponse.json(feed, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    // The receiver host degrades to no banner/modal and the rail keeps its last
    // list; a failed feed must never block login or the studio.
    logError('[ANNOUNCEMENT FEED] failed:', error)
    return NextResponse.json({ error: '公告读取失败' }, { status: 500 })
  }
}
