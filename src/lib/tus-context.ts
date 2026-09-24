/**
 * Generate TUS fingerprint for a file
 * TUS format: tus-br-{name}-{type}-{size}-{lastModified}-{endpoint}
 */
function generateFileFingerprint(file: File, endpoint?: string): string {
  const tusEndpoint = endpoint || (typeof window !== 'undefined' ? `${window.location.origin}/api/uploads` : '/api/uploads')
  return ['tus-br', file.name, file.type, file.size, file.lastModified, tusEndpoint].join('-')
}

const UPLOAD_META_PREFIX = 'vitransfer-upload:'
const CONTEXT_PREFIX = 'vitransfer-context:'

export interface StoredUploadMetadata {
  videoId: string
  projectId?: string
  assetId?: string
  versionLabel?: string
  category?: string
  targetName?: string
  createdAt: number
}

function getUploadMetadataKey(file: File, endpoint?: string): string {
  const fingerprint = generateFileFingerprint(file, endpoint)
  return `${UPLOAD_META_PREFIX}${fingerprint}`
}

/**
 * Get TUS fingerprint key for a file
 * TUS stores with keys like: "tus::{fingerprint}::..."
 */
function getTUSFingerprintKey(file: File, endpoint?: string): string | null {
  const fingerprint = generateFileFingerprint(file, endpoint)

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith('tus::') && key.includes(fingerprint)) {
      return key
    }
  }

  return null
}

/**
 * Clear TUS fingerprint for a file
 */
export function clearTUSFingerprint(file: File): void {
  try {
    const key = getTUSFingerprintKey(file)
    if (key) {
      localStorage.removeItem(key)
    }
  } catch {
    // Silent failure
  }
}

function getContextKey(file: File): string {
  return `${CONTEXT_PREFIX}${generateFileFingerprint(file)}`
}

/**
 * Store context (videoId/projectId) for a file
 */
export function storeFileContext(file: File, context: string): void {
  try {
    localStorage.setItem(getContextKey(file), context)
  } catch {
    // Silent failure
  }
}

/**
 * Get stored context for a file
 */
export function getFileContext(file: File): string | null {
  try {
    return localStorage.getItem(getContextKey(file))
  } catch {
    return null
  }
}

/**
 * Clear file context (call on upload success)
 */
export function clearFileContext(file: File): void {
  try {
    localStorage.removeItem(getContextKey(file))
  } catch {
    // Silent failure
  }
}

/**
 * Check if file context has changed and clear TUS if needed
 */
export function ensureFreshUploadOnContextChange(file: File, newContext: string): void {
  const lastContext = getFileContext(file)

  if (lastContext && lastContext !== newContext) {
    clearTUSFingerprint(file)
    clearUploadMetadata(file)
  }

  storeFileContext(file, newContext)
}

/**
 * Store upload metadata so we can resume with the same video record after refresh
 */
export function storeUploadMetadata(
  file: File,
  metadata: Omit<StoredUploadMetadata, 'createdAt'>,
  endpoint?: string
): void {
  try {
    const key = getUploadMetadataKey(file, endpoint)
    const payload: StoredUploadMetadata = {
      ...metadata,
      createdAt: Date.now(),
    }
    localStorage.setItem(key, JSON.stringify(payload))
  } catch {
    // Silent failure
  }
}

/**
 * Get stored upload metadata for a file (clears stale entries older than 7 days)
 */
export function getUploadMetadata(file: File, endpoint?: string): StoredUploadMetadata | null {
  try {
    const key = getUploadMetadataKey(file, endpoint)
    const raw = localStorage.getItem(key)
    if (!raw) return null

    const metadata = JSON.parse(raw) as StoredUploadMetadata
    const oneWeekMs = 7 * 24 * 60 * 60 * 1000

    if (!metadata?.videoId) {
      localStorage.removeItem(key)
      return null
    }

    if (metadata.createdAt && Date.now() - metadata.createdAt > oneWeekMs) {
      localStorage.removeItem(key)
      return null
    }

    return metadata
  } catch {
    return null
  }
}

/**
 * Clear upload metadata for a file
 */
export function clearUploadMetadata(file: File, endpoint?: string): void {
  try {
    const key = getUploadMetadataKey(file, endpoint)
    localStorage.removeItem(key)
  } catch {
    // Silent failure
  }
}
