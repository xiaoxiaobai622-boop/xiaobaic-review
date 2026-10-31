import { prisma } from '@/lib/db'
import { announcementNow } from './time'

/**
 * Event rows are already deduped per user/day, but they still grow with the
 * user base. Keep event-level stats bounded with a default 400-day retention.
 * Ops can override the window at call time; the application never deletes
 * events on a request path.
 */
export const ANNOUNCEMENT_EVENT_RETENTION_DAYS = 400
export const ANNOUNCEMENT_EVENT_PRUNE_BATCH_SIZE = 5_000

export interface PruneAnnouncementEventsOptions {
  retentionDays?: number
  batchSize?: number
  dryRun?: boolean
  before?: Date
}

export interface PruneAnnouncementEventsResult {
  cutoff: Date
  retentionDays: number
  deleted: number
  dryRun: boolean
}

export async function pruneAnnouncementEvents(
  options: PruneAnnouncementEventsOptions = {},
): Promise<PruneAnnouncementEventsResult> {
  const retentionDays = Math.max(1, Math.trunc(options.retentionDays ?? ANNOUNCEMENT_EVENT_RETENTION_DAYS))
  const batchSize = Math.max(1, Math.min(20_000, Math.trunc(options.batchSize ?? ANNOUNCEMENT_EVENT_PRUNE_BATCH_SIZE)))
  const cutoff = options.before ?? new Date(announcementNow().getTime() - retentionDays * 24 * 60 * 60 * 1000)
  const dryRun = options.dryRun !== false

  if (dryRun) {
    const deleted = await prisma.announcementEvent.count({
      where: { occurredAt: { lt: cutoff } },
    })
    return { cutoff, retentionDays, deleted, dryRun: true }
  }

  let deleted = 0
  while (true) {
    const rows = await prisma.announcementEvent.findMany({
      where: { occurredAt: { lt: cutoff } },
      select: { id: true },
      orderBy: { occurredAt: 'asc' },
      take: batchSize,
    })
    if (rows.length === 0) break
    const result = await prisma.announcementEvent.deleteMany({
      where: { id: { in: rows.map((row) => row.id) } },
    })
    deleted += result.count
    if (rows.length < batchSize) break
  }

  return { cutoff, retentionDays, deleted, dryRun: false }
}
