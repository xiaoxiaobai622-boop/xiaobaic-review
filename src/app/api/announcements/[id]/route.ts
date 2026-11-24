import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { getVisibleAnnouncementForUser } from '@/lib/announcements/feed'
import { loadAnnouncementContentHtml } from '@/lib/announcements/rich-content'
import { loadAnnouncementCategories } from '@/lib/announcements/category-content'
import { announcementCategoriesForDisplay } from '@/lib/announcements/categories'
import { sanitizeAnnouncementHtml } from '@/lib/announcements/rich-text'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function estimateReadingMinutes(html: string | null, fallback: string): number {
  const text = (html || fallback)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-zA-Z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return 1
  const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length
  const latin = text.replace(/[\u3400-\u9fff]/g, ' ').split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.ceil(cjk / 300 + latin / 200))
}

/**
 * GET /api/announcements/[id] — one published RELEASE article for the current
 * studio user. Non-RELEASE, test, draft and non-audience ids are all 404 so an
 * article URL cannot probe existence. Reading the article is a separate POST
 * to /api/announcements/state (READ); this endpoint stays read-only.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await getCurrentUserFromRequest(request)
  if (!authResult) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 120,
    message: '请求过于频繁，请稍后再试',
  }, 'announcement-article', authResult.id)
  if (limited) return limited

  const { id } = await params
  try {
    const item = await getVisibleAnnouncementForUser(authResult.id, id)
    if (!item || item.type !== 'RELEASE' || item.isTest) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const [read, rawHtml, creator, categories] = await Promise.all([
      prisma.platformAnnouncementRead.findUnique({
        where: { announcementId_userId: { announcementId: item.id, userId: authResult.id } },
        select: { readAt: true },
      }),
      loadAnnouncementContentHtml(item.id),
      item.createdBy
        ? prisma.user.findUnique({
            where: { id: item.createdBy },
            select: { name: true, avatarUrl: true },
          })
        : Promise.resolve(null),
      loadAnnouncementCategories(item.id),
    ])

    const creatorName = creator?.name?.trim() || ''
    const authorName = creatorName && creatorName.toLowerCase() !== 'admin'
      ? creatorName
      : '逐帧审阅团队'

    return NextResponse.json({
      item: {
        id: item.id,
        title: item.title,
        content: item.content,
        contentHtml: sanitizeAnnouncementHtml(rawHtml),
        imageUrl: item.imageUrl,
        ctaLabel: item.ctaLabel,
        ctaUrl: item.ctaUrl,
        publishedAt: item.publishedAt,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        locale: item.locale,
        readAt: read?.readAt ?? null,
        categories: announcementCategoriesForDisplay(categories),
        author: {
          name: authorName,
          avatarUrl: creator?.avatarUrl ?? null,
        },
        creator: creator
          ? { name: creator.name, avatarUrl: creator.avatarUrl }
          : null,
        readingMinutes: estimateReadingMinutes(rawHtml, item.content),
      },
    }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    logError('[ANNOUNCEMENT ARTICLE] failed:', error)
    return NextResponse.json({ error: '新增功能读取失败' }, { status: 500 })
  }
}