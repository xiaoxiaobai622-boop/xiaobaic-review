import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAuth } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { getAdminAnnouncement, updateDraftAnnouncement } from '@/lib/announcements/admin'
import { isPrimaryMode } from '@/lib/announcements/constants'
import { validateAnnouncementPayload } from '@/lib/announcements/validation'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function statsFiltersFromRequest(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get('mode')
  const fromRaw = request.nextUrl.searchParams.get('from')
  const toRaw = request.nextUrl.searchParams.get('to')
  const from = fromRaw ? new Date(fromRaw) : null
  const to = toRaw ? new Date(toRaw) : null
  return {
    mode: mode && isPrimaryMode(mode) ? mode : null,
    from: from && !Number.isNaN(from.getTime()) ? from : null,
    to: to && !Number.isNaN(to.getTime()) ? to : null,
  }
}

/** GET /api/platform/announcements/[id] — detail, audience, stats and audit. */
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
  }, 'platform-announcement-detail')
  if (limited) return limited

  const { id } = await params
  try {
    const detail = await getAdminAnnouncement(id, statsFiltersFromRequest(request))
    if (!detail) return NextResponse.json({ error: '公告不存在' }, { status: 404 })
    return NextResponse.json(detail)
  } catch (error) {
    logError('[ANNOUNCEMENT ADMIN] detail failed:', error)
    return NextResponse.json({ error: '公告读取失败，请刷新重试' }, { status: 500 })
  }
}

/** PATCH /api/platform/announcements/[id] — only DRAFTs are editable. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const platformAuth = await requirePlatformAuth(request)
  if (platformAuth instanceof Response) return platformAuth

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 30,
    message: '修改过于频繁，请稍后再试',
  }, 'platform-announcement-update')
  if (limited) return limited

  const { id } = await params
  const body = await request.json().catch(() => null)
  const validated = validateAnnouncementPayload(body, { publishing: false })
  if (!validated.ok) {
    return NextResponse.json({ error: validated.errors.join('；'), details: validated.errors }, { status: 400 })
  }

  const result = await updateDraftAnnouncement(id, validated.data, platformAuth)
  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status })
  }

  const detail = await getAdminAnnouncement(id)
  return NextResponse.json(detail)
}
