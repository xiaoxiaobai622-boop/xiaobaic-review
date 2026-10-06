// Kept apart from ./locale.ts on purpose: that module reads the configured language from the
// database, and anything importing it drags Prisma — and through lib/db the encryption helpers —
// into the browser bundle. Language pickers only need these two values.

export const SUPPORTED_LOCALES = ['zh', 'en', 'nl', 'de'] as const

export const LOCALE_NAMES: Record<string, string> = {
  zh: '简体中文',
  en: 'English',
  nl: 'Nederlands',
  de: 'Deutsch',
}
