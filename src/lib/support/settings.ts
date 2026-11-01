import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { SUPPORT_LOCALES, type SupportLocale } from './constants'

export type SupportBusinessHours = {
  timezone: string
  weekdays: number[]
  start: string
  end: string
}

export type SupportFallbackContacts = {
  wechatImage?: string | null
  email?: string | null
  feishu?: string | null
}

export type SupportQuietHours = {
  enabled: boolean
  start: string
  end: string
  timezone: string
}

const DEFAULT_BUSINESS_HOURS: SupportBusinessHours = {
  timezone: 'Asia/Shanghai',
  weekdays: [1, 2, 3, 4, 5],
  start: '10:00',
  end: '19:00',
}

const DEFAULT_OFFLINE_MESSAGE: Record<SupportLocale, string> = {
  zh: '当前不在线，请留言，我们会在下一个工作日回复。',
  en: 'We are offline right now. Leave a message and we will reply on the next business day.',
  de: 'Wir sind gerade offline. Hinterlassen Sie eine Nachricht, wir antworten am nächsten Werktag.',
  nl: 'We zijn nu offline. Laat een bericht achter; we reageren op de volgende werkdag.',
}

const DEFAULT_FALLBACK_CONTACTS: SupportFallbackContacts = {
  wechatImage: '/support/wechat-support.jpg',
  email: null,
  feishu: null,
}

const DEFAULT_QUIET_HOURS: SupportQuietHours = {
  enabled: false,
  start: '22:00',
  end: '08:00',
  timezone: 'Asia/Shanghai',
}

function jsonObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function normalizeBusinessHours(value: Prisma.JsonValue | null | undefined): SupportBusinessHours {
  const raw = jsonObject(value)
  return {
    timezone: typeof raw.timezone === 'string' && raw.timezone ? raw.timezone : DEFAULT_BUSINESS_HOURS.timezone,
    weekdays: Array.isArray(raw.weekdays)
      ? raw.weekdays.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6)
      : DEFAULT_BUSINESS_HOURS.weekdays,
    start: typeof raw.start === 'string' ? raw.start : DEFAULT_BUSINESS_HOURS.start,
    end: typeof raw.end === 'string' ? raw.end : DEFAULT_BUSINESS_HOURS.end,
  }
}

function normalizeOfflineMessage(value: Prisma.JsonValue | null | undefined): Record<string, string> {
  const raw = jsonObject(value)
  const result: Record<string, string> = {}
  for (const locale of SUPPORT_LOCALES) {
    const text = raw[locale]
    if (typeof text === 'string' && text.trim()) result[locale] = text
  }
  return result
}

function normalizeFallbackContacts(value: Prisma.JsonValue | null | undefined): SupportFallbackContacts {
  const raw = jsonObject(value)
  return {
    wechatImage: typeof raw.wechatImage === 'string' ? raw.wechatImage : null,
    email: typeof raw.email === 'string' ? raw.email : null,
    feishu: typeof raw.feishu === 'string' ? raw.feishu : null,
  }
}

function normalizeQuietHours(value: Prisma.JsonValue | null | undefined): SupportQuietHours {
  const raw = jsonObject(value)
  return {
    enabled: raw.enabled === true,
    start: typeof raw.start === 'string' ? raw.start : DEFAULT_QUIET_HOURS.start,
    end: typeof raw.end === 'string' ? raw.end : DEFAULT_QUIET_HOURS.end,
    timezone: typeof raw.timezone === 'string' ? raw.timezone : DEFAULT_QUIET_HOURS.timezone,
  }
}

export async function getSupportSettings() {
  let settings = await prisma.supportSettings.findUnique({ where: { id: 'default' } })
  if (!settings) {
    try {
      settings = await prisma.supportSettings.create({
        data: {
          id: 'default',
          businessHours: DEFAULT_BUSINESS_HOURS as unknown as Prisma.InputJsonValue,
          offlineMessage: DEFAULT_OFFLINE_MESSAGE as unknown as Prisma.InputJsonValue,
          fallbackContacts: DEFAULT_FALLBACK_CONTACTS as unknown as Prisma.InputJsonValue,
          quietHours: DEFAULT_QUIET_HOURS as unknown as Prisma.InputJsonValue,
        },
      })
    } catch {
      settings = await prisma.supportSettings.findUnique({ where: { id: 'default' } })
    }
  }

  return {
    row: settings,
    enabled: settings?.enabled ?? true,
    businessHours: normalizeBusinessHours(settings?.businessHours),
    offlineMessage: {
      ...DEFAULT_OFFLINE_MESSAGE,
      ...normalizeOfflineMessage(settings?.offlineMessage),
    },
    fallbackContacts: {
      ...DEFAULT_FALLBACK_CONTACTS,
      ...normalizeFallbackContacts(settings?.fallbackContacts),
    },
    quietHours: normalizeQuietHours(settings?.quietHours),
    firstResponseTargetMinutes: settings?.firstResponseTargetMinutes ?? 15,
    retentionDays: settings?.retentionDays ?? 180,
    csatEnabled: settings?.csatEnabled ?? true,
  }
}

function parseClock(value: string): [number, number] {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (!match) return [0, 0]
  return [Number(match[1]), Number(match[2])]
}

function zonedParts(date: Date, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date)
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
    return {
      weekday: weekdayMap[values.weekday] ?? date.getDay(),
      minutes: Number(values.hour) * 60 + Number(values.minute),
    }
  } catch {
    return { weekday: date.getDay(), minutes: date.getHours() * 60 + date.getMinutes() }
  }
}

export function isSupportOnline(businessHours: SupportBusinessHours, now = new Date()) {
  const local = zonedParts(now, businessHours.timezone)
  if (!businessHours.weekdays.includes(local.weekday)) return false
  const [startHour, startMinute] = parseClock(businessHours.start)
  const [endHour, endMinute] = parseClock(businessHours.end)
  const start = startHour * 60 + startMinute
  const end = endHour * 60 + endMinute
  if (start <= end) return local.minutes >= start && local.minutes < end
  return local.minutes >= start || local.minutes < end
}

export function offlineMessageFor(locale: string, messages: Record<string, string>) {
  return messages[locale] || messages.en || messages.zh || DEFAULT_OFFLINE_MESSAGE.zh
}

export function supportPublicSettings(settings: Awaited<ReturnType<typeof getSupportSettings>>) {
  return {
    enabled: settings.enabled,
    online: settings.enabled && isSupportOnline(settings.businessHours),
    businessHours: settings.businessHours,
    offlineMessage: settings.offlineMessage,
    fallbackContacts: settings.fallbackContacts,
    firstResponseTargetMinutes: settings.firstResponseTargetMinutes,
    csatEnabled: settings.csatEnabled,
  }
}
