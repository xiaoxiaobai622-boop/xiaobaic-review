import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/encryption'   // 相对路径与 scripts/check-card-contract.mts:52 同口径；兄弟脚本 check-billing-flow.mts:4 用 '@/lib/encryption'，tsx 两种都吃

const BASE = process.env.BILLING_CHECK_BASE || 'http://localhost:3000'
const prisma = new PrismaClient()
const DAY = 86_400_000
const stamp = Date.now()
const pw = `gate-${stamp}`
const failures: string[] = []
const skips: string[] = []
const tokens: string[] = []   // 09-25 加：登录态在 Redis（TTL 12h），不登出就给已删掉的一次性账号留活会话壳子
let fatalExit = 0              // 09-25 改：brief 版的 login/缺 projectId 直接 process.exit，会跳过 finally 的清场 ⇒ 改成抛错走 catch，最后统一抬退出码

// M-8：行定位键全部由 stamp 派生 ⇒ 清场与读回来自查不依赖任何 create 返回的引用。
const teamSlug = `gate-${stamp}`
const ownerEmail = `gate-${stamp}@example.invalid`
const guestEmail = `gate2-${stamp}@example.invalid`
const fixtureEmails = [ownerEmail, guestEmail]

async function hit(method: string, path: string, token: string, body: unknown, want: number, label: string) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const json = await res.json().catch(() => null)
  // 403 必须同时是门禁给的 403：配额、手机号、权限都是 403，只有门禁带 code
  const ok = res.status === want && (want !== 403 || json?.code === 'TEAM_EXPIRED')
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${method} ${path} → ${res.status} code=${json?.code ?? '-'}`)
  if (!ok) failures.push(`${label} ${method} ${path}: ${JSON.stringify(json)?.slice(0, 160)}`)
  return json
}

/**
 * 内测期到期不参与写闸门（platform-access.ts 的 isTeamSubscriptionActive 恒 true），所以这里的判据
 * 反过来：唯一不许出现的是 code=TEAM_EXPIRED。不断 200 —— 这四种请求体各自还有配额、权限、必填字段
 * 的闸门，状态码不是本用例要证的东西，原样打印出来给人看。
 * 内测结束把到期判定放回去时，这段连同 hit() 的 403 分支一起换回上一版的四条「被拦」断言。
 */
async function noExpiryGate(method: string, path: string, token: string, body: unknown, label: string) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const json = await res.json().catch(() => null)
  const ok = json?.code !== 'TEAM_EXPIRED'
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${method} ${path} → ${res.status} code=${json?.code ?? '-'}`)
  if (!ok) failures.push(`${label} ${method} ${path}: ${JSON.stringify(json)?.slice(0, 160)}`)
}

async function login(email: string) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: pw }),
  })
  const json = await res.json().catch(() => null)
  const token = json?.tokens?.accessToken
  if (!token) { console.error(`FAIL 登录 → ${res.status}`); throw new Error(`登录失败 → ${res.status}`) }
  tokens.push(token)
  return token as string
}

// 令牌族要各归各的撤销端点：这里只有团队侧令牌，全部走 /api/auth/logout。
async function logout(token: string) {
  await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => null)
}

/** 五枚 fixture 一次性建在 try 之内（M-8）：任何一枚抛错时 finally 仍能按派生键删掉已建成的行。 */
async function createFixtures() {
  const user = await prisma.user.create({ data: { email: ownerEmail, name: 'gate', password: await hashPassword(pw), phone: `139${String(stamp).slice(-8)}` } })
  const second = await prisma.user.create({ data: { email: guestEmail, name: 'gate2', password: await hashPassword(pw), phone: `138${String(stamp).slice(-8)}` } })
  const team = await prisma.team.create({
    data: {
      name: `gate-${stamp}`, slug: teamSlug, shareKey: `gate-${stamp}`,
      createdById: user.id, subscriptionPlan: 'MONTHLY', subscriptionExpiresAt: null,
      members: { create: { userId: user.id, role: 'OWNER', status: 'ACTIVE' } },
    },
  })
  const invite = await prisma.teamInvite.create({ data: { teamId: team.id, token: `gate-${stamp}`, createdById: user.id, expiresAt: new Date(Date.now() + DAY) } })
  const join = await prisma.teamJoinRequest.create({ data: { teamId: team.id, userId: second.id, status: 'PENDING' } })
  return { user, second, team, invite, join }
}

/**
 * 清场不依赖引用，只认 stamp 派生的唯一键（M-8）：invite/join 挂在团队上、user 挂在 email 上，
 * 所以哪怕 createFixtures 在第 2～5 枚上抛错、主体一行没跑，已经建成的行也照样被删干净。
 * 删除顺序的理由与原来一致：`Project.team` 与 `Project.createdBy`、`Team.createdBy`（TeamCreator）
 * 都是 onDelete: Restrict ⇒ 先删项目、再删团队、**最后**删用户；单删团队会直接抛。
 * 显式删 invite/join 是给 Cascade 兜底（`TeamInvite.team` / `TeamJoinRequest.team` 都是 onDelete: Cascade），
 * 不是替代它 —— 万一哪天 cascade 口径变了，这里仍然不漏行。
 */
async function teardown() {
  const gateTeam = await prisma.team.findFirst({ where: { slug: teamSlug }, select: { id: true } })
  if (gateTeam) {
    await prisma.project.deleteMany({ where: { teamId: gateTeam.id } })
    await prisma.teamInvite.deleteMany({ where: { teamId: gateTeam.id } })
    await prisma.teamJoinRequest.deleteMany({ where: { teamId: gateTeam.id } })
    await prisma.team.deleteMany({ where: { id: gateTeam.id } })
  }
  await prisma.user.deleteMany({ where: { email: { in: fixtureEmails } } })
}

try {
  const { user, second, team, invite, join } = await createFixtures()
  const owner = await login(user.email)
  const guest = await login(second.email)

  // A) 到期日为 null = 长期有效，必须放行（这一条挡住「上线第二天现网写不了」）
  const created = await hit('POST', '/api/projects', owner, { title: `gate-${stamp}`, authMode: 'NONE' }, 200, 'null 到期可建项目')
  const projectId: string | undefined = created?.id
  if (!projectId) throw new Error('拿不到 projectId，后面的用例判不了')

  // B) 翻成「昨天」：内测口径下四条写路径都不许再拿到 TEAM_EXPIRED
  await prisma.team.update({ where: { id: team.id }, data: { subscriptionExpiresAt: new Date(Date.now() - DAY) } })
  await noExpiryGate('POST', '/api/projects', owner, { title: 'gate-past', authMode: 'NONE' }, '昨天到期仍可建项目')
  await noExpiryGate('POST', '/api/videos', owner, { projectId, name: 'gate' }, '昨天到期仍可建视频')
  await noExpiryGate('POST', `/api/teams/${team.id}/invitations/${invite.token}/accept`, guest, {}, '昨天到期仍可接受邀请')
  await noExpiryGate('PATCH', `/api/teams/${team.id}/join-requests/${join.id}`, owner, { status: 'APPROVED' }, '昨天到期仍可审批入队')
  skips.push('presign：本地 STORAGE_PROVIDER=local，鉴权前就 400，未走 HTTP 验证 → diff 评审')
  skips.push('promote：需要一条真实 ProjectUpload（`uploadCompletedAt` 非空、文件已在存储上），伪造口径不稳 → diff 评审')

  // C) 翻到未来：同样可写，和 A/B 对照说明 subscriptionExpiresAt 这一列在写闸门里已经不起作用
  await prisma.team.update({ where: { id: team.id }, data: { subscriptionExpiresAt: new Date(Date.now() + 30 * DAY) } })
  await hit('POST', '/api/projects', owner, { title: `gate-ok-${stamp}`, authMode: 'NONE' }, 200, '未来到期可建项目')
} catch (err) {
  fatalExit = 1
  failures.push(`中断：${String(err).slice(0, 200)}`)
} finally {
  // 先登出再清库：Redis 里的 `*:sessions:* / *:session:* / *:device:*`（TTL 12h）不会跟着行一起消失。
  for (const t of tokens) await logout(t)
  try {
    await teardown()
  } catch (err) {
    console.error(`LEAK 临时数据没删干净，手工清：stamp=${stamp}（team.slug = ${teamSlug}，users = ${fixtureEmails.join(' / ')}）`, err)
    failures.push('清场抛错')
  }
  // 删完读回来自查：count() 的键同样由 stamp 派生（不引用 create 的返回值），
  // 所以 createFixtures 中途抛错时这一段仍然是有效的。`Project.createdBy` / `Team.createdBy`（TeamCreator）
  // 都是 onDelete: Restrict（前者干脆没写 onDelete，Prisma 默认即 Restrict），漏掉任何一条依赖就是一次 LEAK。
  const left = {
    team: await prisma.team.count({ where: { slug: teamSlug } }),
    users: await prisma.user.count({ where: { email: { in: fixtureEmails } } }),
    projects: await prisma.project.count({ where: { team: { slug: teamSlug } } }),
  }
  if (left.team + left.users + left.projects > 0) {
    console.error(`LEAK 读回来还有行：${JSON.stringify(left)} stamp=${stamp}`)
    failures.push('清场后仍有残留')
  }
  await prisma.$disconnect()
}

for (const s of skips) console.log(`SKIP ${s}`)
if (failures.length) { console.error(`\n${failures.length} 条失败：\n` + failures.join('\n')); process.exit(fatalExit || 1) }
console.log('\n全部断言通过（presign/promote 见上面 SKIP，按 diff 评审）')
