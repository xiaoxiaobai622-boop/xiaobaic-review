import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { countAudience, type AudienceSource } from './audience'
import {
  ANNOUNCEMENT_EVENT_TYPES,
  type AnnouncementEventType,
} from './constants'
import { announcementNow } from './time'

export interface EventTotal {
  events: number
  users: number
}

export type EventTotals = Record<AnnouncementEventType, EventTotal>

export interface StatsFilters {
  mode?: string | null
  from?: Date | null
  to?: Date | null
}

function emptyTotals(): EventTotals {
  return Object.fromEntries(
    ANNOUNCEMENT_EVENT_TYPES.map((type) => [type, { events: 0, users: 0 }]),
  ) as EventTotals
}

function eventWhere(announcementId: string, filters: StatsFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`"announcementId" = ${announcementId}`]
  if (filters.mode) parts.push(Prisma.sql`"mode" = ${filters.mode}`)
  if (filters.from) parts.push(Prisma.sql`"occurredAt" >= ${filters.from}`)
  if (filters.to) parts.push(Prisma.sql`"occurredAt" <= ${filters.to}`)
  return Prisma.join(parts, ' AND ')
}

/**
 * Event rows are already deduped per user/day at write time, so COUNT here is
 * the metric and COUNT(DISTINCT userId) is the unique-user view. Nothing reads
 * the 30-second feed poll as an event.
 */
export async function loadStatsForAnnouncement(params: {
  id: string
  audienceSource: AudienceSource
  audienceSnapshot: number | null
  audienceResolvedAt: Date | null
  filters: StatsFilters
}) {
  const { id, filters } = params
  const where = eventWhere(id, filters)

  const [totalRows, modeRows, dayRows] = await Promise.all([
    prisma.$queryRaw<Array<{ type: string; events: number; users: number }>>(Prisma.sql`
      SELECT "type", COUNT(*)::int AS events, COUNT(DISTINCT "userId")::int AS users
      FROM "AnnouncementEvent"
      WHERE ${where}
      GROUP BY "type"
    `),
    prisma.$queryRaw<Array<{ mode: string; type: string; events: number; users: number }>>(Prisma.sql`
      SELECT "mode", "type", COUNT(*)::int AS events, COUNT(DISTINCT "userId")::int AS users
      FROM "AnnouncementEvent"
      WHERE ${where}
      GROUP BY "mode", "type"
      ORDER BY "mode", "type"
    `),
    prisma.$queryRaw<Array<{ day: string; type: string; events: number; users: number }>>(Prisma.sql`
      SELECT "beijingDay" AS day, "type", COUNT(*)::int AS events, COUNT(DISTINCT "userId")::int AS users
      FROM "AnnouncementEvent"
      WHERE ${where}
      GROUP BY "beijingDay", "type"
      ORDER BY "beijingDay"
    `),
  ])

  const totals = emptyTotals()
  for (const row of totalRows) {
    if ((ANNOUNCEMENT_EVENT_TYPES as readonly string[]).includes(row.type)) {
      totals[row.type as AnnouncementEventType] = { events: row.events, users: row.users }
    }
  }

  let audienceCurrent: number | null = null
  let audienceError: string | null = null
  try {
    audienceCurrent = await countAudience(params.audienceSource)
  } catch {
    // Unknown is not zero. The UI renders an em dash and the error separately.
    audienceError = '当前受众数解析失败'
  }

  const rate = (users: number) => {
    if (audienceCurrent === null || audienceCurrent <= 0) return null
    return users / audienceCurrent
  }

  return {
    generatedAt: announcementNow(),
    filters: {
      mode: filters.mode ?? null,
      from: filters.from ?? null,
      to: filters.to ?? null,
    },
    audience: {
      snapshot: params.audienceSnapshot,
      current: audienceCurrent,
      resolvedAt: params.audienceResolvedAt,
      error: audienceError,
    },
    totals,
    rates: {
      impression: rate(totals.IMPRESSION.users),
      read: rate(totals.READ.users),
      ack: rate(totals.ACK.users),
      click: rate(totals.CLICK.users),
      dismiss: rate(totals.DISMISS.users),
    },
    byMode: modeRows,
    byDay: dayRows,
  }
}

export async function loadEventTotalsForAnnouncements(ids: string[]): Promise<Map<string, EventTotals>> {
  const result = new Map<string, EventTotals>()
  if (ids.length === 0) return result

  const rows = await prisma.$queryRaw<Array<{
    announcementId: string
    type: string
    events: number
    users: number
  }>>(Prisma.sql`
    SELECT "announcementId", "type", COUNT(*)::int AS events, COUNT(DISTINCT "userId")::int AS users
    FROM "AnnouncementEvent"
    WHERE "announcementId" IN (${Prisma.join(ids)})
    GROUP BY "announcementId", "type"
  `)

  for (const id of ids) result.set(id, emptyTotals())
  for (const row of rows) {
    if (!(ANNOUNCEMENT_EVENT_TYPES as readonly string[]).includes(row.type)) continue
    const totals = result.get(row.announcementId)
    if (!totals) continue
    totals[row.type as AnnouncementEventType] = { events: row.events, users: row.users }
  }

  return result
}

export interface ListStats {
  impressions: EventTotal
  reads: EventTotal
  acks: EventTotal
  clicks: EventTotal
  dismisses: EventTotal
}

export function toListStats(totals: EventTotals): ListStats {
  return {
    impressions: totals.IMPRESSION,
    reads: totals.READ,
    acks: totals.ACK,
    clicks: totals.CLICK,
    dismisses: totals.DISMISS,
  }
}
