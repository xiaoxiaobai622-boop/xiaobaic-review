import { prisma } from './db'
import { logError, logMessage } from './logging'

const RETENTION_DAYS = 180
const DEFAULT_BATCH_SIZE = 1000
const DEFAULT_MAX_BATCHES = 20

export async function purgeExpiredTeamAuditEvents(options?: {
  now?: Date
  batchSize?: number
  maxBatches?: number
}) {
  const now = options?.now ?? new Date()
  const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE
  const maxBatches = options?.maxBatches ?? DEFAULT_MAX_BATCHES
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000)

  let scanned = 0
  let deleted = 0
  let batches = 0
  try {
    while (batches < maxBatches) {
      const rows = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "TeamAuditEvent"
        WHERE "createdAt" < ${cutoff}
        ORDER BY "createdAt" ASC
        LIMIT ${batchSize}
      `
      if (rows.length === 0) break
      const result = await prisma.teamAuditEvent.deleteMany({
        where: { id: { in: rows.map((row) => row.id) } },
      })
      scanned += rows.length
      deleted += result.count
      batches += 1
      if (rows.length < batchSize) break
    }
    logMessage(`[TEAM_AUDIT] retention cutoff=${cutoff.toISOString()} scanned=${scanned} deleted=${deleted} batches=${batches}`)
    return { cutoff, scanned, deleted, batches }
  } catch (error) {
    logError('[TEAM_AUDIT] retention purge failed', error)
    throw error
  }
}
