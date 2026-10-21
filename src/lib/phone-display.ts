/**
 * Client-safe phone masking. The server-side `maskPhone` reads/decrypts the stored value
 * first; this function is for values already in the page (including already-masked API rows).
 * It deliberately never unmasks: a value containing `*` is returned as-is.
 */
export function maskPhoneDisplay(value: string | null | undefined): string | null {
  if (!value) return null
  if (value.includes('*')) return value
  const digits = value.replace(/\D/g, '')
  const normalized = digits.length >= 13 && digits.startsWith('86') ? digits.slice(2) : digits
  if (normalized.length < 7) return '****'
  return `${normalized.slice(0, 3)}${'*'.repeat(normalized.length - 7)}${normalized.slice(-4)}`
}
