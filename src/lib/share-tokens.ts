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

/**
 * Share links live at the root of the domain, so the code is read off a screen,
 * typed on a phone and pasted into chat: no `-`/`_`, and no `i l o` that nobody
 * can tell apart. The length itself is random so a code does not advertise
 * which generator produced it.
 */
const SHARE_CODE_CHARSET = 'abcdefghjkmnpqrstuvwxyz23456789'
const SHARE_CODE_MIN_LENGTH = 8
const SHARE_CODE_ALLOCATE_ATTEMPTS = 10

export function randomShareCode(): string {
  const length = SHARE_CODE_MIN_LENGTH + crypto.randomInt(5)
  let code = ''
  for (let i = 0; i < length; i++) {
    code += SHARE_CODE_CHARSET[crypto.randomInt(SHARE_CODE_CHARSET.length)]
  }
  return code
}

/** Draw codes until one is free. Bounded so a pathological collision cannot spin. */
export async function allocateShareToken(db: DbClient): Promise<string> {
  for (let attempt = 0; attempt < SHARE_CODE_ALLOCATE_ATTEMPTS; attempt++) {
    const token = randomShareCode()
    if ((await db.shareLink.count({ where: { token } })) === 0) return token
  }
  throw new Error('Unable to allocate a share address')
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
