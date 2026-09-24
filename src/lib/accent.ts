/**
 * The accent colour an admin picks in 平台设置 → 外观. Stored verbatim in
 * `Settings.accentColor`, which is a free string column: either one of the
 * preset keys below or a custom `#rrggbb`.
 *
 * Every surface that paints the accent has to resolve through here — the CSS
 * variables on the client, the transactional emails, the generated logo — so
 * the preset list and the hex table live in one file instead of five.
 */

export const ACCENT_PRESET_KEYS = [
  'blue', 'purple', 'green', 'orange', 'red', 'pink', 'teal', 'amber', 'stone', 'gold',
] as const

export type AccentPresetKey = (typeof ACCENT_PRESET_KEYS)[number]

export const ACCENT_PRESET_HEX: Record<AccentPresetKey, string> = {
  blue: '#007AFF',
  purple: '#8B5CF6',
  green: '#22C55E',
  orange: '#F97316',
  red: '#EF4444',
  pink: '#EC4899',
  teal: '#14B8A6',
  amber: '#F59E0B',
  stone: '#9d9487',
  gold: '#DEC091',
}

const CUSTOM_ACCENT = /^#[0-9a-f]{6}$/i
const FALLBACK_HEX = ACCENT_PRESET_HEX.blue

export function isCustomAccentColor(value: string | null | undefined): boolean {
  return typeof value === 'string' && CUSTOM_ACCENT.test(value)
}

/** What the settings API will accept. Anything else is a bad request. */
export function isValidAccentColor(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return isCustomAccentColor(value) || (ACCENT_PRESET_KEYS as readonly string[]).includes(value)
}

/** Preset key or custom hex both resolve to a hex; garbage falls back to blue. */
export function accentToHex(value: string | null | undefined): string {
  if (isCustomAccentColor(value)) return value as string
  return ACCENT_PRESET_HEX[value as AccentPresetKey] ?? FALLBACK_HEX
}

/**
 * Cache filename for a generated default logo. A raw `#rrggbb` is not a safe
 * path segment, so custom colours are stored as `custom-rrggbb`.
 */
export function accentCacheKey(value: string | null | undefined): string {
  if (isCustomAccentColor(value)) return `custom-${(value as string).slice(1).toLowerCase()}`
  return (ACCENT_PRESET_KEYS as readonly string[]).includes(value as string) ? (value as string) : 'blue'
}

function toRgbChannels(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!match) return null
  return [
    parseInt(match[1], 16) / 255,
    parseInt(match[2], 16) / 255,
    parseInt(match[3], 16) / 255,
  ]
}

/** `#dff0e9` → `155 36% 91%`, the triplet form the CSS custom properties use. */
export function hexToHslTriplet(hex: string): string {
  const channels = toRgbChannels(hex)
  if (!channels) return '211 100% 50%'
  const [r, g, b] = channels
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  const lightness = (max + min) / 2
  if (delta === 0) return `0 0% ${Math.round(lightness * 100)}%`
  const hue = max === r
    ? ((g - b) / delta) % 6
    : max === g
      ? (b - r) / delta + 2
      : (r - g) / delta + 4
  const degrees = (hue * 60 + 360) % 360
  const saturation = delta / (1 - Math.abs(2 * lightness - 1))
  return `${Math.round(degrees)} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%`
}

/**
 * WCAG ratio of a white label sitting on the accent — the pairing every
 * `bg-primary text-primary-foreground` button makes. AA for body text is 4.5.
 */
export function whiteOnAccentRatio(hex: string): number {
  const channels = toRgbChannels(hex)
  if (!channels) return 1
  const [r, g, b] = channels.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return 1.05 / (luminance + 0.05)
}
