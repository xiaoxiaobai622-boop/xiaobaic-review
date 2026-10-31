/**
 * Local-only query-count evidence for the announcement admin list.
 *
 *   npx tsx scripts/announcements-query-count.mts setup
 *   npx tsx scripts/announcements-query-count.mts measure 12
 *   npx tsx scripts/announcements-query-count.mts measure 42
 *   npx tsx scripts/announcements-query-count.mts cleanup
 *
 * The temporary rows are DRAFT + isTest, so they never reach any receiver feed.
 */
import 'dotenv/config'
import { prisma } from '../src/lib/db'
import { listAdminAnnouncements } from '../src/lib/announcements/admin'
import { getConfiguredLocale } from '../src/i18n/locale'
import { syncAnnouncementLifecycles } from '../src/lib/announcements/lifecycle'

const MARKER = '[P2-测量]'
const COUNT = 42

function assertLocalDatabase() {
  const raw = process.env.DATABASE_URL
  if (!raw) throw new Error('DATABASE_URL is missing')
  const url = new URL(raw)
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname) || url.pathname !== '/vitransfer') {
    throw new Error(`Refusing to measure a non-local database: ${url.hostname}${url.pathname}`)
  }
}

async function setup() {
  const existing = await prisma.platformAnnouncement.count({ where: { title: { startsWith: MARKER } } })
  if (existing > 0) {
    console.log(`already seeded marker rows=${existing}`)
    return
  }
  await prisma.platformAnnouncement.createMany({
    data: Array.from({ length: COUNT }).map((_, index) => ({
      title: `${MARKER} #${String(index + 1).padStart(2, '0')}`,
      content: `${MARKER} query-count draft ${index + 1}`,
      locale: 'zh',
      type: 'ANNOUNCEMENT',
      status: 'DRAFT',
      primaryMode: 'INBOX',
      priority: 0,
      isTest: true,
    })),
  })
  console.log(`seeded marker rows=${COUNT}`)
}

async function cleanup() {
  const deleted = await prisma.platformAnnouncement.deleteMany({ where: { title: { startsWith: MARKER } } })
  console.log(`deleted marker rows=${deleted.count}`)
}

async function measure(limit: number) {
  // Warm the process-local locale cache and lifecycle throttle so the measured
  // count contains only the list path, not unrelated first-call setup.
  await getConfiguredLocale().catch(() => 'zh')
  await syncAnnouncementLifecycles(true)

  // The app's Prisma client is an extended client without $on('query'), so count
  // the exact delegates the list path uses: one announcement page, one event
  // aggregate, and (before P2-1) one user.count per row.
  const client = prisma as unknown as {
    user: { count: (...args: unknown[]) => Promise<unknown> }
    platformAnnouncement: { findMany: (...args: unknown[]) => Promise<unknown> }
    $queryRaw: (...args: unknown[]) => Promise<unknown>
  }
  let queries = 0
  const wrap = <T extends object, K extends keyof T>(target: T, key: K) => {
    const original = (target[key] as (...args: unknown[]) => Promise<unknown>).bind(target)
    ;(target as Record<K, unknown>)[key] = (...args: unknown[]) => {
      queries += 1
      return original(...args)
    }
  }
  wrap(client.user, 'count')
  wrap(client.platformAnnouncement, 'findMany')
  wrap(client, '$queryRaw')

  const items = await listAdminAnnouncements({
    q: MARKER,
    statuses: [],
    types: [],
    modes: [],
    includeTest: true,
    limit,
  })

  console.log(JSON.stringify({ requestedRows: limit, returnedRows: items.length, queries }, null, 2))
}

async function main() {
  assertLocalDatabase()
  const command = process.argv[2] || 'measure'
  if (command === 'setup') await setup()
  else if (command === 'cleanup') await cleanup()
  else {
    const limit = Math.max(1, Math.min(100, Number(process.argv[3] || 42)))
    await measure(limit)
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
    process.exit(process.exitCode ?? 0)
  })
