/**
 * Local-only verification for the announcement domain:
 * - resolver counts vs direct SQL
 * - exclude rules, new-member visibility, non-audience feed isolation
 * - clock-driven lifecycle transitions
 * - read/ack/dismiss/impression idempotency and cross-mode state
 * - stats reconciliation against event rows
 * - legacy row preservation and platform-vs-team token boundaries
 *
 * Creates only temporary announcements/users and deletes them in finally.
 * Seed cohorts are managed by scripts/announcements-seed.mts.
 */
import 'dotenv/config'
import { Prisma, PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'

process.env.ANNOUNCEMENTS_NOW = '2026-10-31T04:00:00.000Z'

import { prisma as domainPrisma } from '../src/lib/db'
import { countAudience, loadUserAudienceContext, sampleAudience, userMatchesAudience, type AudienceRuleRecord } from '../src/lib/announcements/audience'
import { audienceSourceOf, loadAnnouncementFeed } from '../src/lib/announcements/feed'
import { syncAnnouncementLifecycles } from '../src/lib/announcements/lifecycle'
import { loadStatsForAnnouncement } from '../src/lib/announcements/stats'
import {
  recordAck,
  recordDismiss,
  recordImpression,
  recordRead,
} from '../src/lib/announcements/state'
import { getConfiguredLocale } from '../src/i18n/locale'
import { registerAdminSession } from '../src/lib/studio-session-registry'
import { registerPlatformSession } from '../src/lib/platform-session-registry'

const prisma = new PrismaClient()
const SEED_NOW = new Date(process.env.ANNOUNCEMENTS_NOW)
const TEAM_A = '990001'
const TEAM_B = '990002'
const BASE = process.env.BASE_URL || 'http://localhost:3000'

const failures: string[] = []
const tempAnnouncementIds: string[] = []
let tempUserId: string | null = null

function assertLocalDatabase() {
  const raw = process.env.DATABASE_URL
  if (!raw) throw new Error('DATABASE_URL is missing')
  const url = new URL(raw)
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname) || url.pathname !== '/vitransfer') {
    throw new Error(`Refusing to verify against non-local database: ${url.hostname}${url.pathname}`)
  }
}

function check(ok: boolean, label: string, detail?: unknown) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`)
  if (!ok) failures.push(label)
}

function equal(label: string, actual: unknown, expected: unknown) {
  check(JSON.stringify(actual) === JSON.stringify(expected), label, { actual, expected })
}

async function sqlCount(query: Prisma.Sql): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: number }>>(query)
  return Number(rows[0]?.count ?? 0)
}

function rule(kind: string, value: string | null, mode = 'INCLUDE'): AudienceRuleRecord {
  return { kind, value, mode }
}

async function seedUser(email: string) {
  return prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true, email: true } })
}

function teamMembershipSql(params: { teamId?: string; role?: string; plan?: string; extra?: Prisma.Sql }) {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`tm."userId" = u.id`,
    Prisma.sql`tm.status = 'ACTIVE'`,
    Prisma.sql`t.status = 'ACTIVE'`,
  ]
  if (params.teamId) conditions.push(Prisma.sql`tm."teamId" = ${params.teamId}`)
  if (params.role) conditions.push(Prisma.sql`tm.role = CAST(${params.role} AS "TeamRole")`)
  if (params.plan) conditions.push(Prisma.sql`t."subscriptionPlan" = ${params.plan}`)
  if (params.extra) conditions.push(params.extra)
  return Prisma.sql`EXISTS (
    SELECT 1 FROM "TeamMember" tm JOIN "Team" t ON t.id = tm."teamId"
    WHERE ${Prisma.join(conditions, ' AND ')}
  )`
}

async function createAnnouncement(input: {
  title: string
  userId?: string | null
  type?: string
  status?: string
  primaryMode?: string
  priority?: number
  startAt?: Date | null
  endAt?: Date | null
  publishedAt?: Date | null
  ackRequired?: boolean
  audienceCount?: number | null
  rules?: AudienceRuleRecord[]
}) {
  const created = await prisma.platformAnnouncement.create({
    data: {
      title: input.title,
      content: `${input.title} 的验证正文`,
      userId: input.userId ?? null,
      locale: 'zh',
      type: input.type ?? 'ANNOUNCEMENT',
      status: input.status ?? 'ACTIVE',
      primaryMode: input.primaryMode ?? 'INBOX',
      priority: input.priority ?? 10,
      startAt: input.startAt ?? null,
      endAt: input.endAt ?? null,
      publishedAt: input.publishedAt ?? null,
      ackRequired: input.ackRequired ?? false,
      audienceCount: input.audienceCount ?? null,
      audienceResolvedAt: input.audienceCount ? SEED_NOW : null,
      rules: input.rules
        ? { create: input.rules.map((ruleValue) => ({ kind: ruleValue.kind, value: ruleValue.value, mode: ruleValue.mode })) }
        : undefined,
    },
    include: { rules: true },
  })
  tempAnnouncementIds.push(created.id)
  return created
}

async function main() {
  assertLocalDatabase()

  const [owner, admin, memberZh, memberDe, memberEn, memberNl, browserAdmin] = await Promise.all([
    seedUser('ann-seed-owner@example.invalid'),
    seedUser('ann-seed-admin@example.invalid'),
    seedUser('ann-seed-member-zh@example.invalid'),
    seedUser('ann-seed-member-de@example.invalid'),
    seedUser('ann-seed-member-en@example.invalid'),
    seedUser('ann-seed-member-nl@example.invalid'),
    seedUser('ann-browser-admin@example.invalid'),
  ])
  const globalLocale = await getConfiguredLocale().catch(() => 'zh')
  const cutoff7 = new Date(SEED_NOW.getTime() - 7 * 24 * 60 * 60 * 1000)
  const cutoff30 = new Date(SEED_NOW.getTime() - 30 * 24 * 60 * 60 * 1000)

  // ── Audience counts vs SQL ────────────────────────────────────────────────
  const teamACount = await countAudience({ userId: null, rules: [rule('TEAM', TEAM_A)] })
  equal('TEAM A resolver count', teamACount, await sqlCount(Prisma.sql`
    SELECT COUNT(*)::int AS count FROM "User" u WHERE ${teamMembershipSql({ teamId: TEAM_A })}
  `))

  const teamBCount = await countAudience({ userId: null, rules: [rule('TEAM', TEAM_B)] })
  equal('TEAM B resolver count', teamBCount, await sqlCount(Prisma.sql`
    SELECT COUNT(*)::int AS count FROM "User" u WHERE ${teamMembershipSql({ teamId: TEAM_B })}
  `))

  const roleOwner = await countAudience({ userId: null, rules: [rule('ROLE', 'OWNER')] })
  equal('ROLE OWNER resolver count', roleOwner, await sqlCount(Prisma.sql`
    SELECT COUNT(*)::int AS count FROM "User" u WHERE ${teamMembershipSql({ role: 'OWNER' })}
  `))

  const planBeta = await countAudience({ userId: null, rules: [rule('PLAN', 'BETA')] })
  equal('PLAN BETA resolver count', planBeta, await sqlCount(Prisma.sql`
    SELECT COUNT(*)::int AS count FROM "User" u WHERE ${teamMembershipSql({ plan: 'BETA' })}
  `))

  const featureExplicit = await countAudience({ userId: null, rules: [rule('FEATURE', 'ann_seed_feature')] })
  equal('FEATURE explicit grant resolver count', featureExplicit, await sqlCount(Prisma.sql`
    SELECT COUNT(*)::int AS count FROM "User" u
    WHERE ${teamMembershipSql({
      extra: Prisma.sql`EXISTS (
        SELECT 1 FROM "TeamFeatureGrant" g
        WHERE g."teamId" = t.id AND g."featureKey" = 'ann_seed_feature' AND g.enabled = true
      )`,
    })}
  `))

  const featureDefault = await countAudience({ userId: null, rules: [rule('FEATURE', 'ann_seed_default')] })
  equal('FEATURE default+disable resolver count', featureDefault, await sqlCount(Prisma.sql`
    SELECT COUNT(*)::int AS count FROM "User" u
    WHERE ${teamMembershipSql({
      extra: Prisma.sql`(
        EXISTS (
          SELECT 1 FROM "TeamFeatureGrant" g
          WHERE g."teamId" = t.id AND g."featureKey" = 'ann_seed_default' AND g.enabled = true
        )
        OR (
          NOT EXISTS (
            SELECT 1 FROM "TeamFeatureGrant" g
            WHERE g."teamId" = t.id AND g."featureKey" = 'ann_seed_default'
          )
          AND EXISTS (
            SELECT 1 FROM "PlatformFeature" f
            WHERE f.key = 'ann_seed_default' AND f."defaultEnabled" = true
          )
        )
      )`,
    })}
  `))

  const localeZh = await countAudience({ userId: null, rules: [rule('LOCALE', 'zh')] })
  equal('LOCALE zh resolver count', localeZh, await sqlCount(Prisma.sql`
    SELECT COUNT(*)::int AS count FROM "User" u
    WHERE u.locale = 'zh' OR (u.locale IS NULL AND ${globalLocale} = 'zh')
  `))

  const active7 = await countAudience({ userId: null, rules: [rule('ACTIVE_STATUS', 'ACTIVE_7D')] })
  equal('ACTIVE_STATUS ACTIVE_7D resolver count', active7, await sqlCount(Prisma.sql`
    SELECT COUNT(*)::int AS count FROM "User" u
    WHERE ${teamMembershipSql({ extra: Prisma.sql`tm."lastActiveAt" >= ${cutoff7}` })}
  `))

  const inactive30 = await countAudience({ userId: null, rules: [rule('ACTIVE_STATUS', 'INACTIVE_30D')] })
  equal('ACTIVE_STATUS INACTIVE_30D resolver count', inactive30, await sqlCount(Prisma.sql`
    SELECT COUNT(*)::int AS count FROM "User" u
    WHERE EXISTS (
      SELECT 1 FROM "TeamMember" tm JOIN "Team" t ON t.id = tm."teamId"
      WHERE tm."userId" = u.id AND tm.status = 'ACTIVE' AND t.status = 'ACTIVE'
    )
    AND NOT EXISTS (
      SELECT 1 FROM "TeamMember" tm JOIN "Team" t ON t.id = tm."teamId"
      WHERE tm."userId" = u.id AND tm.status = 'ACTIVE' AND t.status = 'ACTIVE' AND tm."lastActiveAt" >= ${cutoff30}
    )
  `))

  const neverActive = await countAudience({ userId: null, rules: [rule('ACTIVE_STATUS', 'NEVER_ACTIVE')] })
  equal('ACTIVE_STATUS NEVER_ACTIVE resolver count', neverActive, await sqlCount(Prisma.sql`
    SELECT COUNT(*)::int AS count FROM "User" u
    WHERE EXISTS (
      SELECT 1 FROM "TeamMember" tm JOIN "Team" t ON t.id = tm."teamId"
      WHERE tm."userId" = u.id AND tm.status = 'ACTIVE' AND t.status = 'ACTIVE'
    )
    AND NOT EXISTS (
      SELECT 1 FROM "TeamMember" tm JOIN "Team" t ON t.id = tm."teamId"
      WHERE tm."userId" = u.id AND tm.status = 'ACTIVE' AND t.status = 'ACTIVE' AND tm."lastActiveAt" IS NOT NULL
    )
  `))
  const neverActiveContext = await loadUserAudienceContext(memberNl.id)
  check(
    Boolean(neverActiveContext && userMatchesAudience(neverActiveContext, { userId: null, rules: [rule('ACTIVE_STATUS', 'NEVER_ACTIVE')] })),
    'NEVER_ACTIVE seed member matches its own rule',
  )

  const excluded = await countAudience({
    userId: null,
    rules: [rule('TEAM', TEAM_A), rule('USER', owner.id, 'EXCLUDE')],
  })
  const teamAWithoutOwner = await sqlCount(Prisma.sql`
    SELECT COUNT(*)::int AS count FROM "User" u
    WHERE ${teamMembershipSql({ teamId: TEAM_A })} AND u.id <> ${owner.id}
  `)
  equal('EXCLUDE user resolver count', excluded, teamAWithoutOwner)
  check(excluded === teamACount - 1, 'EXCLUDE user removes exactly one seeded member', { excluded, teamACount })

  const sample = await sampleAudience({ userId: null, rules: [rule('TEAM', TEAM_A)] }, 20)
  check(sample.length <= teamACount, 'audience sample length respects audience')
  check(sample.every((user) => user.contact === null || user.contact.includes('*')), 'audience sample masks contacts', sample.map((user) => user.contact))
  check(
    sample.every((user) => ![owner.email, admin.email, memberZh.email, memberDe.email, browserAdmin.email].includes(user.contact || '')),
    'audience sample never returns a full seed email',
  )

  // ── New member + non-audience isolation ───────────────────────────────────
  const teamOnly = await createAnnouncement({
    title: '[ANN-VERIFY] Team A only',
    status: 'ACTIVE',
    startAt: new Date(SEED_NOW.getTime() - 60 * 60 * 1000),
    publishedAt: new Date(SEED_NOW.getTime() - 60 * 60 * 1000),
    audienceCount: teamACount + 1,
    rules: [rule('TEAM', TEAM_A)],
  })

  const temporaryUser = await prisma.user.create({
    data: {
      email: `ann-temp-member-${Date.now()}@example.invalid`,
      password: await bcrypt.hash(`temp-${Date.now()}`, 4),
      name: 'Ann Temp Member',
      locale: 'zh',
      onboardingCompleted: true,
      role: 'ADMIN',
    },
  })
  tempUserId = temporaryUser.id
  await prisma.teamMember.create({
    data: { teamId: TEAM_A, userId: temporaryUser.id, role: 'MEMBER', status: 'ACTIVE', lastActiveAt: SEED_NOW },
  })

  const tempContext = await loadUserAudienceContext(temporaryUser.id)
  check(Boolean(tempContext), 'new member has an audience context')
  if (tempContext) {
    check(userMatchesAudience(tempContext, audienceSourceOf(teamOnly)), 'new member matches current Team A rules')
    const tempFeed = await loadAnnouncementFeed(temporaryUser.id)
    check(Boolean(tempFeed?.items.some((item) => item.id === teamOnly.id)), 'new member active feed includes Team A announcement')
  }

  const memberEnContext = await loadUserAudienceContext(memberEn.id)
  check(Boolean(memberEnContext && !userMatchesAudience(memberEnContext, audienceSourceOf(teamOnly))), 'Team B member does not match Team A rules')
  const memberEnFeed = await loadAnnouncementFeed(memberEn.id)
  check(Boolean(memberEnFeed && !memberEnFeed.items.some((item) => item.id === teamOnly.id)), 'non-audience active feed excludes Team A announcement')

  // ── Lifecycle clock ───────────────────────────────────────────────────────
  const due = await createAnnouncement({
    title: '[ANN-VERIFY] lifecycle due',
    status: 'SCHEDULED',
    startAt: new Date(SEED_NOW.getTime() - 60 * 60 * 1000),
    publishedAt: new Date(SEED_NOW.getTime() - 2 * 60 * 60 * 1000),
    rules: [rule('TEAM', TEAM_A)],
  })
  const ended = await createAnnouncement({
    title: '[ANN-VERIFY] lifecycle ended',
    status: 'ACTIVE',
    startAt: new Date(SEED_NOW.getTime() - 2 * 60 * 60 * 1000),
    endAt: new Date(SEED_NOW.getTime() - 60 * 60 * 1000),
    publishedAt: new Date(SEED_NOW.getTime() - 2 * 60 * 60 * 1000),
    rules: [rule('TEAM', TEAM_A)],
  })
  const pausedEnded = await createAnnouncement({
    title: '[ANN-VERIFY] lifecycle paused ended',
    status: 'PAUSED',
    startAt: new Date(SEED_NOW.getTime() - 2 * 60 * 60 * 1000),
    endAt: new Date(SEED_NOW.getTime() - 60 * 60 * 1000),
    publishedAt: new Date(SEED_NOW.getTime() - 2 * 60 * 60 * 1000),
    rules: [rule('TEAM', TEAM_A)],
  })
  const future = await createAnnouncement({
    title: '[ANN-VERIFY] lifecycle future',
    status: 'SCHEDULED',
    startAt: new Date(SEED_NOW.getTime() + 60 * 60 * 1000),
    publishedAt: new Date(SEED_NOW.getTime() + 60 * 60 * 1000),
    rules: [rule('TEAM', TEAM_A)],
  })

  await syncAnnouncementLifecycles(true)
  const lifecycleRows = await prisma.platformAnnouncement.findMany({
    where: { id: { in: [due.id, ended.id, pausedEnded.id, future.id] } },
    select: { id: true, status: true },
  })
  const statusById = new Map(lifecycleRows.map((row) => [row.id, row.status]))
  equal('SCHEDULED crossing start becomes ACTIVE', statusById.get(due.id), 'ACTIVE')
  equal('ACTIVE crossing end becomes EXPIRED', statusById.get(ended.id), 'EXPIRED')
  equal('PAUSED crossing end becomes EXPIRED', statusById.get(pausedEnded.id), 'EXPIRED')
  equal('SCHEDULED before start stays SCHEDULED', statusById.get(future.id), 'SCHEDULED')

  // ── Receipts, cross-mode state, stats ─────────────────────────────────────
  const receipt = await createAnnouncement({
    title: '[ANN-VERIFY] receipt',
    userId: owner.id,
    status: 'ACTIVE',
    primaryMode: 'INBOX',
    startAt: new Date(SEED_NOW.getTime() - 60 * 60 * 1000),
    publishedAt: new Date(SEED_NOW.getTime() - 60 * 60 * 1000),
    audienceCount: 1,
    rules: [rule('USER', owner.id)],
  })

  const readFirst = await recordRead(owner.id, [receipt.id], 'INBOX')
  const readSecond = await recordRead(owner.id, [receipt.id], 'INBOX')
  equal('READ first call marks one', readFirst.ok && readFirst.marked, 1)
  equal('READ second call is idempotent', readSecond.ok && readSecond.marked, 1)
  equal('READ event count stays one', await prisma.announcementEvent.count({ where: { announcementId: receipt.id, type: 'READ' } }), 1)

  await recordImpression(owner.id, receipt.id, 'BANNER', 'session-a')
  await recordImpression(owner.id, receipt.id, 'BANNER', 'session-a')
  const afterSecondSession = await recordImpression(owner.id, receipt.id, 'BANNER', 'session-b')
  const stateAfterImpressions = await prisma.platformAnnouncementRead.findUniqueOrThrow({
    where: { announcementId_userId: { announcementId: receipt.id, userId: owner.id } },
  })
  equal('IMPRESSION event deduped per Beijing day', await prisma.announcementEvent.count({ where: { announcementId: receipt.id, type: 'IMPRESSION' } }), 1)
  equal('IMPRESSION shownCount deduped per browser session', stateAfterImpressions.shownCount, 2)
  equal('IMPRESSION impressionCount follows event rows', stateAfterImpressions.impressionCount, 1)
  check(Boolean(afterSecondSession.ok), 'third impression (second session) succeeds')

  await recordAck(owner.id, receipt.id, 'MODAL')
  await recordAck(owner.id, receipt.id, 'MODAL')
  const ackState = await prisma.platformAnnouncementRead.findUniqueOrThrow({
    where: { announcementId_userId: { announcementId: receipt.id, userId: owner.id } },
  })
  check(Boolean(ackState.readAt && ackState.acknowledgedAt), 'ACK fills acknowledgedAt and readAt')
  equal('ACK event count stays one', await prisma.announcementEvent.count({ where: { announcementId: receipt.id, type: 'ACK' } }), 1)

  await recordDismiss(owner.id, receipt.id, 'BANNER')
  await recordDismiss(owner.id, receipt.id, 'BANNER')
  equal('DISMISS event count stays one', await prisma.announcementEvent.count({ where: { announcementId: receipt.id, type: 'DISMISS' } }), 1)

  const ownerFeed = await loadAnnouncementFeed(owner.id)
  const feedRow = ownerFeed?.items.find((item) => item.id === receipt.id)
  check(Boolean(feedRow?.acknowledgedAt && feedRow?.dismissedAt), 'feed exposes shared ACK/DISMISS state')

  const stats = await loadStatsForAnnouncement({
    id: receipt.id,
    audienceSource: audienceSourceOf(receipt),
    audienceSnapshot: 1,
    audienceResolvedAt: SEED_NOW,
    filters: {},
  })
  equal('STATS audience current', stats.audience.current, 1)
  equal('STATS impression totals', stats.totals.IMPRESSION, { events: 1, users: 1 })
  equal('STATS read totals', stats.totals.READ, { events: 1, users: 1 })
  equal('STATS ack totals', stats.totals.ACK, { events: 1, users: 1 })
  equal('STATS dismiss totals', stats.totals.DISMISS, { events: 1, users: 1 })
  equal('STATS read rate', stats.rates.read, 1)
  equal('STATS ack rate', stats.rates.ack, 1)
  check(stats.byMode.some((row) => row.mode === 'BANNER' && row.type === 'IMPRESSION'), 'STATS by-mode contains banner impression')

  const ackRequired = await createAnnouncement({
    title: '[ANN-VERIFY] ack required',
    userId: owner.id,
    status: 'ACTIVE',
    primaryMode: 'MODAL',
    priority: 60,
    ackRequired: true,
    startAt: new Date(SEED_NOW.getTime() - 60 * 60 * 1000),
    publishedAt: new Date(SEED_NOW.getTime() - 60 * 60 * 1000),
    audienceCount: 1,
    rules: [rule('USER', owner.id)],
  })
  const blockedDismiss = await recordDismiss(owner.id, ackRequired.id, 'MODAL')
  check(!blockedDismiss.ok && blockedDismiss.code === 'ACK_REQUIRED', 'ACK-required announcement cannot be dismissed before ACK')
  const requiredAck = await recordAck(owner.id, ackRequired.id, 'MODAL')
  check(Boolean(requiredAck.ok), 'ACK-required announcement accepts ACK')
  const allowedDismiss = await recordDismiss(owner.id, ackRequired.id, 'MODAL')
  check(Boolean(allowedDismiss.ok), 'ACK-required announcement dismisses after ACK')

  // ── Legacy compatibility ──────────────────────────────────────────────────
  const legacyRead = await prisma.platformAnnouncementRead.findFirst({
    where: { readAt: { not: null } },
    orderBy: { readAt: 'asc' },
    select: { announcementId: true, readAt: true },
  })
  if (legacyRead) {
    const legacyAnnouncement = await prisma.platformAnnouncement.findUnique({
      where: { id: legacyRead.announcementId },
      select: { type: true, status: true, primaryMode: true, startAt: true, publishedAt: true },
    })
    check(
      Boolean(legacyAnnouncement && legacyAnnouncement.type === 'MESSAGE' && legacyAnnouncement.status === 'ACTIVE' && legacyAnnouncement.primaryMode === 'INBOX' && legacyAnnouncement.startAt && legacyAnnouncement.publishedAt),
      'legacy announcement mapped to MESSAGE/ACTIVE/INBOX with start/published time',
      legacyAnnouncement,
    )
    check(Boolean(legacyRead.readAt), 'legacy readAt preserved')
  } else {
    check(false, 'legacy read receipt exists for migration check')
  }

  // Deliberately only the old columns; the schema defaults must supply the rest.
  const legacyStyle = await prisma.platformAnnouncement.create({
    data: { title: '[ANN-VERIFY] legacy-style', content: 'legacy-style body', userId: owner.id },
    select: { id: true },
  })
  tempAnnouncementIds.push(legacyStyle.id)
  const legacyStyleRow = await prisma.platformAnnouncement.findUniqueOrThrow({
    where: { id: legacyStyle.id },
    select: { type: true, status: true, primaryMode: true },
  })
  equal('legacy-style create defaults stay MESSAGE/ACTIVE/INBOX', legacyStyleRow, {
    type: 'MESSAGE', status: 'ACTIVE', primaryMode: 'INBOX',
  })

  // ── Token boundaries over HTTP ────────────────────────────────────────────
  let reachable = true
  try {
    const ping = await fetch(`${BASE}/api/health`)
    reachable = ping.ok
  } catch {
    reachable = false
  }
  if (!reachable) {
    check(false, `dev server reachable at ${BASE}`)
  } else {
    const adminSessionId = crypto.randomUUID()
    const platformSessionId = crypto.randomUUID()
    await registerAdminSession(browserAdmin.id, adminSessionId)
    await registerPlatformSession(browserAdmin.id, platformSessionId)
    const adminToken = jwt.sign({
      type: 'admin_access',
      userId: browserAdmin.id,
      email: browserAdmin.email,
      role: 'ADMIN',
      sessionId: adminSessionId,
    }, process.env.JWT_SECRET!, { expiresIn: 3600, algorithm: 'HS256' })
    const platformToken = jwt.sign({
      type: 'platform_access',
      userId: browserAdmin.id,
      email: browserAdmin.email,
      role: 'ADMIN',
      sessionId: platformSessionId,
    }, process.env.PLATFORM_JWT_SECRET || process.env.JWT_SECRET!, { expiresIn: 3600, algorithm: 'HS256' })

    const [anonPlatform, teamPlatform, platformPlatform, anonFeed, teamFeed] = await Promise.all([
      fetch(`${BASE}/api/platform/announcements`),
      fetch(`${BASE}/api/platform/announcements`, { headers: { Authorization: `Bearer ${adminToken}` } }),
      fetch(`${BASE}/api/platform/announcements`, { headers: { Authorization: `Bearer ${platformToken}` } }),
      fetch(`${BASE}/api/announcements`),
      fetch(`${BASE}/api/announcements`, { headers: { Authorization: `Bearer ${adminToken}` } }),
    ])
    equal('anonymous platform API is rejected', anonPlatform.status, 401)
    equal('team token on platform API is rejected', teamPlatform.status, 401)
    equal('platform token reaches admin API', platformPlatform.status, 200)
    equal('anonymous receiver feed is rejected', anonFeed.status, 401)
    equal('team token reaches receiver feed', teamFeed.status, 200)
  }

  console.log(`\n${failures.length === 0 ? 'ALL PASS' : `${failures.length} FAILURE(S)`}`)
  if (failures.length > 0) console.log(failures.map((failure) => ` - ${failure}`).join('\n'))
}

main()
  .catch((error) => {
    console.error(error)
    failures.push('uncaught error')
  })
  .finally(async () => {
    if (tempAnnouncementIds.length > 0) {
      await prisma.announcementEvent.deleteMany({ where: { announcementId: { in: tempAnnouncementIds } } })
      await prisma.platformAnnouncementRead.deleteMany({ where: { announcementId: { in: tempAnnouncementIds } } })
      await prisma.announcementAudienceRule.deleteMany({ where: { announcementId: { in: tempAnnouncementIds } } })
      await prisma.platformAnnouncement.deleteMany({ where: { id: { in: tempAnnouncementIds } } })
    }
    if (tempUserId) {
      await prisma.user.deleteMany({ where: { id: tempUserId } })
    }
    await prisma.$disconnect()
    await domainPrisma.$disconnect()
    process.exit(failures.length === 0 ? 0 : 1)
  })
