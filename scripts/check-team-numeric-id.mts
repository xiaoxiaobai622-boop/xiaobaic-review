/**
 * 团队 ID 换成 6 位数字的判据（他 10-14 点单「换吧，全部都换」）。
 *
 * 钉六层：
 *  A 发号函数本身（纯函数，注入 random 后能判「撞号跳过」「随机位一直撞车改用线性扫」「号池满了大声报错」）；
 *  B 建团那一路真的用了它并显式传 id（不靠 schema 的 cuid 默认值——线上多一枚 cuid 号就等于这批活再干一遍）；
 *  D 界面上那三串号各说各的话：团队 ID 不再声称能用来邀请／开分享页（实测 /share/<ID>/… 一律 404），
 *    运营后台按新数字号搜得到团队；
 *  E 复发闸门：schema 里 Team.id 不再带 cuid 默认、每一处夹具建团都显式发号、库里每枚号都合规、
 *    外加一枚迁移把不合规的旧号改名并给列上 CHECK（旧迁移里写死的 team_default 由它收尾）；
 *  C 真打一次 POST /api/teams：新建团队必须是 6 位数字、连建不重号、成员与额度行接的是同一枚号。
 *
 * 跑法：
 *  npx tsx scripts/check-team-numeric-id.mts --static   只查不写库、不要求 dev ⇒ 这条进 CI（check:static）
 *  npx tsx scripts/check-team-numeric-id.mts            再加 C 组与全库扫描；C 组装一次性夹具、要他自己的 next dev 在 :3000 上活着 ⇒ 不进 CI
 */
import { PrismaClient } from '@prisma/client'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { hashPassword } from '../src/lib/encryption'

const BASE = process.env.NUMERIC_ID_CHECK_BASE || 'http://localhost:3000'
// --static：一条都不写库、一次都不碰 dev，纯函数＋源码形状，所以能进 CI（CI 里没有 Postgres）。
const STATIC = process.argv.includes('--static')
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
// 判据要跨三个地方看仓库原文：schema、scripts/ 夹具、prisma/migrations/。用普通路径字符串，
// URL 拼装容易把目录段吃掉（少一个尾斜杠就从仓库根往下找）。
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const SCRIPTS_DIR = `${REPO_ROOT}/scripts`
function readRepo(rel: string) {
  const file = `${REPO_ROOT}/${rel}`
  return existsSync(file) ? readFileSync(file, 'utf8') : ''
}
/** 列出 prisma/migrations 下含某串字面的迁移，返回 {name, sql}（CHECK 闸门靠目录名是找不着的）。 */
function migrationsMatching(needle: string) {
  const dir = `${REPO_ROOT}/prisma/migrations`
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .map((name) => {
      const file = `${dir}/${name}/migration.sql`
      return existsSync(file) ? { name, sql: readFileSync(file, 'utf8') } : null
    })
    .filter((m): m is { name: string; sql: string } => !!m && m.sql.includes(needle))
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

  // ── D 组：界面上那几串号各说各的话 ─────────────────────────────────────
  // 实测过：/share/<团队 ID>/<项目链接名> 三枚团队全 404，同一团队的 /share/<slug>/… 与
  // /share/<分享键>/… 都 200（10-14 用 curl 打的）。所以「团队 ID」那行不能再写「用于邀请」，
  // 邀请链接拼的是 slug（studio/team/page.tsx 的 copyLink）。
  const teamPanel = source('app/studio/team/page.tsx')
  const idLineAt = teamPanel.search(/团队 ID/)
  // 只取「团队 ID」那行自己那句说明（到最近的 </p>），免得隔壁行的字混进来判成假绿。
  const noteAt = idLineAt >= 0 ? teamPanel.indexOf('用于', idLineAt) : -1
  const idLine = noteAt >= 0 ? teamPanel.slice(noteAt, teamPanel.indexOf('</p>', noteAt)) : ''
  check(idLineAt >= 0 && !!idLine, 'D1 团队信息面板确实还在讲「团队 ID」那行（不然下面几条是空判）',
    `→ 句子@${noteAt}`)
  check(!!idLine && !idLine.includes('邀请'), 'D2 团队 ID 的说明不再声称能邀请人（邀请用的是团队标识，实测把 ID 发进 by-slug 是 404「团队不存在」）',
    `→ ${JSON.stringify(idLine)}`)
  check(!!idLine && !idLine.includes('跨页面定位'), 'D3 团队 ID 的说明不再声称能跨页面定位（对外链接一律是短码或项目 slug）', '')
  check(!!idLine && /分享/.test(idLine), 'D4 团队 ID 的说明把「对外分享走别的地址」这句交代上了（不写清楚，人就会复制这串去发客户）', '')
  // 反过来也钉住：别有人为了「让复制的号能打开」把 id 加进分享路由——那等于把刚清掉的旧号放回对外 URL。
  const shareTwo = source('app/share/[teamSlug]/[projectSlug]/page.tsx')
  check(/shareKey:\s*teamSlug/.test(shareTwo) && /slug:\s*teamSlug/.test(shareTwo) && !/\{\s*id:\s*teamSlug\s*\}/.test(shareTwo),
    'D5 分享路由只认分享键与团队标识、不认团队 ID（「需要全改」之后对外地址里不许再出现团队号）',
    `→ ${JSON.stringify((shareTwo.match(/OR: \[[\s\S]{0,90}/) || [''])[0].replace(/\s+/g, ' '))}`)
  const consoleSearch = source('app/platform/teams/page.tsx')
  const filterAt = consoleSearch.search(/\.filter\(\(team\)/)
  check(filterAt >= 0 && /team\.id/.test(consoleSearch.slice(filterAt, filterAt + 240)),
    'D6 运营后台的团队列表按新的 6 位数字号搜得到（之前只比名称／标识／创建人，而那串数字才是界面让人记的）',
    `→ ${JSON.stringify(consoleSearch.slice(filterAt, filterAt + 120).replace(/\s+/g, ' '))}`)

  // ── E 组（静态部分）：不合规的号进不来、也长不回来 ───────────────────────
  const schema = readRepo('prisma/schema.prisma')
  const teamModel = (schema.match(/model Team \{[\s\S]*?\n\}/) || [''])[0]
  const idColumn = (teamModel.match(/^\s*id\s+String[^\n]*/m) || [''])[0]
  check(!!teamModel && !/@default\(cuid\(\)\)/.test(idColumn),
    'E1 schema 里 Team.id 不带 @default(cuid())（带上就等于给所有漏写 id 的 create 发旧形状号）',
    `→ ${JSON.stringify(idColumn.trim())}`)

  // 每一处建团都得自己发号。只看**对象顶层**的键：之前那版是「后面 500 字符里出现过 id:」，
  // 结果 `createdBy: { connect: { id: … } }`、`userId:` 之类的都算过了——CI 因此漏到 build 阶段
  // 才炸（Team.id 没了默认值，漏 id 就是类型错）。所以改成扫一层大括号取顶层键名。
  const topLevelKeys = (text: string, braceAt: number): string[] => {
    const keys: string[] = []
    let depth = 0
    let expectKey = false
    for (let i = braceAt; i < text.length; i++) {
      const ch = text[i]
      if (ch === '{' || ch === '[' || ch === '(') {
        depth++
        if (depth === 1) expectKey = true
        continue
      }
      if (ch === '}' || ch === ']' || ch === ')') {
        depth--
        if (depth === 0) break
        continue
      }
      if (depth !== 1) continue
      if (ch === ',') { expectKey = true; continue }
      if (/\s/.test(ch)) continue
      if (!expectKey) continue
      const at = text.slice(i).match(/^([A-Za-z_$][\w$]*)\s*:/)
      if (at) { keys.push(at[1]); i += at[0].length - 1 }
      expectKey = false
    }
    return keys
  }
  // 判据自己先要能被证伪：两种形状必须分出真假，否则「扫不到漏号」就是假绿。
  const probe = (snippet: string) => topLevelKeys(snippet, snippet.indexOf('{'))
  check(probe(`data: { id: '123456', name: 'x' }`).includes('id'),
    'E0a 顶层键扫描认得出 data 里第一顺位的 id', '')
  check(probe(`data: {\n  name: 'x',\n  createdBy: { connect: { id: u.id } },\n}`).includes('id') === false,
    'E0b connect 里那枚 id 不算数（旧口径就是在这儿假绿，让 CI 到 build 才炸）', '')
  check(probe(`data: {\n  name: 'x',\n  id: await allocateTeamId(prisma),\n}`).includes('id'),
    'E0c id 不在第一顺位也认得出（不许把判据写成只认我的插入位置）', '')

  const offenders: string[] = []
  const scriptFiles = readdirSync(SCRIPTS_DIR, { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.(mts|ts|mjs)$/.test(entry.name))
    .map(entry => entry.name)
    .sort()
  for (const file of scriptFiles) {
    const text = stripComments(readFileSync(`${SCRIPTS_DIR}/${file}`, 'utf8'))
    for (const match of text.matchAll(/(\w+)\.team\.(create|upsert)\(/g)) {
      const anchorKind = match[2] === 'upsert' ? 'create:' : 'data:'
      const anchor = text.indexOf(anchorKind, match.index!)
      const brace = anchor >= 0 ? text.indexOf('{', anchor) : -1
      if (brace < 0 || !topLevelKeys(text, brace).includes('id')) {
        offenders.push(`${file} → ${JSON.stringify(text.slice(match.index!, match.index! + 46).replace(/\s+/g, ' '))}`)
      }
    }
  }
  check(offenders.length === 0, 'E2 scripts/ 下每一处建团都在顶层带 id（不带就得靠默认值，而默认值正是这次拆掉的东西）',
    `→ 缺 id：${offenders.join('、') || '无'}`)

  const guards = migrationsMatching('Team').filter(m => /CHECK\s*\("id" ~ /m.test(m.sql))
  check(guards.length === 1, 'E3 恰有一枚迁移给 Team.id 上形状 CHECK（没有＝旧号能悄悄长回来；多枚＝闸门被重复加固，先查清）',
    `→ ${guards.map(g => g.name).join('、') || '无'}`)
  if (guards.length) {
    const g = guards[0]
    const renameAt = g.sql.indexOf('team_legacy_id_map')
    const checkAt = g.sql.search(/ADD CONSTRAINT[\s\S]{0,80}CHECK\s*\("id" ~ /)
    check(renameAt >= 0 && checkAt > renameAt,
      'E4 那枚迁移先把不合规的旧号改名、再上 CHECK（顺序反了迁移本身就跑不过去，历史迁移里写死的 team_default 也收不了尾）',
      `→ 改名@${renameAt}，CHECK@${checkAt}`)
    check(/UPDATE "Team" t SET id = m\.new_id/.test(g.sql) && /redeemedByTeamId/.test(g.sql),
      'E4b 改名靠 Team.id 那一条（10 条外键全是 ON UPDATE CASCADE，子表自己跟着走）＋ 单独补没外键的 redeemedByTeamId', '')
    check(/RAISE EXCEPTION[\s\S]{0,140}对象/.test(g.sql),
      'E4c 库里既有旧号又有对象路径指着它时，迁移主动抛错而不是只改库把媒体打成坏文件', '')
    check(/~ '\^\[1-9\]\\d\{5\}\$'/.test(g.sql), 'E5 CHECK 用的正则与 isTeamId 同口径（正好 6 位、首位非 0）', '')
  }

  if (STATIC) {
    console.log(`\n[--static] 合计 ${passed} PASS / ${failures.length} FAIL（C 组与全库扫描要连库，只在完整跑里做）`)
    if (failures.length) for (const f of failures) console.log(` - ${f}`)
    if (failures.length) process.exitCode = 1
    return
  }

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

  // 全库扫一遍：闸门（E3 那枚 CHECK）还没上到这台库时，旧形状的号会不会已经长回来了。
  const all = await prisma.team.findMany({ select: { id: true } })
  const stale = all.filter((team) => !SIX_DIGIT.test(team.id)).map(team => team.id)
  check(stale.length === 0, 'E6 当前库里每一枚 Team.id 都是 6 位数字（不是只测新建那一路）',
    `→ 共 ${all.length} 枚，不合形状：${stale.join('、') || '无'}`)

  console.log(`\n合计 ${passed} PASS / ${failures.length} FAIL`)
  if (failures.length) for (const f of failures) console.log(` - ${f}`)
  if (failures.length) process.exitCode = 1
}

try {
  await main()
} finally {
  if (STATIC) {
    await prisma.$disconnect()
  } else {
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
}
