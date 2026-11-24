export const ANNOUNCEMENT_CATEGORY_SLUGS = [
  'announcements',
  'product-updates',
  'release-notes',
] as const

export type AnnouncementCategorySlug = (typeof ANNOUNCEMENT_CATEGORY_SLUGS)[number]

export const ANNOUNCEMENT_CATEGORY_LABELS: Record<AnnouncementCategorySlug, string> = {
  announcements: '公告',
  'product-updates': '产品更新',
  'release-notes': '版本说明',
}

export const ANNOUNCEMENT_CATEGORIES = ANNOUNCEMENT_CATEGORY_SLUGS.map((slug) => ({
  slug,
  label: ANNOUNCEMENT_CATEGORY_LABELS[slug],
}))

export const DEFAULT_RELEASE_CATEGORY_SLUG: AnnouncementCategorySlug = 'product-updates'

export function isAnnouncementCategorySlug(value: unknown): value is AnnouncementCategorySlug {
  return typeof value === 'string'
    && (ANNOUNCEMENT_CATEGORY_SLUGS as readonly string[]).includes(value)
}

export function normalizeAnnouncementCategorySlugs(input: unknown): AnnouncementCategorySlug[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<AnnouncementCategorySlug>()
  for (const value of input) {
    if (isAnnouncementCategorySlug(value)) seen.add(value)
  }
  return Array.from(seen).slice(0, ANNOUNCEMENT_CATEGORY_SLUGS.length)
}

export function announcementCategoriesForDisplay(
  stored: unknown,
): Array<{ slug: AnnouncementCategorySlug; label: string }> {
  const normalized = normalizeAnnouncementCategorySlugs(stored)
  const slugs = normalized.length > 0 ? normalized : [DEFAULT_RELEASE_CATEGORY_SLUG]
  return slugs.map((slug) => ({ slug, label: ANNOUNCEMENT_CATEGORY_LABELS[slug] }))
}