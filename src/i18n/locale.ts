import { prisma } from '@/lib/db'

export const SUPPORTED_LOCALES = ['zh', 'en', 'nl', 'de'] as const

export const LOCALE_NAMES: Record<string, string> = {
  zh: '简体中文',
  en: 'English',
  nl: 'Nederlands',
  de: 'Deutsch',
}

// The configured locale is read on nearly every API request. Keep the value
// process-local for a short period while coalescing concurrent cache misses.
// A short TTL keeps admin language changes reasonably fresh without putting a
// Prisma query on the content-delivery hot path for every request.
const CONFIGURED_LOCALE_CACHE_TTL_MS = 60_000
let configuredLocaleCache: { value: string; expiresAt: number } | null = null
let configuredLocaleInflight: Promise<string> | null = null
let configuredLocaleGeneration = 0

/** Clear the process-local locale cache after the setting is changed. */
export function invalidateConfiguredLocaleCache(): void {
  configuredLocaleCache = null
  configuredLocaleGeneration += 1
  // Let the next caller issue a fresh lookup instead of waiting on a query
  // that started before the setting changed.
  configuredLocaleInflight = null
}

/**
 * Get the configured language from the database.
 * Falls back to Chinese if not set or on error.
 */
export async function getConfiguredLocale(): Promise<string> {
  const now = Date.now()
  if (configuredLocaleCache && configuredLocaleCache.expiresAt > now) {
    return configuredLocaleCache.value
  }

  // Multiple requests commonly arrive together during a page load. Share one
  // database lookup instead of allowing every request to miss independently.
  if (configuredLocaleInflight) return configuredLocaleInflight

  const requestGeneration = configuredLocaleGeneration
  const loadPromise = (async () => {
    try {
      const settings = await prisma.settings.findUnique({
        where: { id: 'default' },
        select: { language: true },
      })
      const value = settings?.language || 'zh'
      if (configuredLocaleGeneration === requestGeneration) {
        configuredLocaleCache = {
          value,
          expiresAt: Date.now() + CONFIGURED_LOCALE_CACHE_TTL_MS,
        }
      }
      return value
    } catch {
      // Preserve the existing fallback behavior. Do not cache an error so a
      // transient database outage can recover on the next request.
      return 'zh'
    }
  })()

  configuredLocaleInflight = loadPromise
  void loadPromise.then(
    () => {
      if (configuredLocaleInflight === loadPromise) configuredLocaleInflight = null
    },
    () => {
      if (configuredLocaleInflight === loadPromise) configuredLocaleInflight = null
    },
  )
  return loadPromise
}

/**
 * Load locale messages for server-side use (e.g., email templates).
 * Returns the full messages object for the given locale.
 */
export async function loadLocaleMessages(locale: string): Promise<Record<string, any>> {
  const english = (await import('../locales/en.json')).default as Record<string, any>

  if (locale === 'en') return english

  try {
    const localized = (await import(`../locales/${locale}.json`)).default as Record<string, any>
    return deepMerge(english, localized)
  } catch {
    return english
  }
}

function deepMerge(base: Record<string, any>, override: Record<string, any>): Record<string, any> {
  const result = { ...base }

  for (const [key, value] of Object.entries(override)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      result[key] &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key], value)
    } else {
      result[key] = value
    }
  }

  return result
}
