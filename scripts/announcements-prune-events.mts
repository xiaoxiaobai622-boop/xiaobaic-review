/**
 * Bounded AnnouncementEvent retention. Safe default: dry-run.
 *
 *   npx tsx scripts/announcements-prune-events.mts
 *   npx tsx scripts/announcements-prune-events.mts --days=400
 *   ANNOUNCEMENTS_PRUNE_CONFIRM=1 npx tsx scripts/announcements-prune-events.mts --apply
 *
 * --apply is refused for non-local databases unless
 * ANNOUNCEMENTS_PRUNE_ALLOW_REMOTE=1 is also explicitly set. This repo task does
 * not run the apply step; production cleanup belongs to an ops maintenance job.
 */
import 'dotenv/config'
import {
  ANNOUNCEMENT_EVENT_RETENTION_DAYS,
  pruneAnnouncementEvents,
} from '../src/lib/announcements/retention'

function assertLocalDatabaseForApply(apply: boolean) {
  if (!apply) return
  const raw = process.env.DATABASE_URL
  if (!raw) throw new Error('DATABASE_URL is missing')
  const url = new URL(raw)
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if (!local && process.env.ANNOUNCEMENTS_PRUNE_ALLOW_REMOTE !== '1') {
    throw new Error('Refusing non-local --apply without ANNOUNCEMENTS_PRUNE_ALLOW_REMOTE=1')
  }
}

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const daysArg = args.find((arg) => arg.startsWith('--days='))
  const days = daysArg ? Number(daysArg.slice('--days='.length)) : ANNOUNCEMENT_EVENT_RETENTION_DAYS
  if (!Number.isFinite(days) || days < 1) throw new Error('--days must be a positive number')
  if (apply && process.env.ANNOUNCEMENTS_PRUNE_CONFIRM !== '1') {
    throw new Error('--apply requires ANNOUNCEMENTS_PRUNE_CONFIRM=1')
  }
  assertLocalDatabaseForApply(apply)

  const result = await pruneAnnouncementEvents({
    retentionDays: days,
    dryRun: !apply,
  })
  console.log(JSON.stringify({
    mode: result.dryRun ? 'dry-run' : 'apply',
    retentionDays: result.retentionDays,
    cutoff: result.cutoff.toISOString(),
    deleted: result.deleted,
    note: result.dryRun ? 'no rows deleted; pass --apply with ANNOUNCEMENTS_PRUNE_CONFIRM=1' : 'old event rows deleted in batches',
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => {
    process.exit(process.exitCode ?? 0)
  })
