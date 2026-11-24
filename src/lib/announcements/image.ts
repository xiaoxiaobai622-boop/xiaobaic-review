export const ANNOUNCEMENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const ANNOUNCEMENT_IMAGE_MAX_LABEL = '5 MB'

export const ANNOUNCEMENT_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.avif'] as const

export const ANNOUNCEMENT_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
] as const

export const ANNOUNCEMENT_IMAGE_ACCEPT = ANNOUNCEMENT_IMAGE_MIME_TYPES.join(',')
export const ANNOUNCEMENT_IMAGE_ACCEPT_LABEL = 'JPG / PNG / WebP / AVIF'

export type AnnouncementImageMime = (typeof ANNOUNCEMENT_IMAGE_MIME_TYPES)[number]
export type AnnouncementImageExtension = 'jpg' | 'png' | 'webp' | 'avif'

const EXTENSION_BY_MIME: Record<AnnouncementImageMime, AnnouncementImageExtension> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
}

const MIME_BY_EXTENSION: Record<AnnouncementImageExtension, AnnouncementImageMime> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
}

/** Storage prefix; the public route only serves keys below `announcements/`. */
export const ANNOUNCEMENT_IMAGE_STORAGE_PREFIX = 'announcements'

/**
 * Anonymous read URL for an uploaded release image. The app route streams the
 * bytes from the existing storage provider, so a private bucket does not need
 * to be made public and the URL never expires like a presigned link would.
 */
export function announcementImageUrl(publicKey: string): string {
  return `/api/announcements/images/${publicKey.split('/').map(encodeURIComponent).join('/')}`
}

export function announcementImageStorageKey(publicKey: string): string {
  return `${ANNOUNCEMENT_IMAGE_STORAGE_PREFIX}/${publicKey}`
}

export function isAnnouncementImageMime(value: unknown): value is AnnouncementImageMime {
  return typeof value === 'string' && (ANNOUNCEMENT_IMAGE_MIME_TYPES as readonly string[]).includes(value)
}

export function announcementImageExtensionForMime(mime: string): AnnouncementImageExtension | null {
  return isAnnouncementImageMime(mime) ? EXTENSION_BY_MIME[mime] : null
}

export function announcementImageContentType(publicKey: string): AnnouncementImageMime | null {
  const ext = publicKey.slice(publicKey.lastIndexOf('.') + 1).toLowerCase()
  return ext in MIME_BY_EXTENSION ? MIME_BY_EXTENSION[ext as AnnouncementImageExtension] : null
}

const PUBLIC_KEY_PATTERN = /^whats-new\/\d{8}-\d{6}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|avif)$/

export function isAnnouncementImagePublicKey(value: string): boolean {
  return PUBLIC_KEY_PATTERN.test(value)
}

/** `20261124-131500-<uuid>.jpg`; unique per upload and never reuses a client filename. */
export function buildAnnouncementImagePublicKey(
  extension: AnnouncementImageExtension,
  now: Date = new Date(),
): string {
  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const date = stamp.slice(0, 8)
  const time = stamp.slice(8, 14)
  return `whats-new/${date}-${time}-${crypto.randomUUID()}.${extension}`
}