import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/encryption'
import { getTeamQuota, BETA_QUOTA } from '../src/lib/platform-access'

/**
 * 额度读取不该落库（整改 D1）。判据钉三件事：
 *  1 只读一次额度（lib 与 HTTP 两条路各一次）都不给缺行团队补写 quota 行 —— 之前是 `upsert`，
 *    所以「线上 6 个团队只有 4 行 quota」这件事本身会被一次查看抹掉一行差异；
 *  2 缺行团队读到的必须是内测口径（5 人 / 10 GB / 项目与视频 0＝不限），不是 schema 默认（10 / 20 / 5 / 50）；
 *  3 唯一该落行的口子是后台手动改额度（PATCH），且部分修改不许让其余键落到 schema 默认上。
 * 键全部由 stamp 派生，finally 清场并读回。
 */
const BASE = process.env.PLATFORM_CHECK_BASE || 'http://localhost:3000'
const prisma = new PrismaClient()
const stamp = Date.now()
const failures: string[] = []
const tokens: string[] = []

const slug = `quota-${stamp}`
const adminEmail = `quota-admin-${stamp}@example.invalid`
const pw = `quota-${stamp}`

function check(ok: boolean, label: string, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` ${detail}` : ''}`)
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

async function call(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

async function quotaRowCount(teamId: string) {
  return prisma.teamQuota.count({ where: { teamId } })
}

try {
  const admin = await prisma.user.create({
    data: { email: adminEmail, name: 'quota-admin', password: await hashPassword(pw), isPlatformAdmin: true },
  })
  const team = await prisma.team.create({
    data: { name: slug, slug, shareKey: slug, createdById: admin.id, subscriptionPlan: 'BETA' },
  })

  // 前提：直接建出来的团队没有 quota 行（`POST /api/teams` 才会连带建一行，这里刻意绕开它）。
  check(await quotaRowCount(team.id) === 0, '前提：新团队本来就没有 quota 行')

  const quota = await getTeamQuota(team.id)
  check(quota.maxMembers === BETA_QUOTA.maxMembers && quota.maxStorageGB === BETA_QUOTA.maxStorageGB
    && quota.maxProjects === BETA_QUOTA.maxProjects && quota.maxVideos === BETA_QUOTA.maxVideos,
    '行为：缺行团队读到内测口径（5 人 / 10 GB / 0 不限）',
    `→ ${quota.maxMembers}/${quota.maxStorageGB}GB/${quota.maxProjects}/${quota.maxVideos}`)
  check(await quotaRowCount(team.id) === 0, '行为：lib 读一次额度后仍不许落行', `→ ${await quotaRowCount(team.id)} 行`)

  const login = await call('POST', '/api/platform/auth/login', '', { identifier: adminEmail, password: pw })
  const token = login.json?.tokens?.accessToken
  if (!token) throw new Error(`平台登录失败 → ${login.status}`)
  tokens.push(token)

  const got = await call('GET', `/api/platform/teams/${team.id}/quota`, token)
  check(got.status === 200 && got.json?.quota?.maxStorageGB === BETA_QUOTA.maxStorageGB,
    '行为：后台 GET 额度返回内测口径', `→ ${got.status} ${JSON.stringify(got.json?.quota)?.slice(0, 120)}`)
  check(await quotaRowCount(team.id) === 0, '行为：后台 GET 一次额度后仍不许落行', `→ ${await quotaRowCount(team.id)} 行`)

  // 手动改额度是唯一该落行的口子；只发一枚键，其余三键必须是内测基线而不是 schema 默认。
  const patched = await call('PATCH', `/api/platform/teams/${team.id}/quota`, token, { maxMembers: 8 })
  const row = await prisma.teamQuota.findUnique({ where: { teamId: team.id } })
  check(patched.status === 200 && !!row && row.maxMembers === 8 && row.source === 'MANUAL',
    '行为：PATCH 之后才落行且 source=MANUAL', `→ ${patched.status} ${JSON.stringify(row)?.slice(0, 120)}`)
  check(!!row && row.maxStorageGB === BETA_QUOTA.maxStorageGB && row.maxProjects === BETA_QUOTA.maxProjects
    && row.maxVideos === BETA_QUOTA.maxVideos,
    '行为：部分修改不许让其余键掉到 schema 默认（10/20GB/5/50）',
    `→ ${row?.maxMembers}/${row?.maxStorageGB}GB/${row?.maxProjects}/${row?.maxVideos}`)

  const after = await call('GET', `/api/platform/teams/${team.id}/quota`, token)
  check(after.json?.quota?.maxMembers === 8, '行为：落行之后读到的是手动值', `→ ${after.json?.quota?.maxMembers}`)
} catch (err) {
  failures.push(`中断：${String(err).slice(0, 1200)}`)
  console.error(`中断：${String(err).slice(0, 1200)}`)
} finally {
  for (const t of tokens) {
    await fetch(`${BASE}/api/platform/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${t}` } }).catch(() => null)
  }
  const quotaTeam = await prisma.team.findFirst({ where: { slug }, select: { id: true } })
  if (quotaTeam) {
    // quota 行跟着团队级联删（TeamQuota.team onDelete: Cascade），项目先删是 Project.createdBy 的默认 Restrict。
    await prisma.project.deleteMany({ where: { teamId: quotaTeam.id } })
    await prisma.teamQuota.deleteMany({ where: { teamId: quotaTeam.id } })
    await prisma.team.deleteMany({ where: { id: quotaTeam.id } })
  }
  await prisma.user.deleteMany({ where: { email: adminEmail } })

  const left = {
    team: await prisma.team.count({ where: { slug } }),
    quota: await prisma.teamQuota.count({ where: { team: { slug } } }),
    users: await prisma.user.count({ where: { email: adminEmail } }),
  }
  if (left.team + left.quota + left.users > 0) {
    console.error(`LEAK 清场后仍有残留：${JSON.stringify(left)} stamp=${stamp}`)
    failures.push('清场后仍有残留')
  }
  await prisma.$disconnect()
}

if (failures.length) { console.error(`\n${failures.length} 条失败：\n` + failures.join('\n')); process.exit(1) }
console.log('\n全部断言通过')
