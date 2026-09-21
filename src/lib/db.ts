import { Prisma, PrismaClient } from '@prisma/client'

/**
 * `Video.deletedAt` turns the recycle bin into a real undo window: the row, and the
 * comments/analytics that a hard delete cascades away, survive until the item
 * expires. Missing a filter would show a client a video the team threw away, so
 * tombstones are hidden by default.
 */
const VIDEO_READ_OPERATIONS = new Set([
  'findMany', 'findFirst', 'findFirstOrThrow',
  'findUnique', 'findUniqueOrThrow',
  'count', 'aggregate', 'groupBy',
])

const INCLUDE_DELETED_MARK = Symbol('includeDeletedVideos')

/**
 * Pass as `where.deletedAt` on a Video read to include tombstones as well. Done this
 * way rather than through a second client so it also works inside `$transaction`,
 * where version allocation needs a tombstone-aware max and a tombstone-blind
 * revision count in the same transaction.
 */
export const INCLUDE_DELETED: Prisma.DateTimeNullableFilter<'Video'> =
  Object.freeze({ [INCLUDE_DELETED_MARK]: true }) as Prisma.DateTimeNullableFilter<'Video'>

/**
 * Spread into a nested `videos`/`_count.videos` read. Relation loads are not routed
 * through the extension below, so those have to filter explicitly.
 */
export const LIVE_VIDEO = { deletedAt: null } as const

/**
 * Spread into a Comment read (flat or nested) to drop annotations whose video is in
 * the recycle bin. Comment reads cannot be guarded by the extension below: the
 * filter has to live in `where.video`, and Prisma rebuilds nested relation filters
 * from its schema, which drops the marker symbol this file's opt-out relies on.
 */
export const LIVE_COMMENT = { video: LIVE_VIDEO } as const

function withoutTombstones(args: any) {
  const where = args?.where
  if (!where || typeof where !== 'object') return args
  if (where.deletedAt === INCLUDE_DELETED) {
    const { deletedAt: _ignored, ...rest } = where
    return { ...args, where: rest }
  }
  if ('deletedAt' in where) return args
  return { ...args, where: { ...where, deletedAt: null } }
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createClient() {
  return new PrismaClient().$extends({
    query: {
      video: {
        $allOperations({ args, query, operation }) {
          if (!VIDEO_READ_OPERATIONS.has(operation)) return query(args)
          return query(withoutTombstones(args))
        },
      },
    },
  }) as unknown as PrismaClient
}

export const prisma = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
