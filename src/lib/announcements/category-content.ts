import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  DEFAULT_RELEASE_CATEGORY_SLUG,
  normalizeAnnouncementCategorySlugs,
  type AnnouncementCategorySlug,
} from './categories'

type RawExecutor = Pick<Prisma.TransactionClient, '$executeRaw'>

function executor(tx?: Prisma.TransactionClient): RawExecutor {
  return (tx ?? prisma) as unknown as RawExecutor
}

function categoryArraySql(categories: string[]): Prisma.Sql {
  return categories.length > 0
    ? Prisma.sql`ARRAY[${Prisma.join(categories)}]::text[]`
    : Prisma.sql`ARRAY[]::text[]`
}

export async function loadAnnouncementCategories(id: string): Promise<AnnouncementCategorySlug[]> {
  const rows = await prisma.$queryRaw<Array<{ categories: string[] }>>`
    SELECT "categories"
    FROM "PlatformAnnouncement"
    WHERE "id" = ${id}
    LIMIT 1
  `
  return normalizeAnnouncementCategorySlugs(rows[0]?.categories)
}

export async function saveAnnouncementCategories(
  id: string,
  categories: unknown,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const normalized = normalizeAnnouncementCategorySlugs(categories)
  await executor(tx).$executeRaw`
    UPDATE "PlatformAnnouncement"
    SET "categories" = ${categoryArraySql(normalized)}
    WHERE "id" = ${id}
  `
}

export async function copyAnnouncementCategories(
  sourceId: string,
  targetId: string,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  await executor(tx).$executeRaw`
    UPDATE "PlatformAnnouncement"
    SET "categories" = (
      SELECT "categories"
      FROM "PlatformAnnouncement"
      WHERE "id" = ${sourceId}
    )
    WHERE "id" = ${targetId}
  `
}

/**
 * Old rows have an empty list and are treated as product-updates on the article
 * page, so the product-updates category page must include them too.
 */
export async function loadCategoryAnnouncementIds(slug: AnnouncementCategorySlug): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "PlatformAnnouncement"
    WHERE (
      "categories" @> ARRAY[${slug}]::text[]
      OR (${slug} = ${DEFAULT_RELEASE_CATEGORY_SLUG} AND cardinality("categories") = 0)
    )
  `
  return rows.map((row) => row.id)
}