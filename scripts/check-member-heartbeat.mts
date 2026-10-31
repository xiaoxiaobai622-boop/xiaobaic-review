/**
 * One-off DB-writing check for the member heartbeat.
 * Do not add this file to scripts/run-static-checks.mts: the CI runner must stay read-only.
 *
 * The HTTP branch is opt-in because a running `next dev` keeps the Prisma client
 * it loaded before `prisma generate`; restart the dev server, then run with
 * LIVE_HEARTBEAT=1 to exercise the route itself.
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { heartbeatCutoff, MEMBER_HEARTBEAT_THROTTLE_MS, recordMemberHeartbeat } from '../src/lib/member-activity'

const prisma = new PrismaClient()
const BASE = process.env.BASE_URL || 'http://localhost:3000'
const TEAM_A = '696021'
const TEAM_B = '583428'

const failures: string[] = []
function check(ok: boolean, label: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`)
  if (!ok) failures.push(label)
}

async function main() {
  const now = new Date('2026-10-30T12:00:00.000Z')
  check(
    heartbeatCutoff(now).toISOString() === new Date(now.getTime() - MEMBER_HEARTBEAT_THROTTLE_MS).toISOString(),
    'cutoff is exactly five minutes before now',
  )

  const suffix = Date.now()
  const email = `heartbeat-check-${suffix}@example.invalid`
  const password = `Hb-${suffix}-local`
  const user = await prisma.user.create({
    data: {
      email,
      phone: `199${String(suffix).slice(-8)}`,
      password: await bcrypt.hash(password, 10),
      name: 'Heartbeat Check',
      onboardingCompleted: true,
    },
  })
  await prisma.teamMember.createMany({
    data: [
      { teamId: TEAM_A, userId: user.id, role: 'MEMBER', status: 'ACTIVE' },
      { teamId: TEAM_B, userId: user.id, role: 'MEMBER', status: 'ACTIVE' },
    ],
  })

  try {
    const anonymous = await fetch(`${BASE}/api/studio/heartbeat`, { method: 'POST' })
    check(anonymous.status === 401, 'anonymous heartbeat is rejected')

    const first = await recordMemberHeartbeat({ userId: user.id, teamId: TEAM_A })
    check(first === 1, 'first heartbeat writes exactly one membership')

    const memberA = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: TEAM_A, userId: user.id } },
      select: { lastActiveAt: true },
    })
    const memberB = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: TEAM_B, userId: user.id } },
      select: { lastActiveAt: true },
    })
    check(!!memberA?.lastActiveAt, 'heartbeat writes lastActiveAt for the active team')
    check(memberB?.lastActiveAt === null, 'heartbeat leaves the other team membership untouched')

    const second = await recordMemberHeartbeat({ userId: user.id, teamId: TEAM_A })
    check(second === 0, 'immediate repeat is throttled')

    await prisma.teamMember.update({
      where: { teamId_userId: { teamId: TEAM_A, userId: user.id } },
      data: { lastActiveAt: new Date(Date.now() - MEMBER_HEARTBEAT_THROTTLE_MS - 60_000) },
    })
    const third = await recordMemberHeartbeat({ userId: user.id, teamId: TEAM_A })
    check(third === 1, 'stale heartbeat writes again after the throttle window')

    if (process.env.LIVE_HEARTBEAT === '1') {
      const login = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const token = (await login.json().catch(() => ({})))?.tokens?.accessToken
      check(login.ok && typeof token === 'string' && token.length > 0, 'live heartbeat: temporary member can log in')

      if (token) {
        await prisma.teamMember.update({
          where: { teamId_userId: { teamId: TEAM_A, userId: user.id } },
          data: { lastActiveAt: null },
        })
        const headers = { Authorization: `Bearer ${token}`, 'X-Team-Id': TEAM_A }
        const liveFirst = await fetch(`${BASE}/api/studio/heartbeat`, { method: 'POST', headers })
        const liveFirstBody = await liveFirst.json().catch(() => ({}))
        const liveSecond = await fetch(`${BASE}/api/studio/heartbeat`, { method: 'POST', headers })
        const liveSecondBody = await liveSecond.json().catch(() => ({}))
        check(liveFirst.ok && liveFirstBody?.updated === 1, 'live heartbeat route updates once')
        check(liveSecond.ok && liveSecondBody?.updated === 0, 'live heartbeat route throttles the repeat')
      }
    }
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {})
    await prisma.$disconnect()
  }

  if (failures.length > 0) {
    console.error(`\n成员心跳 ${failures.length} 项不满足`)
    process.exit(1)
  }
  console.log('\n成员心跳 10 项全部通过')
}

main().catch(async (error) => {
  console.error(error)
  await prisma.$disconnect()
  process.exit(1)
})
