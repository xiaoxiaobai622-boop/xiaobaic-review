import { hmacIndexValue } from './encryption'

// Phone numbers are personal data that must not sit in the database as plain text, but they
// are also looked up by equality (login, "this number is already bound", recipient portals).
// AES-GCM gives a different ciphertext per write, so equality moves to this keyed digest.
const PHONE_DOMAIN = 'vidx.phone.index'

/**
 * Canonical form for the index: digits only, optional mainland-China prefix dropped, so the
 * same number typed as `138…`, `+86138…` or `138-…` collides on one hash.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const digits = raw.replace(/[\s().-]/g, '').replace(/[^\d+]/g, '')
  if (!digits) return null
  const bare = digits.replace(/^\+?0?86(?=1\d{10}$)/, '')
  return bare || null
}

export function hashPhone(raw: string | null | undefined): string | null {
  const normalized = normalizePhone(raw)
  return normalized ? hmacIndexValue(normalized, PHONE_DOMAIN) : null
}

/** Write payload for the digest column. Clearing the number must clear the digest too. */
export function phoneHashField(raw: string | null | undefined): { phoneHash: string | null } {
  return { phoneHash: hashPhone(raw) }
}

/**
 * Predicate matching a phone number whether or not the row has been backfilled yet. During
 * the transition both arms are needed: rows written before this change only carry plaintext,
 * and rows written after carry both. Once the plaintext column is dropped the second arm goes
 * away with it.
 */
export function wherePhone(raw: string | null | undefined): Record<string, unknown> | null {
  const normalized = normalizePhone(raw)
  if (!normalized) return null
  const hash = hashPhone(normalized)
  return hash ? { OR: [{ phoneHash: hash }, { phone: normalized }] } : null
}

// A digest nobody can present: callers that must keep one query shape can use this instead of
// branching, so an unusable input matches no row rather than every row.
export const IMPOSSIBLE_PHONE_HASH = '0'.repeat(64)

export function phoneWhereOrNone(raw: string | null | undefined): Record<string, unknown> {
  return wherePhone(raw) ?? { phoneHash: IMPOSSIBLE_PHONE_HASH }
}
