/**
 * Read-only local regression check for the surfaces around the announcement
 * system: the legacy /platform/messages list shape, the feedback inbox, and
 * the receiver feed for an existing platform admin. Mints in-memory tokens;
 * never prints them.
 */
import 'dotenv/config'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import { prisma } from '../src/lib/db'
import { registerAdminSession } from '../src/lib/studio-session-registry'
import { registerPlatformSession } from '../src/lib/platform-session-registry'

function assertLocalDatabase() {
  const raw = process.env.DATABASE_URL
  if (!raw) throw new Error('DATABASE_URL is missing')
  const url = new URL(raw)
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname) || url.pathname !== '/vitransfer') {
    throw new Error(`Refusing to run against non-local database: ${url.hostname}${url.pathname}`)
  }
}

const failures: string[] = []
function check(ok: boolean, label: string, detail?: unknown) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`)
  if (!ok) failures.push(label)
}

async function main() {
  assertLocalDatabase()
  const admin = await prisma.user.findFirst({
    where: { isPlatformAdmin: true },
    select: { id: true, email: true, role: true },
  })
  if (!admin) throw new Error('No platform admin in local database')

  const platformSessionId = crypto.randomUUID()
  await registerPlatformSession(admin.id, platformSessionId)
  const platformToken = jwt.sign({
    type: 'platform_access',
    userId: admin.id,
    email: admin.email,
    role: admin.role,
    sessionId: platformSessionId,
  }, process.env.PLATFORM_JWT_SECRET || process.env.JWT_SECRET!, { expiresIn: 600, algorithm: 'HS256' })
  const platformHeaders = { Authorization: `Bearer ${platformToken}` }

  const list = await fetch('http://localhost:3000/api/platform/announcements?type=MESSAGE', { headers: platformHeaders })
  const listData = await list.json()
  const first = listData.items?.[0] || {}
  check(list.status === 200, 'legacy messages list returns 200', list.status)
  check(Array.isArray(listData.items), 'legacy messages list has items')
  check(
    ['id', 'title', 'content', 'createdAt', 'broadcast', 'targetName', 'readCount'].every((key) => key in first),
    'legacy messages list keeps the old field shape',
    Object.keys(first).slice(0, 12),
  )

  const feedback = await fetch('http://localhost:3000/api/platform/feedback', { headers: platformHeaders })
  check(feedback.status === 200, 'feedback inbox still returns 200', feedback.status)

  const adminSessionId = crypto.randomUUID()
  await registerAdminSession(admin.id, adminSessionId)
  const adminToken = jwt.sign({
    type: 'admin_access',
    userId: admin.id,
    email: admin.email,
    role: admin.role,
    sessionId: adminSessionId,
  }, process.env.JWT_SECRET!, { expiresIn: 600, algorithm: 'HS256' })
  const feed = await fetch('http://localhost:3000/api/announcements', { headers: { Authorization: `Bearer ${adminToken}` } })
  const feedData = await feed.json()
  check(feed.status === 200, 'receiver feed returns 200 for an existing admin', feed.status)
  check(
    (feedData.items || []).some((item: { title: string }) => item.title === '平台维护通知'),
    'receiver feed still contains the legacy announcement',
  )
  check(
    (feedData.items || []).every((item: { readAt: string | null }) => 'readAt' in item),
    'receiver feed still exposes legacy readAt',
  )

  console.log(failures.length === 0 ? '\nALL PASS' : `\n${failures.length} FAILURE(S)`)
  process.exit(failures.length === 0 ? 0 : 1)
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
