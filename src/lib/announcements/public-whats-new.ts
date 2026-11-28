import { prisma } from '@/lib/db'
import { BRAND } from '@/lib/marketing/brand'
import {
  announcementCategoriesForDisplay,
  type AnnouncementCategorySlug,
} from './categories'
import { whatsNewCardSummary } from './card-summary'
import { loadAnnouncementCategories, loadCategoryAnnouncementIds } from './category-content'
import {
  isAnnouncementActiveNow,
  isAnnouncementInInboxWindow,
  type AnnouncementWithRules,
} from './feed'
import { loadAnnouncementContentHtml } from './rich-content'
import { sanitizeAnnouncementHtml } from './rich-text'
import { announcementNow } from './time'

export interface PublicReleaseSummary {
  id: string
  title: string
  content: string
  summary: string
  imageUrl: string | null
  ctaLabel: string | null
  ctaUrl: string | null
  publishedAt: Date
  updatedAt: Date
  createdAt: Date
  categories: Array<{ slug: AnnouncementCategorySlug; label: string }>
}

export interface PublicReleaseArticle extends PublicReleaseSummary {
  safeHtml: string | null
  authorName: string
  readingMinutes: number
}

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
 * Only non-test, published, currently active RELEASE announcements addressed to
 * everyone (userId === null and no targeted/excluded audience rules) may be
 * exposed on unauthenticated public routes, sitemap.xml, and llms.txt.
 */
export function isStrictlyPublicRelease(
  announcement: AnnouncementWithRules,
  now = announcementNow(),
): boolean {
  if (announcement.type !== 'RELEASE' || announcement.isTest) return false
  if (!announcement.publishedAt) return false
  if (!isAnnouncementActiveNow(announcement, now)) return false
  if (announcement.userId !== null) return false

  const rules = announcement.rules ?? []
  if (rules.length === 0) return true
  return rules.every((rule) => rule.mode === 'INCLUDE' && rule.kind === 'ALL')
}

export async function listPublicReleaseArticles(
  options: { category?: AnnouncementCategorySlug; limit?: number } = {},
): Promise<PublicReleaseSummary[]> {
  try {
    const now = announcementNow()
    const categoryIds = options.category
      ? await loadCategoryAnnouncementIds(options.category)
      : null
    if (categoryIds && categoryIds.length === 0) return []

    const rows = await prisma.platformAnnouncement.findMany({
      where: {
        type: 'RELEASE',
        isTest: false,
        status: 'ACTIVE',
        userId: null,
        publishedAt: { not: null },
        ...(categoryIds ? { id: { in: categoryIds } } : {}),
        OR: [{ startAt: null }, { startAt: { lte: now } }],
        AND: [{ OR: [{ endAt: null }, { endAt: { gt: now } }] }],
      },
      orderBy: [{ priority: 'desc' }, { publishedAt: 'desc' }, { createdAt: 'desc' }],
      take: options.limit ?? 100,
      include: { rules: true },
    })

    const publicRows = rows.filter((row) => isStrictlyPublicRelease(row, now))
    const categoryLists = await Promise.all(
      publicRows.map((row) => loadAnnouncementCategories(row.id).catch(() => [])),
    )

    return publicRows.map((row, index) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      summary: whatsNewCardSummary(row.content, 120),
      imageUrl: row.imageUrl,
      ctaLabel: row.ctaLabel,
      ctaUrl: row.ctaUrl,
      publishedAt: row.publishedAt ?? row.createdAt,
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
      categories: announcementCategoriesForDisplay(categoryLists[index]),
    }))
  } catch {
    return []
  }
}

export async function getPublicReleaseArticle(id: string): Promise<PublicReleaseArticle | null> {
  if (!id.trim()) return null
  try {
    const row = await prisma.platformAnnouncement.findUnique({
      where: { id },
      include: { rules: true },
    })
    const now = announcementNow()
    if (!row || !isStrictlyPublicRelease(row, now)) return null

    const [rawHtml, creator, categories] = await Promise.all([
      loadAnnouncementContentHtml(row.id).catch(() => null),
      row.createdBy
        ? prisma.user.findUnique({
            where: { id: row.createdBy },
            select: { name: true },
          })
        : Promise.resolve(null),
      loadAnnouncementCategories(row.id).catch(() => []),
    ])

    const creatorName = creator?.name?.trim() || ''
    const authorName = creatorName && creatorName.toLowerCase() !== 'admin'
      ? creatorName
      : `${BRAND.zh}团队`

    return {
      id: row.id,
      title: row.title,
      content: row.content,
      summary: whatsNewCardSummary(row.content, 120),
      safeHtml: sanitizeAnnouncementHtml(rawHtml),
      imageUrl: row.imageUrl,
      ctaLabel: row.ctaLabel,
      ctaUrl: row.ctaUrl,
      publishedAt: row.publishedAt ?? row.createdAt,
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
      categories: announcementCategoriesForDisplay(categories),
      authorName,
      readingMinutes: estimateReadingMinutes(rawHtml, row.content),
    }
  } catch {
    return null
  }
}

/**
 * Checks whether an ID belongs to a non-public (targeted or archived) RELEASE
 * announcement so signed-in studio users can still view it while crawlers see
 * `noindex, nofollow` and unknown IDs return a genuine 404.
 */
export async function hasStudioOnlyReleaseArticle(id: string): Promise<boolean> {
  if (!id.trim()) return false
  try {
    const row = await prisma.platformAnnouncement.findUnique({
      where: { id },
      include: { rules: true },
    })
    if (!row || row.type !== 'RELEASE' || row.isTest) return false
    const now = announcementNow()
    if (!isAnnouncementInInboxWindow(row, now)) return false
    return !isStrictlyPublicRelease(row, now)
  } catch {
    return false
  }
}
