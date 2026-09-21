import type { Prisma, PrismaClient } from '@prisma/client'
import crypto from 'crypto'

type DbClient = PrismaClient | Prisma.TransactionClient

/**
 * A share address is the only secret standing between the internet and a
 * client's footage, so it is generated, never derived from the title: a
 * title-based slug under a static team segment is enumerable. `slug` is the
 * API token and is unique across the whole installation, `shareSlug` is the
 * URL segment and is unique within the team.
 */
export function randomShareToken(): string {
  return crypto.randomBytes(12).toString('base64url')
}

export async function generateUniqueProjectSlugs(
  db: DbClient,
  teamId: string,
): Promise<{ slug: string; shareSlug: string }> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const slug = randomShareToken()
    const shareSlug = randomShareToken()
    const [slugTaken, shareSlugTaken] = await Promise.all([
      db.project.count({ where: { slug } }),
      db.project.count({ where: { teamId, shareSlug } }),
    ])
    if (slugTaken === 0 && shareSlugTaken === 0) return { slug, shareSlug }
  }
  throw new Error('Unable to allocate a share address')
}
