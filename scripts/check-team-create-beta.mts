/**
 * 建团入口的内测口径断言：新建团队必须是 BETA 套餐、永不过期、额度 5 人 / 10 GB（项目和视频不限），
 * 且 TeamQuota 行跟着一起建出来（否则 getTeamQuota 会走 upsert 兜底，测试就测不到建团那一段）。
 * 这条挡住「有人在 POST /api/teams 里把首团试用/月卡分支加回来」——改动点 2 的回归面。
 *
 * 跑法：npx tsx scripts/check-team-create-beta.mts（要他自己的 next dev 在 :3000 上活着）
 * 全程只在本地库建一次性 fixture，按 stamp 派生的团队名清场并在删完后读回来自查。
 */
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/encryption'

const BASE = process.env.BETA_CHECK_BASE || 'http://localhost:3000'
const prisma = new PrismaClient()
const stamp = Date.now()
const pw = `beta-${stamp}`
const teamName = `内测建团-${stamp}`
const email = `beta-${stamp}@example.invalid`
const tokens: string[] = []
const failures: string[] = []

function check(ok: boolean, label: string, got: unknown) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} → ${JSON.stringify(got)}`)
  if (!ok) failures.push(`${label}：拿到 ${JSON.stringify(got)}`)
}

try {
  const user = await prisma.user.create({
    data: { email, name: 'beta', password: await hashPassword(pw), phone: `136${String(stamp).slice(-8)}` },
  })

  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: pw }),
  })
  const loginJson = await loginRes.json().catch(() => null)
  const token = loginJson?.tokens?.accessToken
  if (!token) throw new Error(`登录失败 → ${loginRes.status}`)
  tokens.push(token)

  const createRes = await fetch(`${BASE}/api/teams`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: teamName }),
  })
  const createJson = await createRes.json().catch(() => null)
  const teamId: string | undefined = createJson?.team?.id
  if (!teamId) throw new Error(`建团队没拿到 id → ${createRes.status} ${JSON.stringify(createJson)?.slice(0, 200)}`)

  // 从库里读回来看，不看响应体：响应只证明它回了什么，落库才证明建团那段真的按 BETA 走
  const row = await prisma.team.findUnique({
    where: { id: teamId },
    select: { subscriptionPlan: true, subscriptionExpiresAt: true, slug: true, quota: true },
  })
  check(row?.subscriptionPlan === 'BETA', '新建团队 subscriptionPlan = BETA', row?.subscriptionPlan)
  check(row?.subscriptionExpiresAt === null, '新建团队 subscriptionExpiresAt = null（不过期）', row?.subscriptionExpiresAt)
  check(
    !!row?.quota && row.quota.maxMembers === 5 && row.quota.maxProjects === 0 && row.quota.maxVideos === 0 && row.quota.maxStorageGB === 10,
    'TeamQuota 行 = 5 人 / 不限项目 / 不限视频 / 10 GB',
    row?.quota && { maxMembers: row.quota.maxMembers, maxProjects: row.quota.maxProjects, maxVideos: row.quota.maxVideos, maxStorageGB: row.quota.maxStorageGB },
  )
  check(row?.quota?.source === 'PLAN', '额度行 source = PLAN（套餐给的，不是手工改的）', row?.quota?.source)

  // 额度真被读到：getTeamQuota 对这条新团队必须原样返回 5/10，而不是 upsert 兜底
  const quotaCount = await prisma.teamQuota.count({ where: { teamId } })
  check(quotaCount === 1, 'TeamQuota 只有一行（建团事务里就建好了）', quotaCount)

  await prisma.team.deleteMany({ where: { id: teamId } })
  await prisma.user.deleteMany({ where: { email } })
} catch (err) {
  failures.push(`中断：${String(err).slice(0, 200)}`)
} finally {
  for (const t of tokens) {
    await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${t}` } }).catch(() => null)
  }
  const left = {
    teams: await prisma.team.count({ where: { name: teamName } }),
    users: await prisma.user.count({ where: { email } }),
  }
  if (left.teams + left.users > 0) {
    console.error(`LEAK 读回来还有行：${JSON.stringify(left)}（团队名 ${teamName}，user ${email}）`)
    failures.push('清场后仍有残留')
  }
  await prisma.$disconnect()
}

if (failures.length) { console.error(`\n${failures.length} 条失败：\n` + failures.join('\n')); process.exit(1) }
console.log('\n全部断言通过')
