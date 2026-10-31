function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * CTA/image links may be http(s) or an in-site absolute path. Protocol-relative
 * `//host` and backslash variants are rejected so a link cannot silently point
 * off-site, and `javascript:`/`data:` never reach an href or src.
 */
export function isSafeAnnouncementUrl(value: string | null | undefined): boolean {
  if (!value) return true
  const trimmed = value.trim()
  if (!trimmed) return true
  if (trimmed.includes('\\')) return false
  if (trimmed.startsWith('/')) return !trimmed.startsWith('//')
  return isHttpUrl(trimmed)
}

export function normalizeOptionalUrl(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export function isExternalUrl(value: string | null | undefined): boolean {
  if (!value) return false
  const trimmed = value.trim()
  return /^https?:\/\//i.test(trimmed)
}
