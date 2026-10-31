/**
 * Removes local-only announcement seed cohorts, browser test announcements and
 * their audit/event/read rows. Refuses to run against anything except the local
 * dev database.
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const SEED_EMAILS = [
  'ann-browser-admin@example.invalid',
  'ann-seed-owner@example.invalid',
  'ann-seed-admin@example.invalid',
  'ann-seed-member-zh@example.invalid',
  'ann-seed-member-de@example.invalid',
  'ann-seed-member-en@example.invalid',
  'ann-seed-member-nl@example.invalid',
]
const SEED_TEAMS = ['990001', '990002']
const SEED_FEATURES = ['ann_seed_feature', 'ann_seed_default']

function assertLocalDatabase() {
  const raw = process.env.DATABASE_URL
  if (!raw) throw new Error('DATABASE_URL is missing')
  const url = new URL(raw)
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname) || url.pathname !== '/vitransfer') {
    throw new Error(`Refusing to clean a non-local database: ${url.hostname}${url.pathname}`)
  }
}

async function main() {
  assertLocalDatabase()

  const users = await prisma.user.findMany({
    where: { email: { in: SEED_EMAILS } },
    select: { id: true },
  })
  const userIds = users.map((user) => user.id)

  const announcements = await prisma.platformAnnouncement.findMany({
    where: {
      OR: [
        { title: { contains: '[浏览器验证]' } },
        ...(userIds.length > 0 ? [{ userId: { in: userIds } }, { createdBy: { in: userIds } }] : []),
      ],
    },
    select: { id: true },
  })
  const announcementIds = announcements.map((announcement) => announcement.id)

  await prisma.announcementAuditLog.deleteMany({
    where: {
      OR: [
        ...(announcementIds.length > 0 ? [{ announcementId: { in: announcementIds } }] : []),
        ...(userIds.length > 0 ? [{ actorUserId: { in: userIds } }] : []),
      ],
    },
  })
  if (announcementIds.length > 0) {
    await prisma.announcementEvent.deleteMany({ where: { announcementId: { in: announcementIds } } })
    await prisma.platformAnnouncementRead.deleteMany({ where: { announcementId: { in: announcementIds } } })
    await prisma.announcementAudienceRule.deleteMany({ where: { announcementId: { in: announcementIds } } })
    await prisma.platformAnnouncement.deleteMany({ where: { id: { in: announcementIds } } })
  }

  await prisma.team.deleteMany({ where: { id: { in: SEED_TEAMS } } })
  await prisma.platformFeature.deleteMany({ where: { key: { in: SEED_FEATURES } } })
  if (userIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  }

  await prisma.announcementControl.upsert({
    where: { id: 'global' },
    create: { id: 'global' },
    update: {
      bannerModalPaused: false,
      modalMaxPerDay: 1,
      modalCooldownMinutes: 1440,
      modalMaxShowsPerUser: 3,
      toastMaxPriority: 20,
      updatedBy: null,
      updatedByLabel: null,
    },
  })

  const remaining = {
    users: await prisma.user.count(),
    teams: await prisma.team.count(),
    announcements: await prisma.platformAnnouncement.count(),
    events: await prisma.announcementEvent.count(),
    audit: await prisma.announcementAuditLog.count(),
    seedUsers: await prisma.user.count({ where: { email: { in: SEED_EMAILS } } }),
    seedTeams: await prisma.team.count({ where: { id: { in: SEED_TEAMS } } }),
    seedFeatures: await prisma.platformFeature.count({ where: { key: { in: SEED_FEATURES } } }),
  }
  console.log(JSON.stringify({ removed: { users: userIds.length, announcements: announcementIds.length }, remaining }, null, 2))
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
