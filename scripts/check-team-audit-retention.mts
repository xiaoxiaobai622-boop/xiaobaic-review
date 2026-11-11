import { PrismaClient } from '@prisma/client'
import { purgeExpiredTeamAuditEvents } from '../src/lib/team-audit-retention'

const prisma = new PrismaClient()
const stamp = Date.now().toString(36)
const userIds: string[] = []
const teamIds: string[] = []
let failed = 0

function check(label: string, ok: boolean, detail: unknown = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : ` → ${JSON.stringify(detail)}`}`)
}

try {
  const owner = await prisma.user.create({
    data: {
      email: `retention-${stamp}@example.test`,
      phone: `19${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`,
      password: 'not-used',
      name: 'Retention Owner',
      role: 'MEMBER',
      onboardingCompleted: true,
    },
  })
  userIds.push(owner.id)
  const team = await prisma.team.create({
    data: {
      id: String(760000 + Math.floor(Math.random() * 30000)),
      name: 'Retention Team',
      slug: `retention-${stamp}`,
      shareKey: `tm_ret_${stamp}`,
      createdById: owner.id,
      subscriptionPlan: 'BETA',
    },
  })
  teamIds.push(team.id)
  const now = new Date('2026-11-11T12:00:00.000Z')
  const old = new Date(now.getTime() - 181 * 24 * 60 * 60 * 1000)
  const fresh = new Date(now.getTime() - 179 * 24 * 60 * 60 * 1000)
  const oldEvent = await prisma.teamAuditEvent.create({
    data: { teamId: team.id, action: 'TEST_OLD', createdAt: old },
  })
  const freshEvent = await prisma.teamAuditEvent.create({
    data: { teamId: team.id, action: 'TEST_FRESH', createdAt: fresh },
  })

  const first = await purgeExpiredTeamAuditEvents({ now, batchSize: 1, maxBatches: 10 })
  const remaining = await prisma.teamAuditEvent.findMany({ where: { teamId: team.id }, select: { id: true } })
  check('181-day-old audit row is deleted', !remaining.some((row) => row.id === oldEvent.id), remaining)
  check('179-day-old audit row is kept', remaining.some((row) => row.id === freshEvent.id), remaining)
  check('retention reports scanned/deleted/batches', first.deleted === 1 && first.batches === 1, first)

  const second = await purgeExpiredTeamAuditEvents({ now, batchSize: 1, maxBatches: 10 })
  const stillRemaining = await prisma.teamAuditEvent.findMany({ where: { teamId: team.id }, select: { id: true } })
  check('retention is idempotent', second.deleted === 0 && stillRemaining.some((row) => row.id === freshEvent.id), { second, stillRemaining })
} catch (error) {
  console.error('FATAL', error)
  failed += 1
} finally {
  await prisma.teamAuditEvent.deleteMany({ where: { teamId: { in: teamIds } } }).catch(() => null)
  await prisma.team.deleteMany({ where: { id: { in: teamIds } } }).catch(() => null)
  await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => null)
  await prisma.$disconnect()
  console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}
