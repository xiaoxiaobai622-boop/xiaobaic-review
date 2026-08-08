import { prisma } from '@/lib/db'

export const SUPPORTED_LOCALES = ['zh', 'en', 'nl', 'de'] as const

export const LOCALE_NAMES: Record<string, string> = {
  zh: '简体中文',
  en: 'English',
  nl: 'Nederlands',
  de: 'Deutsch',
}

/**
 * Get the configured language from the database.
 * Falls back to Chinese if not set or on error.
 */
export async function getConfiguredLocale(): Promise<string> {
  try {
    const settings = await prisma.settings.findUnique({
      where: { id: 'default' },
      select: { language: true },
    })
    return settings?.language || 'zh'
  } catch {
    return 'zh'
  }
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

