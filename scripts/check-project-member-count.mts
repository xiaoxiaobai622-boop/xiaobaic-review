import { existsSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { prisma } from '../src/lib/db'
import { hashPassword } from '../src/lib/encryption'

/**
 * 需求「项目信息身份行：去掉「审片中」徽标和后面的描述，改成**这个项目**的人数」。判据分三组：
 *  A 端点行为 —— 人数按项目算：同一名团队成员会不会被数进来，取决于他能不能打开这个项目
 *    （口径出处 `src/lib/project-access.ts`：团队 ACTIVE 成员 −「仅指定项目」且没被指派到本项目的人）；
 *  B 界面接线 —— 身份行第二行不再画状态徽标、不再画描述，改成人数；
 *  C 四语言 —— 新 key 一个不缺，且必须带数量插值（不许写死「团队成员」）。
 * 键全部由 stamp 派生，finally 按 slug 清场并读回残留。
 *
 * 夹具故意让三种口径得出三个不同数，否则「数团队」和「数 ProjectMember 空表」都能蒙过 A 组：
 *   团队 B 有 6 行成员 → 项目 b1 = 4、项目 b2 = 3；整条链只写了 1 行 `ProjectMember`（挂在 b1）。
 */
const BASE = process.env.SHARE_CHECK_BASE || 'http://localhost:3000'
const stamp = Date.now()
const failures: string[] = []
const teamASlug = `pmc-a-${stamp}`
const teamBSlug = `pmc-b-${stamp}`
const ownerPw = `pmc-${stamp}`
const MEMBER_KEYS = ['projectMemberCount']
const LOCALES = ['zh', 'en', 'de', 'nl']

function report(ok: boolean, label: string, kind: '行为' | '结构' | '文案', detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} [${kind}] ${label}${detail ? ` → ${detail}` : ''}`)
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

/** 相对脚本自己而不是 cwd 解析：`fs` 走的是进程工作目录，模块说明符走的才是本文件。 */
function readSource(rel: string): string | null {
  const file = fileURLToPath(new URL(`../src/${rel}`, import.meta.url))
  return existsSync(file) ? readFileSync(file, 'utf8') : null
}

function readLocale(locale: string): Record<string, any> {
  return JSON.parse(readSource(`locales/${locale}.json`) ?? '{}')
}

async function login(email: string) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: ownerPw }),
  })
  const json = await res.json().catch(() => null)
  return json?.tokens?.accessToken || ''
}

/**
 * `requireApiUser` 硬要求账号绑过手机号（src/lib/auth.ts:664 回 403 PHONE_REQUIRED），
 * 而 `User.phone` 是唯一键 —— 所以每个 fixture 用户都得有一枚没人占过的号，撞了就换一个。
 */
async function makeUser(email: string, name: string) {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      return await prisma.user.create({
        data: { email, name, password: await hashPassword(ownerPw), phone: `19${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}` },
      })
    } catch (error) {
      const target = (error as { meta?: { target?: string[] } })?.meta?.target ?? []
      if (target.includes('email')) throw error
      if ((error as { code?: string })?.code !== 'P2002') throw error
    }
  }
  throw new Error(`分配不到唯一手机号：${email}`)
}

async function readProject(projectId: string, token: string) {
  const res = await fetch(`${BASE}/api/projects/${projectId}`, {
    headers: { authorization: `Bearer ${token}` },
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

try {
  /**
   * 一枚团队 + 它自己的 owner + 它名下的项目。owner 必须一人一团：令牌里 `authorizedTeamId`
   * 只钉一枚团队（src/lib/auth.ts:666），同一账号跨两团时另一团的项目必然 403，那是夹具的错，
   * 不是端点的错。
   */
  async function makeTeam(slug: string, titles: string[]) {
    const owner = await makeUser(`${slug}-owner-${stamp}@example.invalid`, `${slug}-owner`)
    const team = await prisma.team.create({
      data: {
        name: slug, slug, shareKey: slug, createdById: owner.id,
        subscriptionPlan: 'BETA',
        members: { create: { userId: owner.id, role: 'OWNER', status: 'ACTIVE' } },
      },
    })
    const projects: Record<string, any> = {}
    for (const title of titles) {
      projects[title] = await prisma.project.create({
        data: {
          teamId: team.id, createdById: owner.id,
          projectCode: `PMC${title.toUpperCase()}${String(stamp).slice(-7)}`, title: `pmc-${title}`,
          slug: `pmc-${slug}-${title}`, shareSlug: `pmcs-${slug}-${title}`,
          description: `描述-${title}`, status: 'IN_REVIEW',
        },
      })
    }
    return { team, projects, owner }
  }

  /** 一名团队成员。`scope` 落在 User 上（`ASSIGNED_ONLY` 只约束 MEMBER 角色），`role`/`status` 落在团队行上。 */
  async function addMember(
    teamId: string, key: string, scope: 'ALL_PROJECTS' | 'ASSIGNED_ONLY',
    role: 'OWNER' | 'ADMIN' | 'MEMBER' = 'MEMBER', status: 'ACTIVE' | 'DISABLED' = 'ACTIVE',
  ) {
    const user = await makeUser(`${key}-${stamp}@example.invalid`, key)
    await prisma.user.update({ where: { id: user.id }, data: { projectAccessScope: scope } })
    const member = await prisma.teamMember.create({ data: { teamId, userId: user.id, role, status } })
    return member
  }

  /** 「指派进某个项目」＝运营后台用户编辑器那条链写的 `ProjectMember` 行（src/app/api/users/[id]/route.ts:302）。 */
  async function assign(memberUserId: string, projectId: string) {
    await prisma.projectMember.create({ data: { userId: memberUserId, projectId } })
  }

  // 团队 A：owner + 1 名全项目成员，没人被指派进项目 → 两枚项目都该是 2。
  const teamA = await makeTeam(teamASlug, ['a1', 'a2'])
  await addMember(teamA.team.id, 'pmc-a-m1', 'ALL_PROJECTS')

  // 团队 B：owner + 2 名全项目成员 + 1 名「仅指定项目」未被指派 + 1 名「仅指定项目」已指派进 b1
  //        + 1 名 DISABLED。→ b1 = 4、b2 = 3，而团队成员行数是 6。
  const teamB = await makeTeam(teamBSlug, ['b1', 'b2'])
  await addMember(teamB.team.id, 'pmc-b-m1', 'ALL_PROJECTS')
  await addMember(teamB.team.id, 'pmc-b-m2', 'ALL_PROJECTS')
  await addMember(teamB.team.id, 'pmc-b-m3', 'ASSIGNED_ONLY')
  const assigned = await addMember(teamB.team.id, 'pmc-b-m4', 'ASSIGNED_ONLY')
  await assign(assigned.userId, teamB.projects.b1.id)
  await addMember(teamB.team.id, 'pmc-b-m5', 'ALL_PROJECTS', 'MEMBER', 'DISABLED')

  const tokenA = await login(teamA.owner.email)
  const tokenB = await login(teamB.owner.email)
  report(!!tokenA && !!tokenB, 'A0 两枚团队的主账号都能登录', '行为')

  const statuses: number[] = []
  const read = async (project: any, token: string) => {
    const res = await readProject(project.id, token)
    statuses.push(res.status)
    return res.json
  }
  const a1 = await read(teamA.projects.a1, tokenA)
  const a2 = await read(teamA.projects.a2, tokenA)
  const b1 = await read(teamB.projects.b1, tokenB)
  const b2 = await read(teamB.projects.b2, tokenB)
  report(statuses.every(status => status === 200), 'A1 四枚项目的详情都读得到', '行为', statuses.join('/'))
  report([a1, a2, b1, b2].every(json => typeof json?.memberCount === 'number'), 'A2 每枚项目都带出数字型人数', '行为',
    [a1, a2, b1, b2].map(json => typeof json?.memberCount).join('/'))
  report(a1?.memberCount === 2 && a2?.memberCount === 2, 'A3 团队 A 的两枚项目都数到 2（没有指派行也照数）', '行为',
    `${a1?.memberCount}/${a2?.memberCount}`)
  report(b1?.memberCount === 4, 'A4 指派进本项目的成员计入（b1 = 4）', '行为', `返回 ${b1?.memberCount}，应为 4`)
  report(b2?.memberCount === 3, 'A5 同团队另一枚项目不认领这条指派（b2 = 3）', '行为', `返回 ${b2?.memberCount}，应为 3`)
  report(
    a1?.memberCount !== b1?.memberCount && b1?.memberCount !== b2?.memberCount,
    'A6 同一枚团队的两枚项目数出不同的数 → 口径真的按项目', '行为',
    `a1=${a1?.memberCount} b1=${b1?.memberCount} b2=${b2?.memberCount}`)
  const teamRows = await prisma.teamMember.count({ where: { teamId: teamB.team.id } })
  report(teamRows === 6 && b1?.memberCount !== teamRows && b2?.memberCount !== teamRows,
    'A7 排除项生效：未指派的「仅指定项目」成员和 DISABLED 都不进数', '行为', `团队行数 ${teamRows}`)
  const assignedRows = await prisma.projectMember.count({ where: { userId: assigned.userId } })
  report(assignedRows === 1 && b1?.memberCount === 4, 'A8 指派行只有 1 条，人数不是 ProjectMember 行数', '行为', `指派行 ${assignedRows}`)

  /** 人数说「这些人能进」，端点就得真的让他们进 —— 两边的集合必须同一批。 */
  const tokenUnassigned = await login(`pmc-b-m3-${stamp}@example.invalid`)
  const tokenAssigned = await login(`pmc-b-m4-${stamp}@example.invalid`)
  const denied = await readProject(teamB.projects.b2.id, tokenUnassigned)
  const allowed = await readProject(teamB.projects.b1.id, tokenAssigned)
  const stillDenied = await readProject(teamB.projects.b2.id, tokenAssigned)
  report(denied.status === 403 && stillDenied.status === 403,
    'A9 没被指派的人请求项目真的被拒（＝人数里排除的那批）', '行为', `m3→b2 ${denied.status}，m4→b2 ${stillDenied.status}`)
  report(!!tokenAssigned && allowed.status === 200, 'A10 被指派的人请求本项目读得到（＝人数里计入的那批）', '行为',
    `m4→b1 ${allowed.status}`)

  const ui = readSource('components/ProjectActions.tsx') || ''
  report(!!ui, 'B0 项目信息面板存在', '结构')
  report(!/statusInReview/.test(ui), 'B1 身份行不再画状态徽标', '结构')
  report(!/\(project as any\)\.description/.test(ui), 'B2 身份行不再画项目描述', '结构')
  report(/memberCount/.test(ui) && /projectMemberCount/.test(ui), 'B3 身份行改画成员人数', '结构')
  const route = readSource('app/api/projects/[id]/route.ts') || ''
  report(
    /teamMember\.count/.test(route) && /ASSIGNED_ONLY/.test(route) && /projectMemberships/.test(route),
    'B4 详情路由按「能否打开本项目」数人（团队角色 + 授权范围 + 本项目指派）', '结构')

  for (const locale of LOCALES) {
    const section = readLocale(locale).projects || {}
    report(MEMBER_KEYS.every(key => typeof section[key] === 'string' && section[key].length > 0), `C1 ${locale} 补齐 ${MEMBER_KEYS.length} 个新 key`, '文案')
  }
  const zhSentence = (readLocale('zh').projects || {}).projectMemberCount || ''
  report(/\{count\}/.test(zhSentence), 'C2 人数句必须插值（不许写死）', '文案', zhSentence)
  report(LOCALES.filter(l => l !== 'zh').every(l => /plural/.test((readLocale(l).projects || {}).projectMemberCount || '')), 'C3 拉丁语系走单复数变形', '文案')
} finally {
  const teams = await prisma.team.findMany({ where: { slug: { in: [teamASlug, teamBSlug] } }, select: { id: true } })
  const teamIds = teams.map(team => team.id)
  /** 每枚 fixture 邮箱都嵌着 stamp，按它收口；`%` 通配对 Prisma 的等值匹配无效，上次崩溃就是没清掉人。 */
  const users = await prisma.user.findMany({ where: { email: { startsWith: 'pmc-', contains: String(stamp) } }, select: { id: true } })
  const userIds = users.map(user => user.id)
  await prisma.project.deleteMany({ where: { teamId: { in: teamIds } } })
  await prisma.teamMember.deleteMany({ where: { teamId: { in: teamIds } } })
  await prisma.team.deleteMany({ where: { id: { in: teamIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  console.log('CLEANUP', JSON.stringify({
    teams: await prisma.team.count({ where: { slug: { in: [teamASlug, teamBSlug] } } }),
    users: await prisma.user.count({ where: { email: { startsWith: 'pmc-', contains: String(stamp) } } }),
    members: await prisma.teamMember.count({ where: { userId: { in: userIds } } }),
    assignments: await prisma.projectMember.count({ where: { userId: { in: userIds } } }),
  }))
  await prisma.$disconnect()
}

if (failures.length > 0) {
  console.log(`\n${failures.length} FAILED`)
  process.exit(1)
}
console.log('\nALL PASS')
process.exit(0)
