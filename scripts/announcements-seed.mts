/**
 * Local-only seed for announcement audience/lifecycle/receipt verification.
 * Refuses to run against anything except localhost/vitransfer.
 *
 * Browser password is supplied through ANN_BROWSER_PASSWORD (never stored in
 * this file). The browser admin and seed cohorts can be removed with
 * scripts/announcements-cleanup.mts.
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()
const SEED_NOW = new Date('2026-10-31T04:00:00.000Z') // 2026-10-31 12:00 Beijing
const TEAM_A = '990001'
const TEAM_B = '990002'
const BROWSER_EMAIL = 'ann-browser-admin@example.invalid'
const BROWSER_PHONE = '19900009901'

function assertLocalDatabase() {
  const raw = process.env.DATABASE_URL
  if (!raw) throw new Error('DATABASE_URL is missing')
  const url = new URL(raw)
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname) || url.pathname !== '/vitransfer') {
    throw new Error(`Refusing to seed non-local database: ${url.hostname}${url.pathname}`)
  }
}

function daysAgo(days: number): Date {
  return new Date(SEED_NOW.getTime() - days * 24 * 60 * 60 * 1000)
}

async function upsertSeedUser(params: {
  email: string
  name: string
  locale: string
  passwordHash: string
  phone?: string | null
  isPlatformAdmin?: boolean
}) {
  const existing = await prisma.user.findUnique({ where: { email: params.email }, select: { id: true, phone: true } })
  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        name: params.name,
        locale: params.locale,
        password: params.passwordHash,
        onboardingCompleted: true,
        ...(params.phone && !existing.phone ? { phone: params.phone } : {}),
        ...(params.isPlatformAdmin !== undefined ? { isPlatformAdmin: params.isPlatformAdmin } : {}),
      },
    })
  }
  return prisma.user.create({
    data: {
      email: params.email,
      name: params.name,
      locale: params.locale,
      password: params.passwordHash,
      phone: params.phone ?? null,
      onboardingCompleted: true,
      role: 'ADMIN',
      isPlatformAdmin: params.isPlatformAdmin ?? false,
    },
  })
}

async function main() {
  assertLocalDatabase()

  const browserPassword = process.env.ANN_BROWSER_PASSWORD
  if (!browserPassword || browserPassword.length < 8) {
    throw new Error('ANN_BROWSER_PASSWORD (>= 8 chars) is required for the ephemeral browser admin')
  }
  const commonHash = await bcrypt.hash(browserPassword, 10)
  const cohortHash = await bcrypt.hash(`cohort-${Date.now()}-${Math.random().toString(36).slice(2)}`, 10)

  const browserAdmin = await upsertSeedUser({
    email: BROWSER_EMAIL,
    name: 'Ann Browser Admin',
    locale: 'zh',
    passwordHash: commonHash,
    phone: BROWSER_PHONE,
    isPlatformAdmin: true,
  })

  const users = {
    owner: await upsertSeedUser({ email: 'ann-seed-owner@example.invalid', name: 'Seed Owner', locale: 'zh', passwordHash: cohortHash }),
    admin: await upsertSeedUser({ email: 'ann-seed-admin@example.invalid', name: 'Seed Admin', locale: 'en', passwordHash: cohortHash }),
    memberZh: await upsertSeedUser({ email: 'ann-seed-member-zh@example.invalid', name: 'Seed Member ZH', locale: 'zh', passwordHash: cohortHash }),
    memberDe: await upsertSeedUser({ email: 'ann-seed-member-de@example.invalid', name: 'Seed Member DE', locale: 'de', passwordHash: cohortHash }),
    memberEn: await upsertSeedUser({ email: 'ann-seed-member-en@example.invalid', name: 'Seed Member EN', locale: 'en', passwordHash: cohortHash }),
    memberNl: await upsertSeedUser({ email: 'ann-seed-member-nl@example.invalid', name: 'Seed Member NL', locale: 'nl', passwordHash: cohortHash }),
  }

  const existingTeamA = await prisma.team.findUnique({ where: { id: TEAM_A }, select: { name: true } })
  if (existingTeamA && existingTeamA.name !== 'Ann Seed Team A') {
    throw new Error(`Team ${TEAM_A} already exists and is not the seed team`)
  }
  const existingTeamB = await prisma.team.findUnique({ where: { id: TEAM_B }, select: { name: true } })
  if (existingTeamB && existingTeamB.name !== 'Ann Seed Team B') {
    throw new Error(`Team ${TEAM_B} already exists and is not the seed team`)
  }

  await prisma.team.upsert({
    where: { id: TEAM_A },
    update: { name: 'Ann Seed Team A', status: 'ACTIVE', subscriptionPlan: 'BETA' },
    create: {
      id: TEAM_A,
      name: 'Ann Seed Team A',
      slug: 'ann-seed-team-a',
      shareKey: 'ann-seed-share-a',
      status: 'ACTIVE',
      subscriptionPlan: 'BETA',
      createdById: browserAdmin.id,
    },
  })
  await prisma.team.upsert({
    where: { id: TEAM_B },
    update: { name: 'Ann Seed Team B', status: 'ACTIVE', subscriptionPlan: 'MONTHLY' },
    create: {
      id: TEAM_B,
      name: 'Ann Seed Team B',
      slug: 'ann-seed-team-b',
      shareKey: 'ann-seed-share-b',
      status: 'ACTIVE',
      subscriptionPlan: 'MONTHLY',
      createdById: browserAdmin.id,
    },
  })

  const memberships: Array<{ teamId: string; userId: string; role: 'OWNER' | 'ADMIN' | 'MEMBER'; lastActiveAt: Date | null }> = [
    { teamId: TEAM_A, userId: browserAdmin.id, role: 'ADMIN', lastActiveAt: new Date(SEED_NOW.getTime() - 60 * 60 * 1000) },
    { teamId: TEAM_A, userId: users.owner.id, role: 'OWNER', lastActiveAt: daysAgo(1) },
    { teamId: TEAM_A, userId: users.admin.id, role: 'ADMIN', lastActiveAt: daysAgo(2) },
    { teamId: TEAM_A, userId: users.memberZh.id, role: 'MEMBER', lastActiveAt: daysAgo(1) },
    { teamId: TEAM_A, userId: users.memberDe.id, role: 'MEMBER', lastActiveAt: daysAgo(10) },
    { teamId: TEAM_B, userId: users.memberEn.id, role: 'MEMBER', lastActiveAt: daysAgo(40) },
    { teamId: TEAM_B, userId: users.memberNl.id, role: 'MEMBER', lastActiveAt: null },
  ]
  for (const membership of memberships) {
    await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId: membership.teamId, userId: membership.userId } },
      update: { role: membership.role, status: 'ACTIVE', lastActiveAt: membership.lastActiveAt },
      create: { ...membership, status: 'ACTIVE' },
    })
  }

  // Explicitly granted feature: only Team A seed users should match.
  await prisma.platformFeature.upsert({
    where: { key: 'ann_seed_feature' },
    update: { name: 'Announcement Seed Feature', category: 'TEST', defaultEnabled: false },
    create: { key: 'ann_seed_feature', name: 'Announcement Seed Feature', category: 'TEST', defaultEnabled: false },
  })
  await prisma.teamFeatureGrant.upsert({
    where: { teamId_featureKey: { teamId: TEAM_A, featureKey: 'ann_seed_feature' } },
    update: { enabled: true },
    create: { teamId: TEAM_A, featureKey: 'ann_seed_feature', enabled: true },
  })

  // Default-on feature explicitly disabled for Team B: tests
  // "grant wins over default" without relying on hardcoded existing users.
  await prisma.platformFeature.upsert({
    where: { key: 'ann_seed_default' },
    update: { name: 'Announcement Seed Default Feature', category: 'TEST', defaultEnabled: true },
    create: { key: 'ann_seed_default', name: 'Announcement Seed Default Feature', category: 'TEST', defaultEnabled: true },
  })
  await prisma.teamFeatureGrant.upsert({
    where: { teamId_featureKey: { teamId: TEAM_B, featureKey: 'ann_seed_default' } },
    update: { enabled: false },
    create: { teamId: TEAM_B, featureKey: 'ann_seed_default', enabled: false },
  })

  console.log(JSON.stringify({
    seedNow: SEED_NOW.toISOString(),
    teams: { a: TEAM_A, b: TEAM_B },
    browserAdminId: browserAdmin.id,
    browserEmail: BROWSER_EMAIL,
    users: Object.fromEntries(Object.entries(users).map(([key, user]) => [key, user.id])),
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
