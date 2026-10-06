import { decrypt, encrypt, hmacIndexValue } from './encryption'

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
 * Equality predicate for a stored phone. It can only be the digest: the value column holds
 * AES-GCM output, so a plain comparison against it would match nothing.
 */
export function wherePhone(raw: string | null | undefined): Record<string, unknown> | null {
  const hash = hashPhone(raw)
  return hash ? { phoneHash: hash } : null
}

// A digest nobody can present: callers that must keep one query shape can use this instead of
// branching, so an unusable input matches no row rather than every row.
export const IMPOSSIBLE_PHONE_HASH = '0'.repeat(64)

export function phoneWhereOrNone(raw: string | null | undefined): Record<string, unknown> {
  return wherePhone(raw) ?? { phoneHash: IMPOSSIBLE_PHONE_HASH }
}

// iv:authTag:ciphertext, all hex — the shape encrypt() produces. A phone number can never
// look like this, so the two stored forms are tellable apart without a marker column.
const CIPHER_SHAPE = /^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/i

// The storage layer (src/lib/db.ts) calls these so every read and write is translated in one
// place instead of at each call site.
export function encryptPhoneValue(raw: string): string {
  const normalized = normalizePhone(raw)
  if (!normalized) throw new Error('无法加密的手机号：规范化后为空')
  return encrypt(normalized)
}

export function decryptPhoneValue(stored: string): string {
  return decrypt(stored)
}

/** Write payload for the stored value plus its digest. Clearing either clears both. */
export function phoneStoreFields(raw: string | null | undefined): { phone: string | null; phoneHash: string | null } {
  const normalized = normalizePhone(raw)
  if (!normalized) return { phone: null, phoneHash: null }
  return { phone: encrypt(normalized), phoneHash: hashPhone(normalized) }
}

/**
 * Readable form of a stored phone. Rows converted before this change hold plain digits, so an
 * unrecognized shape is returned untouched rather than sent to decrypt(), which would throw.
 */
export function readPhone(stored: string | null | undefined): string | null {
  if (!stored) return null
  return CIPHER_SHAPE.test(stored) ? decrypt(stored) : stored
}

/**
 * What the interface shows by default: first three digits and the last four. Revealing the
 * whole number is a separate, audited call, so this is the only form that reaches a list.
 */
export function maskPhone(stored: string | null | undefined): string | null {
  const plain = readPhone(stored)
  if (!plain) return null
  // 过渡期库里可能还留着带 +86 或空格的老写法，掩码前先归一到和摘要同一个形状。
  const digits = normalizePhone(plain) ?? plain.replace(/\D/g, '')
  if (digits.length < 7) return '****'
  return `${digits.slice(0, 3)}${'*'.repeat(digits.length - 7)}${digits.slice(-4)}`
}

/**
 * Response shaping for a row that carries a `phone` column. Lists hand back the masked form;
 * the full number leaves the server only through the audited reveal endpoints. Rows the viewer
 * is looking at for themselves keep the plaintext, so self-service pages still work.
 */
export function withMaskedPhone<T extends { phone?: string | null }>(row: T): T {
  return { ...row, phone: maskPhone(row.phone) }
}

