/**
 * Pure helpers for file names that leave the system: HTTP Content-Disposition
 * headers and ZIP entry names. Kept free of storage/network imports so both
 * src/lib/storage.ts and src/lib/s3-storage.ts can depend on it.
 */

/** Strip characters unsafe in Content-Disposition headers (CRLF injection, non-ASCII). */
export function sanitizeFilenameForHeader(filename: string): string {
  if (!filename) return 'download.mp4'

  return filename
    .replace(/["\\]/g, '')         // Remove quotes and backslashes
    .replace(/[\r\n]/g, '')        // Remove CRLF (header injection)
    .replace(/[^\x20-\x7E]/g, '_') // Replace non-ASCII with underscore
    .substring(0, 255)             // Limit length to 255 characters
    .trim() || 'download.mp4'      // Fallback if empty after sanitization
}

/**
 * Content-Disposition for a forced download. Browsers implementing RFC 5987 take
 * the UTF-8 name, so non-ASCII titles survive; the ASCII-sanitized variant keeps
 * older clients working. Pass the raw name — sanitizing beforehand would put the
 * already-mangled name into the UTF-8 part too.
 */
export function contentDispositionAttachment(filename: string): string {
  // A saved file name can never carry directory information; flattening the
  // separators here keeps the ASCII and UTF-8 forms describing one same name.
  const name = filename.replace(/[/\\\x00-\x1f]/g, '_') || 'download.mp4'
  // RFC 5987 attr-char excludes ! ' ( ) * , which encodeURIComponent leaves alone.
  const encoded = encodeURIComponent(name).replace(
    /[!'()*]/g,
    (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase(),
  )
  return `attachment; filename="${sanitizeFilenameForHeader(name)}"; filename*=UTF-8''${encoded}`
}

/** Characters that Windows/macOS filesystems reject inside a ZIP entry name. */
const ZIP_UNSAFE_CHARS = /[\\/:*?"<>|\x00-\x1f]/g

/**
 * Build a ZIP entry name that is safe to extract on Windows and macOS, and that
 * stays unique inside the archive. `taken` is mutated so callers can share one
 * set across all entries of a single ZIP.
 */
export function buildZipEntryName(
  taken: Set<string>,
  name: string,
  versionLabel: string,
  fileName: string,
): string {
  const extension = fileName?.match(/\.[^.]+$/)?.[0] || '.mp4'
  const base = `${(name || 'video').replace(ZIP_UNSAFE_CHARS, '_')}_${versionLabel}`.slice(0, 120)

  let candidate = `${base}${extension}`
  let suffix = 2
  while (taken.has(candidate)) {
    candidate = `${base} (${suffix++})${extension}`
  }
  taken.add(candidate)
  return candidate
}
