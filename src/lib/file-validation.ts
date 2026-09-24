import { logMessage } from './logging'

// Allowed video MIME types
const ALLOWED_VIDEO_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/webm',
  'video/x-matroska',
  'video/avi'
]

// File configuration
export const FILE_LIMITS = {
  ALLOWED_EXTENSIONS: ['.mp4', '.mov', '.avi', '.webm', '.mkv']
}

// Allowed asset types by category
export const ALLOWED_ASSET_TYPES = {
  image: {
    // SVG intentionally excluded - can contain embedded JavaScript/XSS payloads
    extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'],
    mimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff']
  },
  thumbnail: {
    extensions: ['.jpg', '.jpeg', '.png'],
    mimeTypes: ['image/jpeg', 'image/png']
  },
  audio: {
    extensions: ['.mp3', '.wav', '.aac', '.flac', '.ogg', '.m4a', '.wma'],
    mimeTypes: ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/aac', 'audio/flac', 'audio/ogg', 'audio/mp4', 'audio/x-ms-wma']
  },
  video: {
    extensions: ['.mp4', '.mov', '.avi', '.mkv', '.mxf', '.prores'],
    mimeTypes: ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/webm', 'application/octet-stream']
  },
  subtitle: {
    extensions: ['.srt', '.vtt', '.ass', '.ssa', '.sub'],
    mimeTypes: ['text/plain', 'text/vtt', 'application/x-subrip', 'application/octet-stream']
  },
  project: {
    extensions: ['.prproj', '.aep', '.fcp', '.drp', '.drt', '.dra', '.zip', '.rar', '.7z'],
    mimeTypes: ['application/octet-stream', 'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed']
  },
  document: {
    extensions: ['.pdf', '.doc', '.docx', '.txt', '.rtf'],
    mimeTypes: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'application/rtf']
  },
  other: {
    extensions: ['.zip', '.rar', '.7z', '.tar', '.gz'],
    mimeTypes: ['application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed', 'application/x-tar', 'application/gzip']
  }
}

/**
 * Validate file extension
 */
function validateFileExtension(filename: string): boolean {
  if (!filename || typeof filename !== 'string') {
    return false
  }

  const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'))
  return FILE_LIMITS.ALLOWED_EXTENSIONS.includes(ext)
}

/**
 * Validate MIME type
 */
function validateMimeType(mimeType: string): boolean {
  if (!mimeType || typeof mimeType !== 'string') {
    return false
  }

  return ALLOWED_VIDEO_TYPES.includes(mimeType.toLowerCase())
}


/**
 * 展示名进 DB（文本列，255 字符就够），对象键要当文件名用：
 * 存储路径的文件名段还会拼上 `client-<时间戳>-` / `original-<时间戳>-` 这类前缀，
 * 而本地磁盘 NAME_MAX 是 255 **字节**（macOS/Linux 同名），所以键必须留出余量，
 * 否则 TUS 收尾的 rename 会 ENAMETOOLONG —— 建档成功、字节永远落不了地。
 */
const DISPLAY_FILENAME_MAX_LENGTH = 255
const STORAGE_KEY_MAX_LENGTH = 200

/** 截断并保留扩展名；无扩展名（或扩展名本身超长）时退化为纯截断 */
function truncatePreservingExtension(value: string, max: number): string {
  if (value.length <= max) return value
  const dot = value.lastIndexOf('.')
  const ext = dot > 0 ? value.slice(dot) : ''
  if (ext.length >= max) return value.slice(0, max)
  return value.slice(0, max - ext.length) + ext
}

/**
 * Sanitize filename to prevent path traversal and other attacks
 */
export function sanitizeDisplayFilename(filename: string): string {
  if (!filename || typeof filename !== 'string') {
    return 'upload.bin'
  }
  
  // Remove any path components (/, \, :)
  let safe = filename.split(/[/\\:]+/).pop() || 'upload'
  
  // Remove null bytes
  safe = safe.replace(/\x00/g, '')
  
  // Remove control characters
  safe = safe.replace(/[\x00-\x1F\x7F]/g, '')
  
  // Remove leading/trailing dots and spaces
  while (safe.length > 0 && (safe[0] === '.' || safe[0] === ' ')) safe = safe.slice(1)
  while (safe.length > 0 && (safe[safe.length - 1] === '.' || safe[safe.length - 1] === ' ')) safe = safe.slice(0, -1)
  
  // Prevent directory traversal
  safe = safe.replace(/\.\./g, '')
  
  // Limit length while preserving extension
  safe = truncatePreservingExtension(safe, DISPLAY_FILENAME_MAX_LENGTH)
  
  // Ensure not empty and not just dots
  if (!safe || safe === '.' || safe === '..') {
    safe = 'upload.bin'
  }
  
  return safe
}

export function sanitizeFilename(filename: string): string {
  // Storage paths remain ASCII-only; the original Unicode display name is
  // stored separately so users see exactly what they uploaded.
  const ascii = sanitizeDisplayFilename(filename).replace(/[^a-zA-Z0-9._-]/g, '_')
  return truncatePreservingExtension(ascii, STORAGE_KEY_MAX_LENGTH)
}

/**
 * Check if filename is suspicious
 */
export function isSuspiciousFilename(filename: string): boolean {
  const suspiciousPatterns = [
    /\.exe$/i,
    /\.sh$/i,
    /\.bat$/i,
    /\.cmd$/i,
    /\.com$/i,
    /\.scr$/i,
    /\.pif$/i,
    /\.app$/i,
    /\.deb$/i,
    /\.rpm$/i,
    /\.dmg$/i,
    /\.pkg$/i,
    /\.php$/i,
    /\.asp$/i,
    /\.jsp$/i,
    /\.js$/i,
    /\.vbs$/i,
    /\.ws$/i,
    /\.wsf$/i,
    /\.svg$/i,  // SVG can contain embedded JavaScript/XSS
    /\.svgz$/i, // Compressed SVG
    /\.html?$/i, // HTML files
    /\.xml$/i,  // XML files (potential XXE)
    /\.\./,  // Directory traversal
    /^\.ht/,  // .htaccess, .htpasswd
    /^\.env/, // Environment files
  ]
  
  return suspiciousPatterns.some(pattern => pattern.test(filename))
}

/**
 * Comprehensive file validation
 */
export function validateUploadedFile(
  filename: string,
  mimeType: string,
  _size: number
): { valid: boolean; error?: string; sanitizedFilename?: string } {
  // Sanitize filename first
  const sanitizedFilename = sanitizeFilename(filename)

  if (isSuspiciousFilename(filename)) {
    return {
      valid: false,
      error: 'Filename contains suspicious patterns'
    }
  }

  if (!validateFileExtension(sanitizedFilename)) {
    return {
      valid: false,
      error: `Invalid file type. Allowed: ${FILE_LIMITS.ALLOWED_EXTENSIONS.join(', ')}`
    }
  }

  if (!validateMimeType(mimeType)) {
    return {
      valid: false,
      error: `Invalid MIME type. Allowed: ${ALLOWED_VIDEO_TYPES.join(', ')}`
    }
  }

  return {
    valid: true,
    sanitizedFilename
  }
}

/**
 * Validate asset file (images, audio, documents, etc.)
 */
export function validateAssetFile(
  filename: string,
  mimeType: string,
  category?: string
): { valid: boolean; error?: string; sanitizedFilename?: string; detectedCategory?: string } {
  // Sanitize filename first
  const sanitizedFilename = sanitizeFilename(filename)

  if (isSuspiciousFilename(filename)) {
    return {
      valid: false,
      error: 'Filename contains suspicious patterns'
    }
  }

  const ext = sanitizedFilename.toLowerCase().slice(sanitizedFilename.lastIndexOf('.'))

  if (category && category in ALLOWED_ASSET_TYPES) {
    const categoryConfig = ALLOWED_ASSET_TYPES[category as keyof typeof ALLOWED_ASSET_TYPES]

    if (!categoryConfig.extensions.includes(ext)) {
      return {
        valid: false,
        error: `Invalid file type for ${category}. Allowed: ${categoryConfig.extensions.join(', ')}`
      }
    }

    // Check MIME type - accept if it matches OR if it's a generic binary type
    // SECURITY: We allow generic MIME types here because:
    // 1. Browser MIME detection can be unreliable
    // 2. Worker performs strict magic byte validation (defense-in-depth)
    // 3. Suspicious extensions are still blocked above
    const normalizedMime = mimeType.toLowerCase()
    if (!categoryConfig.mimeTypes.includes(normalizedMime) &&
        normalizedMime !== 'application/octet-stream') {
      // Log the actual MIME type for debugging
      logMessage(`[FILE-VALIDATION] Extension ${ext} matched ${category}, but MIME type ${mimeType} did not match. Worker will validate via magic bytes.`)
      logMessage(`[FILE-VALIDATION] Allowed MIME types: ${categoryConfig.mimeTypes.join(', ')}`)
      return {
        valid: false,
        error: `Invalid MIME type for ${category}. Received: ${mimeType}. Allowed: ${categoryConfig.mimeTypes.join(', ')}`
      }
    }

    return {
      valid: true,
      sanitizedFilename,
      detectedCategory: category
    }
  }

  // SECURITY: Extension-based detection is acceptable here because:
  // 1. Worker performs strict magic byte validation (defense-in-depth)
  // 2. Suspicious extensions (.exe, .sh, etc.) are blocked above
  for (const [cat, config] of Object.entries(ALLOWED_ASSET_TYPES)) {
    if (config.extensions.includes(ext)) {
      return {
        valid: true,
        sanitizedFilename,
        detectedCategory: cat
      }
    }
  }

  // If extension didn't match, try MIME type
  for (const [cat, config] of Object.entries(ALLOWED_ASSET_TYPES)) {
    if (config.mimeTypes.includes(mimeType.toLowerCase())) {
      return {
        valid: true,
        sanitizedFilename,
        detectedCategory: cat
      }
    }
  }

  return {
    valid: false,
    error: `Unsupported file type: ${ext}. Please upload images, audio, documents, or project files.`
  }
}

// Allowed photo types for photo albums (browser-displayable + sharp-supported)
// SVG intentionally excluded - can contain embedded JavaScript/XSS payloads
export const ALLOWED_PHOTO_TYPES = {
  extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif'],
  mimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']
}

/**
 * Validate photo file for photo albums
 */
export function validatePhotoFile(
  filename: string,
  mimeType: string
): { valid: boolean; error?: string; sanitizedFilename?: string } {
  const sanitizedFilename = sanitizeFilename(filename)

  if (isSuspiciousFilename(filename)) {
    return {
      valid: false,
      error: 'Filename contains suspicious patterns'
    }
  }

  const ext = sanitizedFilename.toLowerCase().slice(sanitizedFilename.lastIndexOf('.'))

  if (!ALLOWED_PHOTO_TYPES.extensions.includes(ext)) {
    return {
      valid: false,
      error: `Invalid photo type. Allowed: ${ALLOWED_PHOTO_TYPES.extensions.join(', ')}`
    }
  }

  // Accept generic binary MIME — worker performs strict magic byte validation
  const normalizedMime = mimeType.toLowerCase()
  if (!ALLOWED_PHOTO_TYPES.mimeTypes.includes(normalizedMime) &&
      normalizedMime !== 'application/octet-stream') {
    return {
      valid: false,
      error: `Invalid MIME type for photo. Received: ${mimeType}`
    }
  }

  return {
    valid: true,
    sanitizedFilename
  }
}

/**
 * Sanitize a MIME content-type string.
 * Strips parameters (e.g. "; charset=utf-8") and lowercases.
 * Returns 'application/octet-stream' for empty/invalid input.
 */
export function sanitizeContentType(raw: string | undefined | null): string {
  if (!raw || typeof raw !== 'string') return 'application/octet-stream'
  const base = raw.split(';')[0].trim().toLowerCase()
  if (!base || !/^[a-z0-9][a-z0-9!#$&\-^_]*\/[a-z0-9][a-z0-9!#$&\-^_.+]*$/.test(base)) {
    return 'application/octet-stream'
  }
  return base
}

/**
 * Marks a Photo/VideoAsset row whose stored bytes are permanently unusable
 * (wrong magic bytes, or a header that decodes to nothing). The format is
 * load-bearing: `src/worker/backfill.ts` selects rows via
 * `fileType: { startsWith: 'INVALID' }`, so writer and readers must agree.
 */
const INVALID_FILE_TYPE_PREFIX = 'INVALID - '

export function markInvalidFileType(detected: string): string {
  return `${INVALID_FILE_TYPE_PREFIX}${detected}`
}

export function isInvalidFileType(fileType: string | null | undefined): boolean {
  return !!fileType && fileType.startsWith(INVALID_FILE_TYPE_PREFIX)
}
