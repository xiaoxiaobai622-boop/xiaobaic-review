/**
 * 团队 ID 换成 6 位数字的判据（他 10-14 点单「换吧，全部都换」）。
 *
 * 钉四层：
 *  A 发号函数本身（纯函数，注入 random 后能判「撞号跳过」「随机位一直撞车改用线性扫」「号池满了大声报错」）；
 *  B 建团那一路真的用了它并显式传 id（不靠 schema 的 cuid 默认值——线上多一枚 cuid 号就等于这批活再干一遍）；
 *  C 真打一次 POST /api/teams：新建团队必须是 6 位数字、连建不重号、成员与额度行接的是同一枚号。
 *
 * 跑法：npx tsx scripts/check-team-numeric-id.mts（C 组要他自己的 next dev 在 :3000 上活着）
 * 只在本地库建一次性 fixture，跑完删干净 ⇒ 不进 CI。
 */
import { PrismaClient } from '@prisma/client'
import { existsSync, readFileSync } from 'node:fs'
import { hashPassword } from '../src/lib/encryption'

const BASE = process.env.NUMERIC_ID_CHECK_BASE || 'http://localhost:3000'
const prisma = new PrismaClient()
const stamp = Date.now()
const pw = `nid-${stamp}`
const email = `nid-${stamp}@example.invalid`
const failures: string[] = []
const tokens: string[] = []
const createdIds: string[] = []
let passed = 0

const SIX_DIGIT = /^[1-9]\d{5}$/
// 号池口径必须和 src/lib/team-id.ts 一致：100000–999999 共 900000 枚，首位非 0（前导 0 的号
// 复制进表格/终端会被吃掉，界面上那行就说不清自己是谁）。
const SPACE = 900_000

function check(ok: boolean, label: string, got: unknown = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${String(got) ? ` → ${String(got)}` : ''}`)
  if (ok) passed++
  else failures.push(`${label}${String(got) ? ` — ${String(got)}` : ''}`)
}

function stripComments(src: string) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}
function source(rel: string) {
  const file = new URL(`../src/${rel}`, import.meta.url)
  return existsSync(file) ? stripComments(readFileSync(file, 'utf8')) : ''
}

// 发号模块还没长出来时，A 组按「红」逐条报，而不是抛一个模块缺失的堆栈：判据得先红得看得懂。
let teamIdModule: typeof import('../src/lib/team-id') | undefined
try {
  teamIdModule = await import('../src/lib/team-id')
} catch {
  console.log('（src/lib/team-id.ts 还没长出来，A 组全部记 FAIL）')
}

async function main() {
  // ── A 组：发号函数本身 ─────────────────────────────────────────────────
  if (teamIdModule) {
    const { pickTeamId, isTeamId } = teamIdModule
    const first = pickTeamId(new Set<string>(), () => 0.5)
    check(SIX_DIGIT.test(first), 'A1 空表也能发号，且是 6 位数字、首位非 0', first)
    check(first === '550000', 'A1b 随机数给多少就落多少（0.5 ⇒ 区间中点 550000，能手算不是硬编码）', first)

    const second = pickTeamId(new Set(['550000']), () => 0.5)
    check(second !== '550000' && SIX_DIGIT.test(second), 'A2 那一枚被占了就换一枚（同一个 random 值不许连发两次）', second)

    const blocked = new Set(['550000', '550001', '550002'])
    const third = pickTeamId(blocked, () => 0.5)
    check(!blocked.has(third) && SIX_DIGIT.test(third), 'A3 随机位一直撞车时改用线性扫，仍然发得出号', third)

    // 只剩 100000 一枚：随机位永远落在别人身上，必须靠线性扫兜住
    const nearlyFull = { has: (v: string) => v !== '100000', size: SPACE - 1 }
    check(pickTeamId(nearlyFull, () => 0.5) === '100000', 'A4 号池只剩一枚时不许提前放弃，要发那一枚', '')

    const full = { has: () => true, size: SPACE }
    let threw = ''
    try { pickTeamId(full, () => 0.5) } catch (e) { threw = (e as Error).message }
    check(threw === 'TEAM_ID_LIMIT_REACHED', 'A5 号池满了抛 TEAM_ID_LIMIT_REACHED，不许返回一枚重复号糊过去', threw)

    check(isTeamId('123456') && !isTeamId('12345') && !isTeamId('1234567') && !isTeamId('023456')
      && !isTeamId('cmt7746cz0008n5ulzo6ms1wz') && !isTeamId('team_default') && !isTeamId(''),
      'A6 isTeamId 只认「正好 6 位、首位非 0」：cuid 与最早那枚 team_default 都不算换好了', '')
  } else {
    for (const label of [
      'A1 空表也能发号，且是 6 位数字、首位非 0',
      'A1b 随机数给多少就落多少（0.5 ⇒ 区间中点 550000，能手算不是硬编码）',
      'A2 那一枚被占了就换一枚（同一个 random 值不许连发两次）',
      'A3 随机位一直撞车时改用线性扫，仍然发得出号',
      'A4 号池只剩一枚时不许提前放弃，要发那一枚',
      'A5 号池满了抛 TEAM_ID_LIMIT_REACHED，不许返回一枚重复号糊过去',
      'A6 isTeamId 只认「正好 6 位、首位非 0」：cuid 与最早那枚 team_default 都不算换好了',
    ]) check(false, label)
  }

  // ── B 组：建团那一路真的接上了 ─────────────────────────────────────────
  const route = source('app/api/teams/route.ts')
  const createAt = route.search(/tx\.team\.create\(/)
  const allocAt = route.search(/allocateTeamId\(/)
  check(createAt > 0 && allocAt >= 0 && allocAt < createAt,
    'B1 发号跑在建团之前（建完再补就是先落一枚 cuid，补不回来）', `→ alloc@${allocAt}，create@${createAt}`)
  check(createAt > 0 && /id:\s*teamId\b/.test(route.slice(createAt, createAt + 300)),
    'B2 team.create 的载荷里显式带 id（不靠 schema 的 cuid 默认值）',
    `→ ${JSON.stringify(route.slice(createAt, createAt + 110).replace(/\s+/g, ' '))}`)
  check(/allocateTeamId\(tx\)/.test(route),
    'B3 发号用的是同一个事务句柄（和团队标识共用那把 advisory lock，两路并发都不会重号）', '')

  // ── C 组：真打一次接口 ─────────────────────────────────────────────────
  await prisma.user.create({
    data: { email, name: 'NID Owner', password: await hashPassword(pw), phone: `137${String(stamp).slice(-8)}` },
  })
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: pw }),
  })
  const token = (await loginRes.json().catch(() => null))?.tokens?.accessToken
  if (!token) throw new Error(`登录失败 → ${loginRes.status}`)
  tokens.push(token)

  for (const n of [1, 2, 3]) {
    const res = await fetch(`${BASE}/api/teams`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: `数字号建团-${stamp}-${n}` }),
    })
    const body = await res.json().catch(() => null)
    const id = String(body?.team?.id ?? body?.id ?? '')
    if (id) createdIds.push(id)
    check(res.status === 201 && SIX_DIGIT.test(id), `C${n} POST /api/teams 发回来的是 6 位数字`, `→ ${res.status} ${JSON.stringify(id)}`)
  }
  check(createdIds.length === 3 && new Set(createdIds).size === 3, 'C4 连建三枚不重号', `→ ${JSON.stringify(createdIds)}`)

  for (const id of createdIds) {
    const [row, members, quota] = await Promise.all([
      prisma.team.findUnique({ where: { id }, select: { id: true, slug: true, shareKey: true } }),
      prisma.teamMember.count({ where: { teamId: id, role: 'OWNER' } }),
      prisma.teamQuota.count({ where: { teamId: id } }),
    ])
    check(members === 1 && quota === 1, `C5 ${id} 的成员行与额度行接的是同一枚号`, `→ 成员 ${members}，额度 ${quota}`)
    check(SIX_DIGIT.test(String(row?.id ?? '')), `C6 库里的 Team.id 本身就是这枚 6 位数字（不是界面另找的一列）`, `→ ${JSON.stringify(row?.id)}`)
    check(!!row && row.shareKey !== row.id,
      `C7 新团队的分享键不再等于团队 ID（老团队有两行恰好相等，界面一改就说不清哪枚是谁）`,
      `→ shareKey ${JSON.stringify(row?.shareKey)}`)
  }

  if (createdIds[0]) {
    const detail = await fetch(`${BASE}/api/teams/${createdIds[0]}`, {
      headers: { authorization: `Bearer ${token}` }, cache: 'no-store',
    }).then(r => r.json().catch(() => null))
    check(SIX_DIGIT.test(String(detail?.team?.id ?? detail?.id ?? '')),
      'C8 「团队信息」那行拿到的就是这枚 6 位数字（界面不用改列）',
      `→ ${JSON.stringify(detail?.team?.id ?? detail?.id ?? Object.keys(detail ?? {}).slice(0, 5))}`)
  }

  console.log(`\n合计 ${passed} PASS / ${failures.length} FAIL`)
  if (failures.length) for (const f of failures) console.log(` - ${f}`)
  if (failures.length) process.exitCode = 1
}

try {
  await main()
} finally {
  for (const t of tokens) await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${t}` } }).catch(() => null)
  if (createdIds.length) await prisma.team.deleteMany({ where: { id: { in: createdIds } } }).catch(() => null)
  await prisma.user.deleteMany({ where: { email } }).catch(() => null)
  const [leftTeams, leftUser] = await Promise.all([
    prisma.team.count({ where: { id: { in: createdIds } } }),
    prisma.user.count({ where: { email } }),
  ])
  await prisma.$disconnect()
  console.log(`夹具清理：剩余团队 ${leftTeams}，剩余账号 ${leftUser}`)
}
