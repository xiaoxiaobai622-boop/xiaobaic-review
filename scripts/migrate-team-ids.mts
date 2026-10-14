/**
 * 团队 ID 全量换成 6 位数字（他 10-14 点单「换吧，全部都换」）。
 *
 * 为什么不是「改一列」：团队 ID 同时是三样东西——主键、10 张表的外键目标、还有一切对象存储键的
 * 开头（`teams/<团队ID>/projects/...`）。第三样最要命：删项目和删相册是**当场拿 teamId 拼目录**去删
 * 整片的，ID 改了而对象留在旧前缀，那批数据从此谁都删不掉、还一直计费。所以这条脚本按三段走：
 *
 *   --plan   只读：数出映射、每条外键、每个嵌着旧前缀的文本列，写出映射 JSON。什么都不改。
 *   --move   把对象从旧前缀复制到新前缀（复制，不删源）——库还没切，旧键仍在服务。
 *   --apply  一条事务里：外键改 DEFERRED → 改写所有嵌着旧前缀的文本列 → 更新 11 张引用列与 Team.id
 *            → 自己校验 → 恢复外键定义。默认在 COMMIT 之前抛错回滚（演练），要落库才加 --commit。
 *   --verify 切完之后核对：库里零残留、每个路径都真有对象、旧前缀还剩多少。
 *   --prune  旧前缀整片删掉。只在 --verify 全绿之后跑；这一步不可逆。
 *
 * 顺序是刻意的：先复制、后切库、再核对、最后删旧 ⇒ 任何一步失败都还有旧键在服务，不会一边白屏。
 * 切库与删旧之间落在旧前缀的新对象（切换那一刻还在飞的作业）由 --move 再跑一遍补上，
 * --verify 会把「库指新路径但对象不在」逐条点名，绝不静默。
 *
 * 跑法：
 *   npx tsx scripts/migrate-team-ids.mts --plan
 *   npx tsx scripts/migrate-team-ids.mts --apply
 *   npx tsx scripts/migrate-team-ids.mts --apply --commit
 * 线上不在这个进程里跑：--plan/--sql 生成映射与 SQL，SQL 走 ssh+psql 的管道（见 --sql），
 * 搬对象那段要借应用容器的环境变量（凭据不进文件、不进命令行）。
 */
import { PrismaClient } from '@prisma/client'
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { pickTeamId } from '../src/lib/team-id'
import { listStoredKeys, copyStoredFile, fileExists, deleteDirectory, isS3Mode } from '../src/lib/storage'
import { prefetchRenditions, isCdnPrefetchEnabled } from '../src/lib/tencent-cdn'

const prisma = new PrismaClient()
const flags = process.argv.slice(2)
// 模式就是那个 --xxx 开关本身；--commit 是修饰。早先用「找不以 -- 开头的参数」判模式，
// 结果 `--apply` 一路都掉回 --plan，SQL 根本没跑过——演练报告得建立在实际跑过的语句上。
const mode = flags.find(a => a.startsWith('--') && a !== '--commit') ?? '--plan'
const COMMIT = process.argv.includes('--commit')
const MAP_FILE = process.env.TEAM_ID_MAP || fileURLToPath(new URL('./team-id-mapping.json', import.meta.url))
// 切库与删旧之间必须隔开一整天的签名有效期：缩略图直链签 24 小时（api/content/[token]/route.ts:630
// 传 86400），流签 4 小时（s3-storage.ts:723 默认 14400）。删早了，别人手里已经打开的页面就成坏图。
const SWITCH_FILE = process.env.TEAM_ID_SWITCH || fileURLToPath(new URL('./team-id-switch.json', import.meta.url))
const SIGNED_URL_LIFETIME_MS = 24 * 60 * 60 * 1000
const FORCE = process.argv.includes('--force-prune')

function log(...args: unknown[]) {
  console.log(...args)
}
function die(msg: string): never {
  console.error(`STOP ${msg}`)
  process.exitCode = 1
  throw new Error(msg)
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * 只保留 SQL 里能安全内联的字符：映射值与 LIKE 模式都是本脚本自己生成的，不接外部输入。
 * 模式串多允许 / 与 %（前缀形状），引号、空格、分号一律拒。
 */
function sqlLiteral(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new Error(`映射值形状不对，拒绝拼进 SQL：${JSON.stringify(value.slice(0, 24))}`)
  return `'${value}'`
}
/** 约束名是 Prisma 建的驼峰标识符，不加双引号就会被 Postgres 折成小写而「不存在」。 */
function sqlIdent(value: string): string {
  if (!/^[A-Za-z0-9_]{1,63}$/.test(value)) throw new Error(`标识符形状不对，拒绝拼进 SQL：${JSON.stringify(value.slice(0, 40))}`)
  return `"${value}"`
}
function sqlPattern(value: string): string {
  if (!/^[A-Za-z0-9_/%-]{1,128}$/.test(value)) throw new Error(`LIKE 模式形状不对，拒绝拼进 SQL：${JSON.stringify(value.slice(0, 24))}`)
  return `'${value}'`
}

type Mapping = { generatedAt: string; pairs: { oldId: string; newId: string; newShareKey?: string }[] }

async function readTeams() {
  return prisma.team.findMany({ select: { id: true, slug: true, name: true, shareKey: true }, orderBy: { createdAt: 'asc' } })
}

/**
 * 嵌着 `teams/<旧ID>/` 的文本列：按值现查，不写死列名——线上新加一列存路径也不会漏。
 * 一次 UNION 打完（线上库里上千个文本列 × 若干团队，逐列一问会慢到没法用）。
 */
async function findPathCells(oldIds: string[]) {
  const candidates = await prisma.$queryRawUnsafe<{ table: string; column: string }[]>(
    `SELECT table_name AS table, column_name AS column FROM information_schema.columns
     WHERE table_schema='public' AND data_type IN ('text','character varying')
       AND table_name NOT LIKE 'pg\\_%' AND table_name <> '_prisma_migrations'
     ORDER BY table_name, column_name`,
  )
  const parts: string[] = []
  for (const { table, column } of candidates) {
    for (const oldId of oldIds) {
      parts.push(`SELECT '${table}' AS table, '${column}' AS column, ${sqlLiteral(oldId)} AS old_id,
  count(*) FILTER (WHERE "${table}"."${column}" LIKE ${sqlPattern(`teams/${oldId}/%`)})::bigint AS n FROM "${table}"`)
    }
  }
  const out = new Map<string, { table: string; column: string; hits: number }[]>()
  if (!parts.length) return out
  // 列太多时分批，省得单条语句过长
  for (let i = 0; i < parts.length; i += 400) {
    const batch = parts.slice(i, i + 400).join('\nUNION ALL\n')
    const rows = await prisma.$queryRawUnsafe<{ table: string; column: string; old_id: string; n: bigint }[]>(
      `SELECT * FROM (${batch}) x WHERE x.n > 0`,
    )
    for (const row of rows) {
      const list = out.get(row.old_id) ?? []
      list.push({ table: row.table, column: row.column, hits: Number(row.n) })
      out.set(row.old_id, list)
    }
  }
  return out
}

/** 引用 Team.id 的外键，连定义一起取回来，改完照原文装回去。 */
async function readTeamForeignKeys() {
  const rows = await prisma.$queryRawUnsafe<{ table: string; constraint: string; definition: string; column: string }[]>(
    `SELECT c.conname AS constraint,
            c.conrelid::regclass::text AS table,
            pg_get_constraintdef(c.oid) AS definition,
            a.attname AS column
     FROM pg_constraint c
     JOIN pg_class tc ON tc.oid = c.conrelid
     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype='f' AND c.confrelid = '"Team"'::regclass AND tc.relkind='r'
       AND cardinality(c.conkey) = 1`,
  )
  const composite = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint AS n FROM pg_constraint WHERE contype='f' AND confrelid='"Team"'::regclass AND cardinality(conkey) > 1`,
  )
  if (Number(composite[0].n) > 0) die(`有 ${composite[0].n} 条复合外键指向 Team.id，这条脚本只处理单列外键，先看清楚再改`)
  return rows
}

async function plan(): Promise<Mapping> {
  const teams = await readTeams()
  const taken = new Set(teams.map(t => t.id))
  const shareKeys = new Set(teams.map(t => t.shareKey))
  const mapping: { oldId: string; newId: string; newShareKey?: string }[] = []
  for (const team of teams) {
    let next: string
    try {
      next = pickTeamId(taken)
    } catch (e) {
      die(`号池发不出下一枚：${(e as Error).message}`)
    }
    taken.add(next)
    shareKeys.add(next)
    // 他 10-14 追加「需要全改」：分享键恰好等于旧 ID 的团队（线上实测 2 枚），旧字面量会一直留在
    // 对外链接里。换成一枚新的 tm_ 键（和现在新建团队用的是同一套写法）——不能直接顶成新 ID，
    // 那样分享键又等于团队 ID，等于没改干净。
    const pair: { oldId: string; newId: string; newShareKey?: string } = { oldId: team.id, newId: next }
    if (team.shareKey === team.id) {
      let fresh = `tm_${randomBytes(5).toString('hex')}`
      while (shareKeys.has(fresh)) fresh = `tm_${randomBytes(5).toString('hex')}`
      shareKeys.add(fresh)
      pair.newShareKey = fresh
    }
    mapping.push(pair)
  }

  const fks = await readTeamForeignKeys()
  const cells = await findPathCells(mapping.map(m => m.oldId))
  log(`团队 ${mapping.length} 枚，引用 Team.id 的外键 ${fks.length} 条`)
  for (const m of mapping) {
    const paths = cells.get(m.oldId) ?? []
    const total = paths.reduce((sum, p) => sum + p.hits, 0)
    const keys = await listStoredKeys(`teams/${m.oldId}`).catch(() => [])
    log(`  ${m.oldId} → ${m.newId}｜库里嵌旧前缀的单元格 ${total}（${paths.map(p => `${p.table}.${p.column}=${p.hits}`).join(' ') || '无'}）｜存储里该前缀对象 ${keys.length}`)
  }
  // 非外键那列单独点名：它不在 pg_constraint 里，靠发现是找不到的。
  const cards = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint AS n FROM "TeamActivationCard" WHERE "redeemedByTeamId" IN (${mapping.map(m => sqlLiteral(m.oldId)).join(',')})`,
  ).catch(() => [] as { n: bigint }[])
  log(`  TeamActivationCard.redeemedByTeamId（不是外键，手工带）命中 ${cards.length ? Number(cards[0].n) : 0}`)
  log(`  分享键恰好等于旧 ID、要一起换掉的团队：${mapping.filter(m => m.newShareKey).length} 枚 ${JSON.stringify(mapping.filter(m => m.newShareKey).map(m => `${m.oldId}→${m.newShareKey}`))}`)
  log(`  新号会不会撞已存在的团队：${mapping.filter(m => teams.some(t => t.id === m.newId)).length} 枚（必须 0）`)

  const payload: Mapping = { generatedAt: new Date().toISOString(), pairs: mapping }
  writeFileSync(MAP_FILE, `${JSON.stringify(payload, null, 2)}\n`)
  log(`映射写出：${MAP_FILE}`)
  return payload
}

/**
 * 一条语句一个元素，分两段返回：
 *   main    ＝ 临时表 + 外键改延迟 + 全部改写 + 自证（一个事务）
 *   restore ＝ 外键按原文装回（必须另一个事务：Postgres 不允许在「本事务还有待处理的触发事件」
 *              时 ALTER 同一张表，而 DEFERRED 外键恰恰要到 COMMIT 才校验——第一段提交完才装得回去）
 * 本地逐句执行、线上拼一块喂 psql，两边共用同一份列表，不会出现「本地过了、线上那条不一样」。
 */
function buildPhases(mapping: Mapping, fks: { table: string; constraint: string; definition: string; column: string }[], pathCells: { table: string; column: string; hits: number }[]) {
  const values = mapping.pairs.map(m => `(${sqlLiteral(m.oldId)}, ${sqlLiteral(m.newId)}${m.newShareKey ? `, ${sqlLiteral(m.newShareKey)}` : ', NULL'})`).join(', ')
  const plain = (f: { definition: string }) => f.definition.replace(/\s+DEFERRABLE|\s+INITIALLY\s+(DEFERRED|IMMEDIATE)/gi, '')
  const oldIds = mapping.pairs.map(m => sqlLiteral(m.oldId)).join(',')

  const main: string[] = [
    `CREATE TEMP TABLE team_id_map(old_id text PRIMARY KEY, new_id text NOT NULL, new_share_key text) ON COMMIT DROP`,
    `INSERT INTO team_id_map(old_id, new_id, new_share_key) VALUES ${values}`,
  ]
  // 1) 外键临时改成可延迟：主键要被 UPDATE，子表必须能等到 COMMIT 再对齐
  for (const f of fks) {
    main.push(`ALTER TABLE ${f.table} DROP CONSTRAINT ${sqlIdent(f.constraint)}`)
    main.push(`ALTER TABLE ${f.table} ADD CONSTRAINT ${sqlIdent(f.constraint)} ${plain(f)} DEFERRABLE INITIALLY DEFERRED`)
  }
  // 2) 先把嵌着旧前缀的存储键换头（这一步只动字符串，不碰对象）
  for (const p of pathCells) {
    main.push(`UPDATE "${p.table}" SET "${p.column}" = 'teams/' || m.new_id || '/' || substring("${p.column}" from length('teams/' || m.old_id || '/') + 1)
  FROM team_id_map m WHERE "${p.column}" LIKE 'teams/' || m.old_id || '/%'`)
  }
  // 3) 引用列 → 非外键那列 → 主键本身
  for (const f of fks) {
    main.push(`UPDATE ${f.table} t SET "${f.column}" = m.new_id FROM team_id_map m WHERE t."${f.column}" = m.old_id`)
  }
  main.push(`UPDATE "TeamActivationCard" SET "redeemedByTeamId" = m.new_id FROM team_id_map m WHERE "TeamActivationCard"."redeemedByTeamId" = m.old_id`)
  // 他 10-14 追加「需要全改」：线上有两枚团队的分享键恰好就是旧 ID，那串字面量会一直留在对外链接里。
  // 改了这条，那两个老地址就从此打不开（实测近 30 天线上只有 1 次访问），这是点过的代价。
  main.push(`UPDATE "Team" SET "shareKey" = m.new_share_key FROM team_id_map m WHERE "Team"."shareKey" = m.old_id AND m.new_share_key IS NOT NULL`)
  main.push(`UPDATE "Team" t SET "id" = m.new_id FROM team_id_map m WHERE t."id" = m.old_id`)
  // 4) 自证：号池形状、映射盖住全部团队、库里零残留——任何一条不对就整段回滚
  main.push(`DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM "Team";
  IF n <> ${mapping.pairs.length} THEN RAISE EXCEPTION '团队行数对不上：期望 %，实际 %', ${mapping.pairs.length}, n; END IF;
  SELECT count(*) INTO n FROM "Team" WHERE "id" !~ '^[1-9][0-9]{5}$';
  IF n > 0 THEN RAISE EXCEPTION '还有 % 枚团队 ID 不是 6 位数字', n; END IF;
  SELECT count(*) INTO n FROM "Team" t WHERE NOT EXISTS (SELECT 1 FROM team_id_map m WHERE m.new_id = t."id");
  IF n > 0 THEN RAISE EXCEPTION '有 % 枚团队 ID 不在映射里（映射没盖住全部团队）', n; END IF;
  SELECT count(*) INTO n FROM "Team" t WHERE t."id" IN (${oldIds});
  IF n > 0 THEN RAISE EXCEPTION 'Team.id 里还留着 % 枚旧号', n; END IF;
  SELECT count(*) INTO n FROM "Team" t WHERE t."shareKey" IN (${oldIds});
  IF n > 0 THEN RAISE EXCEPTION 'Team.shareKey 里还留着 % 枚旧号（对外链接里还会写着旧 ID）', n; END IF;
  SELECT count(*) INTO n FROM "Team" WHERE "shareKey" = "id";
  IF n > 0 THEN RAISE EXCEPTION '有 % 枚团队的分享键又等于自己的 ID 了', n; END IF;
END $$`)

  // 5) 装回原定义：留到下一个事务
  const restore: string[] = []
  for (const f of fks) {
    restore.push(`ALTER TABLE ${f.table} DROP CONSTRAINT ${sqlIdent(f.constraint)}`)
    restore.push(`ALTER TABLE ${f.table} ADD CONSTRAINT ${sqlIdent(f.constraint)} ${plain(f)}`)
  }
  return { main, restore }
}

/** 线上走 psql：两段各自一个事务，中间必须 COMMIT 才能装回外键。 */
function renderSql(phases: { main: string[]; restore: string[] }) {
  if (!COMMIT) {
    return `BEGIN;\n-- 演练：整段执行完回滚，库里一个字节都不留（外键从没真被改过）\n${phases.main.join(';\n')};\nROLLBACK;\n`
  }
  return `BEGIN;\n${phases.main.join(';\n')};\nCOMMIT;\nBEGIN;\n${phases.restore.join(';\n')};\nCOMMIT;\n`
}

function collectCells(mapping: Mapping) {
  return findPathCells(mapping.pairs.map(m => m.oldId)).then(cells => {
    const flat: { table: string; column: string; hits: number }[] = []
    for (const list of cells.values()) flat.push(...list)
    return flat
  })
}

async function emitSql() {
  const mapping = existsSync(MAP_FILE) ? JSON.parse(readFileSync(MAP_FILE, 'utf8')) as Mapping : await plan()
  const fks = await readTeamForeignKeys()
  log(renderSql(buildPhases(mapping, fks, await collectCells(mapping))))
}

async function runPhase(label: string, tx: { $executeRawUnsafe: (sql: string) => Promise<unknown> }, statements: string[]) {
  for (const [i, sql] of statements.entries()) {
    try {
      await tx.$executeRawUnsafe(sql)
    } catch (e) {
      throw new Error(`${label} 第 ${i + 1}/${statements.length} 条失败：${(e as Error).message.slice(0, 300)}\n语句头：${sql.slice(0, 160)}`)
    }
  }
  log(`${label}：${statements.length} 条全部执行`)
}

async function apply() {
  const mapping = existsSync(MAP_FILE) ? JSON.parse(readFileSync(MAP_FILE, 'utf8')) as Mapping : await plan()
  const fks = await readTeamForeignKeys()
  const pathCells = await collectCells(mapping)
  const phases = buildPhases(mapping, fks, pathCells)
  log(`准备执行：主段 ${phases.main.length} 条＋装回外键 ${phases.restore.length} 条（两个事务）｜团队 ${mapping.pairs.length} 枚，外键 ${fks.length} 条要临时延迟，路径单元格 ${pathCells.reduce((s, c) => s + c.hits, 0)} 格要换头｜模式=${COMMIT ? 'COMMIT' : '演练回滚'}`)
  class Rehearsal extends Error {}
  try {
    await prisma.$transaction(async (tx) => {
      await runPhase('主段', tx, phases.main)
      if (!COMMIT) throw new Rehearsal('演练：按设计回滚')
    }, { timeout: 600_000, maxWait: 20_000 })
    writeFileSync(SWITCH_FILE, `${JSON.stringify({ switchedAt: new Date().toISOString(), teams: mapping.pairs.length })}\n`)
    log(`主段已提交（DEFERRED 外键在 COMMIT 时校验过了），切换时间记在 ${SWITCH_FILE}`)
    await prisma.$transaction(async (tx) => {
      await runPhase('装回外键', tx, phases.restore)
    }, { timeout: 600_000, maxWait: 20_000 })
    await verifyAgainst(mapping)
    await assertFkShape(fks.length)
  } catch (e) {
    if (e instanceof Rehearsal) {
      log('演练：整段语句执行完毕并回滚')
      await assertUnchanged(mapping)
      await assertFkShape(fks.length)
      return
    }
    die(`中止：${(e as Error).message.slice(0, 700)}`)
  }
}

/** 外键条数必须原样回来——少一条就是这条脚本把约束弄丢了。 */
async function assertFkShape(expected: number) {
  const now = (await readTeamForeignKeys()).length
  const deferred = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint AS n FROM pg_constraint WHERE contype='f' AND confrelid='"Team"'::regclass AND condeferrable`,
  )
  log(`外键读回：${now} 条（期望 ${expected}），还带 DEFERRABLE 的 ${Number(deferred[0].n)} 条（应为 0）`)
  if (now !== expected || Number(deferred[0].n) !== 0) die('外键没回到原样，别再往下跑，先修这一条')
}

/** 回滚之后必须读回「还是老样子」，否则「演练过」这三个字只是我自己说的。 */
async function assertUnchanged(mapping: Mapping) {
  const teams = await readTeams()
  const stillOld = teams.filter(t => mapping.pairs.some(m => m.oldId === t.id)).length
  const alreadyNew = teams.filter(t => mapping.pairs.some(m => m.newId === t.id)).length
  const cells = await findPathCells(mapping.pairs.map(m => m.oldId))
  const oldCells = [...cells.values()].flat().reduce((s, c) => s + c.hits, 0)
  log(`读回：仍是旧号 ${stillOld}/${mapping.pairs.length}，已是新号 ${alreadyNew}（必须 0），旧前缀路径单元格 ${oldCells}`)
  if (stillOld !== mapping.pairs.length || alreadyNew !== 0) die('回滚没回干净，停下')
  log('库里一切照旧')
}

/** 切完之后对着映射读回一遍：团队行数、6 位形状、旧号残留。 */
async function verifyAgainst(mapping: Mapping) {
  const teams = await readTeams()
  const expected = new Set(mapping.pairs.map(m => m.newId))
  const badShape = teams.filter(t => !/^[1-9]\d{5}$/.test(t.id))
  const stale = teams.filter(t => mapping.pairs.some(m => m.oldId === t.id))
  log(`读回：团队 ${teams.length} 枚，形状不合规 ${badShape.length}，仍是旧号 ${stale.length}，映射覆盖 ${teams.filter(t => expected.has(t.id)).length}/${mapping.pairs.length}`)
  if (teams.length !== mapping.pairs.length || badShape.length || stale.length) die('读回不对，停下别往下走')
  log('库这一段对得上')
}

async function move() {
  const mapping = existsSync(MAP_FILE) ? JSON.parse(readFileSync(MAP_FILE, 'utf8')) as Mapping : die('先跑 --plan 生成映射')
  for (const { oldId, newId } of mapping.pairs) {
    const keys = await listStoredKeys(`teams/${oldId}`)
    let copied = 0
    for (const key of keys) {
      const dest = `teams/${newId}${key.slice(`teams/${oldId}`.length)}`
      if (await fileExists(dest)) continue
      await copyStoredFile(key, dest)
      copied++
      if (copied % 200 === 0) {
        log(`  ${oldId}→${newId} 已复制 ${copied}/${keys.length}`)
        await sleep(50)
      }
    }
    log(`  ${oldId}→${newId}：旧前缀 ${keys.length} 枚，本次复制 ${copied} 枚（源没删，等 --prune）`)
  }
}

async function verify() {
  const mapping = existsSync(MAP_FILE) ? JSON.parse(readFileSync(MAP_FILE, 'utf8')) as Mapping : die('先跑 --plan 生成映射')
  await verifyAgainst(mapping)
  const candidates = await prisma.$queryRawUnsafe<{ table: string; column: string }[]>(
    `SELECT table_name AS table, column_name AS column FROM information_schema.columns
     WHERE table_schema='public' AND data_type IN ('text','character varying')`,
  )
  // 新路径找不到对象，有两种完全不同的原因：这条本来就挂空（旧前缀里也没有），或迁移把它弄丢了
  // （旧前缀里还在）。不分清就是把「库里早就有的洞」报成「我搬坏了」。趁 --prune 之前旧前缀还在，
  // 同一枚路径按映射换回旧号再问一次，就能把两者分开。
  const lost = new Set<string>()
  const preExisting = new Set<string>()
  let checked = 0
  for (const { table, column } of candidates) {
    if (table.startsWith('pg_') || table === '_prisma_migrations') continue
    const rows = await prisma.$queryRawUnsafe<{ p: string }[]>(
      `SELECT DISTINCT "${column}" AS p FROM "${table}" WHERE "${column}" LIKE 'teams/%'`,
    ).catch(() => [])
    for (const { p } of rows) {
      checked++
      if (await fileExists(p)) continue
      const pair = mapping.pairs.find(m => p.startsWith(`teams/${m.newId}/`))
      const oldPath = pair ? `teams/${pair.oldId}${p.slice(`teams/${pair.newId}`.length)}` : ''
      if (oldPath && await fileExists(oldPath)) lost.add(`${p}（旧位还在：${oldPath}）`)
      else preExisting.add(p)
    }
  }
  for (const { oldId } of mapping.pairs) {
    const left = await listStoredKeys(`teams/${oldId}`)
    if (left.length) log(`  旧前缀还在：teams/${oldId}/ 下 ${left.length} 枚（--prune 之前本来就该在）`)
  }
  log(`路径去重核：${checked} 个不同路径｜迁移弄丢 ${lost.size}｜切换前就挂空 ${preExisting.size}`)
  for (const one of [...lost].slice(0, 20)) log(`  ✗ 丢了：${one}`)
  for (const one of [...preExisting].slice(0, 5)) log(`  · 早就没有（不算这次的事）：${one}`)
  if (lost.size) die('有路径被这次搬迁落下了：先别 --prune，再跑一次 --move 接上，然后重跑 --verify')
  log('每个切换前就有对象的路径，现在都还在')
}

/**
 * 分享键单独重跑一遍：整批切换之后如果发现还有键顶着旧号（或某轮改动让 shareKey 又等于了 ID），
 * 用这条补，不用重跑整段。要换哪几枚按**当下库里的状态**现判，不信计划时写下的字段——
 * 计划文件可能出自上一轮，拿它当依据会漏掉新出现的问题。
 */
async function shareKeysOnly() {
  const mapping = existsSync(MAP_FILE) ? JSON.parse(readFileSync(MAP_FILE, 'utf8')) as Mapping : die('先跑 --plan 生成映射')
  const teams = await prisma.team.findMany({ select: { id: true, shareKey: true } })
  const byOld = new Map(mapping.pairs.map(m => [m.oldId, m]))
  const usedKeys = new Set(teams.map(t => t.shareKey))
  const need: { oldKey: string; fresh: string }[] = []
  for (const team of teams) {
    // 两种脏法都要治：键还是旧团队 ID，或键又和自己的 ID 相等（换成新号之后重新撞在一起）
    if (team.shareKey !== team.id && !byOld.has(team.shareKey)) continue
    let fresh = `tm_${randomBytes(5).toString('hex')}`
    while (usedKeys.has(fresh)) fresh = `tm_${randomBytes(5).toString('hex')}`
    usedKeys.add(fresh)
    need.push({ oldKey: team.shareKey, fresh })
  }
  log(`要换分享键的团队 ${need.length} 枚 ${JSON.stringify(need.map(n => `${n.oldKey}→${n.fresh}`))}`)
  if (!need.length) { log('库里没有「分享键＝旧 ID」或「分享键＝自己 ID」的团队，不用动'); return }
  const values = need.map(n => `(${sqlLiteral(n.oldKey)}, ${sqlLiteral(n.oldKey)}, ${sqlLiteral(n.fresh)})`).join(', ')
  const statements = [
    `CREATE TEMP TABLE team_id_map(old_id text PRIMARY KEY, new_id text NOT NULL, new_share_key text) ON COMMIT DROP`,
    `INSERT INTO team_id_map(old_id, new_id, new_share_key) VALUES ${values}`,
    `UPDATE "Team" SET "shareKey" = m.new_share_key FROM team_id_map m WHERE "Team"."shareKey" = m.old_id AND m.new_share_key IS NOT NULL`,
    `DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM "Team" WHERE "shareKey" = "id";
  IF n > 0 THEN RAISE EXCEPTION '还有 % 枚团队的分享键等于自己的 ID', n; END IF;
END $$`,
  ]
  class Rehearsal extends Error {}
  try {
    await prisma.$transaction(async (tx) => {
      await runPhase('换分享键', tx, statements)
      if (!COMMIT) throw new Rehearsal('演练')
    }, { timeout: 300_000 })
  } catch (e) {
    if (e instanceof Rehearsal) { log('演练：执行完回滚，分享键没动'); return }
    die(`换分享键失败：${(e as Error).message.slice(0, 400)}`)
  }
  const stale = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint AS n FROM "Team" WHERE "shareKey" = "id" OR "shareKey" IN (${mapping.pairs.map(m => sqlLiteral(m.oldId)).join(',')})`)
  log(`读回：分享键还等于自己 ID 或某个旧号的团队 ${Number(stale[0].n)}（必须 0）`)
  if (Number(stale[0].n) !== 0) die('分享键没换干净')
}

/**
 * 切完之后把新路径推进 CDN 节点缓存：节点没热的时候一段要 1.4 秒（本地实测 0.13 秒），
 * 审阅的人会把它读成卡顿。走产品自己的 `prefetchRenditions`，它按天配额扣数，
 * 手搓 PushUrlsCache 会把账号那一万条/天的额度吃掉、后面真上传就没头寸了。
 */
async function warm() {
  if (!isS3Mode() || !isCdnPrefetchEnabled()) {
    log(`跳过预热：存储模式=${isS3Mode() ? 's3' : 'local'}、CDN 预热开关=${isCdnPrefetchEnabled() ? '开' : '关'}（只有线上这套才需要）`)
    return
  }
  const paths = await prisma.$queryRawUnsafe<{ p: string }[]>(
    `SELECT DISTINCT "hlsPath" AS p FROM "Video" WHERE "hlsPath" LIKE 'teams/%'`,
  )
  log(`要预热的清单文件 ${paths.length} 条（分片按播放列表展开，日配额扣在产品自己那本账上）`)
  const out = await prefetchRenditions(paths.map(r => r.p))
  log(`预热结果：试了 ${out.attempted} 条，提交 ${out.submitted} 个 URL，配额还剩 ${out.left}`)
}

async function prune() {
  const mapping = existsSync(MAP_FILE) ? JSON.parse(readFileSync(MAP_FILE, 'utf8')) as Mapping : die('先跑 --plan 生成映射')
  if (!COMMIT) die('--prune 不可逆：确认过 --verify 全绿之后再加 --commit')
  // 删早了会把别人手里还开着的页面打成坏图：签名直链最长活 24 小时，所以切换不满一天不许删。
  if (!existsSync(SWITCH_FILE)) die(`找不到切换时间记录（${SWITCH_FILE}）：确认是同一批迁移之后再 --force-prune`)
  const switchedAt = Date.parse((JSON.parse(readFileSync(SWITCH_FILE, 'utf8')) as { switchedAt: string }).switchedAt)
  const held = Date.now() - switchedAt
  if (held < SIGNED_URL_LIFETIME_MS && !FORCE) {
    die(`切换才过 ${(held / 3_600_000).toFixed(1)} 小时，签名直链最长老的还没到期（24 小时）：再等 ${(SIGNED_URL_LIFETIME_MS - held) / 3_600_000} 小时，或明确加 --force-prune`)
  }
  log(`距切换 ${(held / 3_600_000).toFixed(1)} 小时，已过签名有效期，可以删旧前缀`)
  for (const { oldId } of mapping.pairs) {
    const left = await listStoredKeys(`teams/${oldId}`)
    log(`删旧前缀 teams/${oldId}/：${left.length} 枚`)
    if (left.length) await deleteDirectory(`teams/${oldId}`)
    const after = await listStoredKeys(`teams/${oldId}`)
    if (after.length) die(`teams/${oldId}/ 删完还剩 ${after.length} 枚，去看原因`)
  }
  log('旧前缀清干净了')
}

try {
  if (mode === '--plan') await plan()
  else if (mode === '--sharekeys') await shareKeysOnly()
  else if (mode === '--warm') await warm()
  else if (mode === '--sql') await emitSql()
  else if (mode === '--apply') await apply()
  else if (mode === '--move') await move()
  else if (mode === '--verify') await verify()
  else if (mode === '--prune') await prune()
  else die(`不认识的模式 ${mode}（--plan|--sql|--apply|--move|--sharekeys|--warm|--verify|--prune）`)
} finally {
  await prisma.$disconnect()
}
