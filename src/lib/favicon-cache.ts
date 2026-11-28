import { prisma } from '@/lib/db'

const CONFIGURED_FAVICON_CACHE_TTL_MS = 60_000
let configuredFaviconCache: { value: string | null; expiresAt: number } | null = null
let configuredFaviconInflight: Promise<string | null> | null = null
let configuredFaviconGeneration = 0

/** Clear the process-local favicon cache after branding settings change. */
export function invalidateConfiguredFaviconCache(): void {
  configuredFaviconCache = null
  configuredFaviconGeneration += 1
  configuredFaviconInflight = null
}

/**
 * Get the configured custom favicon path with a short process-local TTL cache.
 * Falls back to null on database errors without caching the failure.
 */
export async function getConfiguredFaviconPath(): Promise<string | null> {
  const now = Date.now()
  if (configuredFaviconCache && configuredFaviconCache.expiresAt > now) {
    return configuredFaviconCache.value
  }

  if (configuredFaviconInflight) return configuredFaviconInflight

  const requestGeneration = configuredFaviconGeneration
  const loadPromise = (async () => {
    try {
      const row = await prisma.settings.findUnique({
        where: { id: 'default' },
        select: { brandingFaviconPath: true },
      })
      const value = row?.brandingFaviconPath || null
      if (configuredFaviconGeneration === requestGeneration) {
        configuredFaviconCache = {
          value,
          expiresAt: Date.now() + CONFIGURED_FAVICON_CACHE_TTL_MS,
        }
      }
      return value
    } catch {
      return null
    }
  })()

  configuredFaviconInflight = loadPromise
  const clearInflight = () => {
    if (configuredFaviconInflight === loadPromise) configuredFaviconInflight = null
  }
  void loadPromise.then(clearInflight, clearInflight)
  return loadPromise
}
