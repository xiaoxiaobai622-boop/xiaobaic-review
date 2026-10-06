import { Prisma, PrismaClient } from '@prisma/client'
import { decryptPhoneValue, encryptPhoneValue, hashPhone } from './phone-field'

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

const CIPHER_SHAPE = /^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/i

function looksLikeCipher(value: unknown): value is string {
  return typeof value === 'string' && CIPHER_SHAPE.test(value)
}

/**
 * Walks a result object and returns readable phones for every stored ciphertext, including
 * the ones nested inside included relations.
 */
function mapPhoneFields<T>(value: T, transform: (phone: string) => string): T {
  if (Array.isArray(value)) return value.map(item => mapPhoneFields(item, transform)) as unknown as T
  if (!value || typeof value !== 'object') return value

  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'phone' && typeof entry === 'string') out[key] = transform(entry)
    else out[key] = mapPhoneFields(entry, transform)
  }
  return out as T
}

/**
 * Write side. Encryption and its lookup digest are applied together, on purpose: a caller
 * that sets `phone` and forgets `phoneHash` would otherwise store a row nobody can find by
 * phone number again, and nothing would complain. An explicitly supplied digest is left alone
 * (it is derived from the same key, so both agree), and clearing the number clears the digest.
 */
function encryptPhoneFields<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => encryptPhoneFields(item)) as unknown as T
  if (!value || typeof value !== 'object') return value

  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) out[key] = entry

  if ('phone' in out) {
    const raw = out.phone
    if (typeof raw === 'string' && raw && !looksLikeCipher(raw)) {
      out.phone = encryptPhoneValue(raw)
      if (out.phoneHash === undefined) out.phoneHash = hashPhone(raw)
    } else if (raw === null || raw === '') {
      out.phone = null
      if (out.phoneHash === undefined) out.phoneHash = null
    }
  }

  for (const [key, entry] of Object.entries(out)) {
    if (entry && typeof entry === 'object') out[key] = encryptPhoneFields(entry)
  }
  return out as T
}

/**
 * Phone numbers are personal data, so they must not sit in the database in the clear, and a
 * backup dump must not leak them either. Equality lookups run on the digest column, which
 * this layer leaves alone — it only translates the value column, on the way in and out.
 *
 * Both directions are idempotent: a value that already looks like ciphertext is stored as
 * given, and a plain value is returned untouched, so rows written before the conversion
 * script ran keep working and a re-run is a no-op.
 */
const PHONE_WRITE_OPERATIONS = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert'])
// Everything except the operations that hand back a count or an aggregate: create/update/upsert
// return the stored row, so they need the same translation as a read.
const PHONE_ROW_RESULT_OPERATIONS = new Set([
  'findMany', 'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow',
  'create', 'createManyAndReturn', 'update', 'updateManyAndReturn', 'upsert',
  'delete', 'findFirstOrThrow', 'groupRaw',
])

function phoneColumnModel(model?: string): boolean {
  return model === 'User' || model === 'TeamInvite' || model === 'ProjectRecipient'
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
  })
}

const baseClient = createClient().$extends({
  query: {
    $allModels: {
      async $allOperations({ model, args, query, operation }) {
        // Prisma types `args` as the union over every model's argument shape, so the write
        // payload has to be reached through a local view of it.
        const writeArgs = args as { data?: unknown } | undefined
        if (phoneColumnModel(model) && PHONE_WRITE_OPERATIONS.has(operation) && writeArgs?.data !== undefined) {
          args = { ...writeArgs, data: encryptPhoneFields(writeArgs.data) } as typeof args
        }

        const result = await query(args)

        if (phoneColumnModel(model) && PHONE_ROW_RESULT_OPERATIONS.has(operation)) {
          return mapPhoneFields(result, (phone: string) => (looksLikeCipher(phone) ? decryptPhoneValue(phone) : phone))
        }
        return result
      },
    },
  },
})

export const prisma = (globalForPrisma.prisma ?? baseClient) as PrismaClient

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
