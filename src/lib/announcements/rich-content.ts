import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { sanitizeAnnouncementHtml } from './rich-text'

type RawExecutor = Pick<Prisma.TransactionClient, '$executeRaw'>

function executor(tx?: Prisma.TransactionClient): RawExecutor {
  return (tx ?? prisma) as unknown as RawExecutor
}

/**
 * The piecewise rollout intentionally keeps this column out of the generated
 * Prisma client used by the currently running dev server. The migration adds a
 * plain nullable column; parameterized raw SQL reads/writes it without
 * requiring a server restart. A normal restart/install generates the typed
 * field as well, and this helper remains compatible.
 */
export async function loadAnnouncementContentHtml(id: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ contentHtml: string | null }>>`
    SELECT "contentHtml"
    FROM "PlatformAnnouncement"
    WHERE "id" = ${id}
    LIMIT 1
  `
  return rows[0]?.contentHtml ?? null
}

export async function saveAnnouncementContentHtml(
  id: string,
  html: string | null | undefined,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const clean = sanitizeAnnouncementHtml(html)
  await executor(tx).$executeRaw`
    UPDATE "PlatformAnnouncement"
    SET "contentHtml" = ${clean}
    WHERE "id" = ${id}
  `
}

export async function copyAnnouncementContentHtml(
  sourceId: string,
  targetId: string,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  await executor(tx).$executeRaw`
    UPDATE "PlatformAnnouncement"
    SET "contentHtml" = (
      SELECT "contentHtml"
      FROM "PlatformAnnouncement"
      WHERE "id" = ${sourceId}
    )
    WHERE "id" = ${targetId}
  `
}