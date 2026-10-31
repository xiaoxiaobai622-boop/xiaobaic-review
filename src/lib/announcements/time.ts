const BEIJING_TZ = 'Asia/Shanghai'

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BEIJING_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const minuteFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BEIJING_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function partsOf(formatter: Intl.DateTimeFormat, date: Date): Record<string, string> {
  const result: Record<string, string> = {}
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') result[part.type] = part.value
  }
  return result
}

/**
 * Test-only clock override. Production always uses the wall clock; the guard is
 * here so a stray environment variable can never freeze real announcements.
 */
export function announcementNow(): Date {
  const override = process.env.ANNOUNCEMENTS_NOW
  if (override && process.env.NODE_ENV !== 'production') {
    const parsed = new Date(override)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return new Date()
}

/** YYYY-MM-DD in Beijing, the single timezone all announcement stats use. */
export function beijingDayKey(date: Date = announcementNow()): string {
  const parts = partsOf(dayFormatter, date)
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function startOfBeijingDay(date: Date = announcementNow()): Date {
  return new Date(`${beijingDayKey(date)}T00:00:00+08:00`)
}

export function endOfBeijingDay(date: Date = announcementNow()): Date {
  return new Date(startOfBeijingDay(date).getTime() + 24 * 60 * 60 * 1000 - 1)
}

/** `<input type="datetime-local">` value in Beijing time. */
export function toBeijingInputValue(date: Date | string | null | undefined): string {
  if (!date) return ''
  const value = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(value.getTime())) return ''
  const parts = partsOf(minuteFormatter, value)
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

/**
 * Parse a Beijing wall-clock value from `datetime-local`. Rejects dates that JS
 * would silently normalise (e.g. 2026-02-31) instead of shifting them.
 */
export function fromBeijingInputValue(value: string | null | undefined): Date | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const parsed = new Date(`${value.trim()}:00+08:00`)
  if (Number.isNaN(parsed.getTime())) return null
  if (toBeijingInputValue(parsed) !== value.trim()) return null
  return parsed
}

export function fromIsoOrNull(value: string | null | undefined): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000)
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

export function cutoffForActiveStatus(value: string, now: Date = announcementNow()): Date | null {
  if (value === 'ACTIVE_7D' || value === 'INACTIVE_7D') return addDays(now, -7)
  if (value === 'ACTIVE_30D' || value === 'INACTIVE_30D') return addDays(now, -30)
  return null
}

export { BEIJING_TZ }
