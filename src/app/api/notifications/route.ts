import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { getNotificationFeed, type NotificationFilter } from '@/lib/in-app-notifications/queries'
import type { InAppCategory } from '@/lib/in-app-notifications/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function parseCategory(value: string | null): InAppCategory | null {
  return value === 'TEAM' || value === 'MENTION' ? value : null
}

function parseFilter(value: string | null): NotificationFilter {
  return value === 'unread' ? 'unread' : 'all'
}

export async function GET(request: NextRequest) {
  const auth = await requireApiUser(request)
  if (auth instanceof Response) return auth

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 60,
    message: '请求过于频繁，请稍后再试',
  }, 'in-app-notifications-read')
  if (limited) return limited

  const url = new URL(request.url)
  const category = parseCategory(url.searchParams.get('category'))
  const filter = parseFilter(url.searchParams.get('filter'))
  const cursor = url.searchParams.get('cursor')
  const limitRaw = Number(url.searchParams.get('limit') || '')
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined

  try {
    const feed = await getNotificationFeed({
      userId: auth.id,
      teamId: auth.authorizedTeamId!,
      category,
      filter,
      cursor,
      limit,
    })
    return NextResponse.json(feed, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'NOTIFICATIONS_UNAVAILABLE' }, { status: 500 })
  }
}
