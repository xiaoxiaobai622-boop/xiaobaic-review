/**
 * Local-only fixture/evidence for INBOX history pagination.
 *
 *   ANN_HISTORY_PASSWORD='<local-only>' npx tsx scripts/announcements-history-evidence.mts setup
 *   npx tsx scripts/announcements-history-evidence.mts verify
 *   npx tsx scripts/announcements-history-evidence.mts cleanup
 *
 * Creates 120 ARCHIVED announcements targeted at one temporary user. The user
 * has no team and no visible active announcements; other accounts cannot see
 * the fixture. The password is only read from the environment and is never
 * printed by this script.
 */
import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { prisma } from '../src/lib/db'
import { loadAnnouncementFeed, loadAnnouncementHistoryPage } from '../src/lib/announcements/feed'

const MARKER = '[P2-历史]'
const COUNT = 120

function assertLocalDatabase() {
  const raw = process.env.DATABASE_URL
  if (!raw) throw new Error('DATABASE_URL is missing')
  const url = new URL(raw)
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname) || url.pathname !== '/vitransfer') {
    throw new Error(`Refusing to run against non-local database: ${url.hostname}${url.pathname}`)
  }
}

async function setup() {
  const password = process.env.ANN_HISTORY_PASSWORD
  if (!password || password.length < 8) throw new Error('ANN_HISTORY_PASSWORD (>=8) is required')
  const suffix = Date.now()
  const email = `ann-history-${suffix}@example.invalid`
  const phone = `199${String(suffix).slice(-8)}`
  const user = await prisma.user.create({
    data: {
      email,
      phone,
      password: await bcrypt.hash(password, 10),
      name: `Ann History ${String(suffix).slice(-4)}`,
      locale: 'zh',
      onboardingCompleted: true,
      role: 'ADMIN',
    },
    select: { id: true },
  })

  const now = new Date()
  for (let index = 0; index < COUNT; index += 1) {
    const publishedAt = new Date(now.getTime() - (index + 1) * 60_000)
    await prisma.platformAnnouncement.create({
      data: {
        title: `${MARKER} #${String(index + 1).padStart(3, '0')}`,
        content: `${MARKER} archived item ${index + 1}`,
        locale: 'zh',
        type: 'ANNOUNCEMENT',
        status: 'ARCHIVED',
        primaryMode: 'INBOX',
        priority: 0,
        startAt: publishedAt,
        publishedAt,
        archivedAt: new Date(publishedAt.getTime() + 30_000),
        isTest: false,
        audienceCount: 1,
        audienceResolvedAt: now,
        rules: { create: [{ kind: 'USER', value: user.id, mode: 'INCLUDE' }] },
      },
    })
  }

  console.log(JSON.stringify({
    userId: user.id,
    email,
    phone,
    marker: MARKER,
    announcementCount: COUNT,
    note: 'password came from ANN_HISTORY_PASSWORD and is not printed',
  }, null, 2))
}

async function findFixtureUser() {
  const user = await prisma.user.findFirst({
    where: { email: { startsWith: 'ann-history-' }, name: { startsWith: 'Ann History' } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, phone: true, email: true },
  })
  if (!user) throw new Error('history fixture user not found; run setup first')
  return user
}

async function verify() {
  const user = await findFixtureUser()
  const feed = await loadAnnouncementFeed(user.id)
  if (!feed) throw new Error('feed returned null')

  const ids = feed.items.filter((item) => item.title.startsWith(MARKER)).map((item) => item.id)
  let cursor = feed.historyNextCursor
  let hasMore = feed.historyHasMore
  let pages = 1
  while (hasMore && cursor && pages < 20) {
    const page = await loadAnnouncementHistoryPage(user.id, cursor, 50)
    if (!page) throw new Error('history page returned null')
    ids.push(...page.items.filter((item) => item.title.startsWith(MARKER)).map((item) => item.id))
    cursor = page.historyNextCursor
    hasMore = page.historyHasMore
    pages += 1
  }

  const unique = new Set(ids)
  console.log(JSON.stringify({
    firstPageHistoryItems: feed.items.filter((item) => item.title.startsWith(MARKER)).length,
    feedHistoryHasMore: feed.historyHasMore,
    pages,
    collected: ids.length,
    unique: unique.size,
    complete: ids.length === COUNT && unique.size === COUNT,
  }, null, 2))
  if (ids.length !== COUNT || unique.size !== COUNT) process.exitCode = 1
}

async function cleanup() {
  const user = await prisma.user.findFirst({
    where: { email: { startsWith: 'ann-history-' }, name: { startsWith: 'Ann History' } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  const announcements = await prisma.platformAnnouncement.deleteMany({
    where: { title: { startsWith: MARKER } },
  })
  if (user) {
    await prisma.user.delete({ where: { id: user.id } })
  }
  console.log(JSON.stringify({ deletedAnnouncements: announcements.count, deletedUsers: user ? 1 : 0 }, null, 2))
}

async function main() {
  assertLocalDatabase()
  const command = process.argv[2] || 'verify'
  if (command === 'setup') await setup()
  else if (command === 'cleanup') await cleanup()
  else await verify()
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
