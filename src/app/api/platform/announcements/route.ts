import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePlatformAuth } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import {
  createAnnouncementDraft,
  listAdminAnnouncements,
  parseAdminAnnouncementFilters,
} from '@/lib/announcements/admin'
import { recordAnnouncementAudit } from '@/lib/announcements/audit'
import { ANNOUNCEMENT_CONTENT_MAX, ANNOUNCEMENT_TITLE_MAX } from '@/lib/announcements/constants'
import { announcementNow } from '@/lib/announcements/time'
import { validateAnnouncementPayload } from '@/lib/announcements/validation'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/platform/announcements — announcement list with audience + funnel counts. */
export async function GET(request: NextRequest) {
  const platformAuth = await requirePlatformAuth(request)
  if (platformAuth instanceof Response) return platformAuth

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 120,
    message: '请求过于频繁，请稍后再试',
  }, 'platform-announcements-list')
  if (limited) return limited

  try {
    const filters = parseAdminAnnouncementFilters(request.nextUrl.searchParams)
    const items = await listAdminAnnouncements(filters)
    return NextResponse.json({ items, total: items.length })
  } catch (error) {
    logError('[ANNOUNCEMENT ADMIN] list failed:', error)
    return NextResponse.json({ error: '公告列表读取失败，请刷新重试' }, { status: 500 })
  }
}

/**
 * POST /api/platform/announcements
 * New console: create a DRAFT (publish is a separate audited action).
 * Legacy console (/platform/messages): keep the old {target,userId,title,content}
 * shape and immediately create a MESSAGE/INBOX announcement.
 */
export async function POST(request: NextRequest) {
  const platformAuth = await requirePlatformAuth(request)
  if (platformAuth instanceof Response) return platformAuth

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 30,
    message: '发送过于频繁，请稍后再试',
  }, 'platform-announcements-send')
  if (limited) return limited

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: '请求内容不合法' }, { status: 400 })
  }

  const isLegacyShape = (body.target === 'ALL' || body.target === 'USER')
    && body.type === undefined
    && body.primaryMode === undefined
    && !Array.isArray(body.audienceRules)

  if (isLegacyShape) {
    return createLegacyMessage(body, platformAuth)
  }

  const validated = validateAnnouncementPayload(body, { publishing: false })
  if (!validated.ok) {
    return NextResponse.json({ error: validated.errors.join('；'), details: validated.errors }, { status: 400 })
  }

  try {
    const id = await createAnnouncementDraft(validated.data, platformAuth)
    return NextResponse.json({ item: { id, status: 'DRAFT' } })
  } catch (error) {
    logError('[ANNOUNCEMENT ADMIN] create failed:', error)
    return NextResponse.json({ error: '公告保存失败，请稍后重试' }, { status: 500 })
  }
}

async function createLegacyMessage(
  body: Record<string, unknown>,
  platformAuth: { id: string; name?: string | null; email?: string | null },
) {
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  const target = body.target === 'USER' ? 'USER' : 'ALL'
  const userId = typeof body.userId === 'string' ? body.userId : null

  if (!title || !content) return NextResponse.json({ error: '标题和内容不能为空' }, { status: 400 })
  if (title.length > ANNOUNCEMENT_TITLE_MAX) {
    return NextResponse.json({ error: `标题不能超过 ${ANNOUNCEMENT_TITLE_MAX} 字` }, { status: 400 })
  }
  if (content.length > ANNOUNCEMENT_CONTENT_MAX) {
    return NextResponse.json({ error: `内容不能超过 ${ANNOUNCEMENT_CONTENT_MAX} 字` }, { status: 400 })
  }

  if (target === 'USER') {
    if (!userId) return NextResponse.json({ error: '请选择接收用户' }, { status: 400 })
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
    if (!user) return NextResponse.json({ error: '接收用户不存在' }, { status: 400 })
  }

  const now = announcementNow()
  const audienceCount = target === 'USER' ? 1 : await prisma.user.count()
  const item = await prisma.platformAnnouncement.create({
    data: {
      title,
      content,
      userId: target === 'USER' ? userId : null,
      locale: 'zh',
      type: 'MESSAGE',
      status: 'ACTIVE',
      primaryMode: 'INBOX',
      priority: 0,
      startAt: now,
      publishedAt: now,
      audienceCount,
      audienceResolvedAt: now,
      createdBy: platformAuth.id,
      isTest: false,
    },
  })

  await recordAnnouncementAudit({
    announcementId: item.id,
    actor: platformAuth,
    action: 'CREATE',
    detail: { legacy: true, target, audienceCount },
  })

  return NextResponse.json({ item })
}
