/**
 * 团队 ID 迁移的线上通道（他 10-14 点单「换吧，全部都换」，代码已上线 `7364e47`）。
 *
 * 为什么单独一个文件：线上库不在我能连的地址上（postgres 只在容器网络里），对象存储的凭据也只活在
 * 应用容器的环境变量里。所以这里换一套搬运方式，但 SQL 一句都不重写——全部从
 * `team-id-migration-sql.ts` 取，和本地演练跑的是同一份文本。
 *
 *   --plan    只读：读线上团队、外键、嵌着旧前缀的单元格，数每个旧前缀下有多少对象，写映射 JSON
 *   --move    把对象复制到新前缀（不删源，可重跑：已存在的目标跳过）
 *   --apply   整块 SQL 交给 psql；默认末尾 ROLLBACK（演练），加 --commit 才真落
 *   --verify  库里读回形状＋每个路径逐条 HEAD（把「切换前就挂空」和「这次弄丢」分开）
 *   --prune   删旧前缀；切换不满 24 小时（签名直链的最长寿命）拒绝，除非 --force-prune
 *
 * 凭据不落盘、不进命令行：SQL 与容器脚本都走 stdin 管道。
 * 用法：npx tsx scripts/migrate-team-ids-prod.mts --plan
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { pickTeamId } from '../src/lib/team-id'
import {
  type Mapping, type FkDef, type PathCell, type ColumnRef, type MappingPair,
  SQL_READ_TEAMS, SQL_READ_FKS, SQL_COMPOSITE_FKS, SQL_TEXT_COLUMNS, SQL_TEAM_SHAPE, SQL_FK_DEFERRABLE,
  SQL_PATH_CELLS, pathCellScanSql, activationCardCountSql, allStoredPathSql,
  buildPhases, buildShareKeyPhases, renderSql, oldPrefix, newPrefix, sqlLiteral,
} from './team-id-migration-sql'

const SSH_KEY = process.env.PROD_SSH_KEY || `${process.env.HOME}/.ssh/vitransfer_codex`
const SSH_TARGET = process.env.PROD_SSH_TARGET || 'root@111.229.35.33'
const MAP_FILE = process.env.TEAM_ID_MAP || fileURLToPath(new URL('./team-id-mapping.prod.json', import.meta.url))
const SWITCH_FILE = process.env.TEAM_ID_SWITCH || fileURLToPath(new URL('./team-id-switch.prod.json', import.meta.url))
// 签名直链最长寿命：缩略图 24 小时（api/content/[token]/route.ts:630 传 86400），流 4 小时（s3-storage.ts:723）
const SIGNED_URL_LIFETIME_MS = 24 * 60 * 60 * 1000

const flags = process.argv.slice(2)
const mode = flags.find(a => a.startsWith('--') && !['--commit', '--force-prune'].includes(a)) ?? '--plan'
const COMMIT = flags.includes('--commit')
const FORCE = flags.includes('--force-prune')
const failures: string[] = []

function log(...args: unknown[]) {
  console.log(...args)
}
function die(msg: string): never {
  console.error(`STOP ${msg}`)
  failures.push(msg)
  process.exitCode = 1
  throw new Error(msg)
}

/** 线上库：psql 走 docker exec，值用 \x1f 分列，不打印任何连接信息。 */
function psql(sql: string, opts: { expectRows?: boolean } = {}): string[][] {
  const run = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-i', SSH_KEY, SSH_TARGET,
    `docker exec -i vitransfer-postgres sh -c "psql -U \\$POSTGRES_USER -d \\$POSTGRES_DB -A -F $'\\x1f' -t${opts.expectRows === false ? ' -q' : ''} -f -"`],
  { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (run.status !== 0) throw new Error(`psql 失败：${(run.stderr || run.stdout || '').trim().slice(0, 500)}`)
  const err = /ERROR:|FATAL:/.exec(run.stdout || '')
  if (err) throw new Error(`psql 报错：${run.stdout.slice(err.index, err.index + 300)}`)
  return (run.stdout || '').split('\n').filter(l => l.trim() !== '').map(l => l.split('\x1f'))
}

/** 容器里跑一段自带脚本（用应用容器已有的 env 与 @aws-sdk，凭据不进命令行也不落盘）。 */
function inContainer(script: string): string {
  const run = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-i', SSH_KEY, SSH_TARGET,
    'docker exec -i -w /app vitransfer-app node'], { input: script, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (run.status !== 0) throw new Error(`容器脚本失败：${(run.stderr || run.stdout || '').slice(-600)}`)
  return run.stdout || ''
}

const STORAGE_TEMPLATE = (payload: unknown) => `
import { S3Client, ListObjectsV2Command, ListObjectVersionsCommand, CopyObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
const p = ${JSON.stringify(payload)}
const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || 'us-east-1',
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
})
const Bucket = process.env.S3_BUCKET
const enc = (k) => k.split('/').map(encodeURIComponent).join('/')
async function* listed(prefix) {
  let token
  do {
    const r = await client.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }))
    for (const o of r.Contents || []) yield o
    token = r.IsTruncated ? r.NextContinuationToken : undefined
  } while (token)
}
const out = { copied: 0, skipped: 0, deleted: 0, missing: [], counted: {}, bytes: {}, versions: {} }
const CONC = 8
async function pool(items, worker) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(CONC, items.length) }, async () => {
    for (;;) { const at = i++; if (at >= items.length) return; await worker(items[at]) }
  }))
}
if (p.cmd === 'count') {
  for (const prefix of p.prefixes) {
    let n = 0, bytes = 0
    for await (const o of listed(prefix)) { n++; bytes += o.Size || 0 }
    out.counted[prefix] = n
    out.bytes[prefix] = bytes
  }
} else if (p.cmd === 'copy') {
  for (const { from, to } of p.pairs) {
    const keys = []
    for await (const o of listed(from)) keys.push(o.Key)
    let done = 0
    await pool(keys, async (key) => {
      const dest = to + key.slice(from.length)
      try {
        await client.send(new HeadObjectCommand({ Bucket, Key: dest }))
        out.skipped++
      } catch {
        await client.send(new CopyObjectCommand({ Bucket, Key: dest, CopySource: Bucket + '/' + enc(key) }))
        out.copied++
      }
      if (++done % 500 === 0) console.error('  ' + from + ' → ' + to + ' 已处理 ' + done + '/' + keys.length)
    })
  }
} else if (p.cmd === 'head') {
  await pool(p.keys, async (key) => {
    try { await client.send(new HeadObjectCommand({ Bucket, Key: key })) } catch { out.missing.push(key) }
  })
} else if (p.cmd === 'versions') {
  // 数「还剩几个版本」必须走 ListObjectVersions：媒体桶开了版本（实测 Status=Enabled），
  // ListObjectsV2 看不见历史版本与删除标记，用它核会得出「已经删干净」的假绿。
  for (const prefix of p.prefixes) {
    let n = 0, km, vm
    do {
      const r = await client.send(new ListObjectVersionsCommand({ Bucket, Prefix: prefix, KeyMarker: km, VersionIdMarker: vm }))
      n += (r.Versions || []).length + (r.DeleteMarkers || []).length
      km = r.NextKeyMarker; vm = r.NextVersionIdMarker
    } while (km)
    out.versions[prefix] = n
  }
} else if (p.cmd === 'purge') {
  // 逐版本删（版本＋删除标记都要清）：只 DeleteObject 不带 VersionId 会留下版本，空间不回收、
  // 旧数据一直计费。VersionId 一律原样回传，见下面那条。
  for (const prefix of p.prefixes) {
    let km, vm, page = 0
    do {
      const r = await client.send(new ListObjectVersionsCommand({ Bucket, Prefix: prefix, KeyMarker: km, VersionIdMarker: vm }))
      const targets = [...(r.Versions || []), ...(r.DeleteMarkers || [])]
        .filter(e => typeof e.Key === 'string' && typeof e.VersionId === 'string')
        // VersionId 原样回传，包括字符串 "null"。媒体桶是**开了版本之后**才有真版本号的，
        // 那之前上传的对象其版本号字面上就是 "null"；把它们当「普通键删」（VersionId 留空）
        // 只会立一枚删除标记、字节一个都不回收。10-15 单点实验实测：按 VersionId="null" 删，
        // COS 收下了，ListObjectVersions 里那条版本当场消失，只剩标记。
        .map(e => ({ Key: e.Key, VersionId: e.VersionId }))
      await pool(targets, async (t) => {
        await client.send(new DeleteObjectCommand({ Bucket, Key: t.Key, VersionId: t.VersionId }))
        out.deleted++
      })
      page += targets.length
      km = r.NextKeyMarker; vm = r.NextVersionIdMarker
      console.error('  ' + prefix + ' 已删 ' + page + ' 个版本')
    } while (km)
  }
}
console.log(JSON.stringify(out))
`

function storage(payload: unknown): { copied?: number; skipped?: number; deleted?: number; missing?: string[]; counted?: Record<string, number>; bytes?: Record<string, number>; versions?: Record<string, number> } {
  const text = inContainer(STORAGE_TEMPLATE(payload))
  const line = text.trim().split('\n').filter(l => l.startsWith('{')).pop()
  if (!line) throw new Error(`容器脚本没回 JSON：${text.slice(0, 200)}`)
  for (const progress of text.split('\n')) if (progress.trim() && !progress.startsWith('{')) console.log(`   ${progress}`)
  return JSON.parse(line)
}

async function readTeams() {
  return psql(SQL_READ_TEAMS).map(r => ({ id: r[0], slug: r[1], name: r[2], shareKey: r[3] }))
}
async function readFks(): Promise<FkDef[]> {
  const composite = Number(psql(SQL_COMPOSITE_FKS)[0][0])
  if (composite > 0) die(`线上有 ${composite} 条复合外键指向 Team.id，这条脚本只处理单列外键，先人工看清再改`)
  return psql(SQL_READ_FKS).map(r => ({ constraint: r[0], table: r[1], definition: r[2], column: r[3] }))
}
async function readTextColumns(): Promise<ColumnRef[]> {
  return psql(SQL_TEXT_COLUMNS).map(r => ({ table: r[0], column: r[1] }))
}
async function findPathCells(oldIds: string[]) {
  const out = new Map<string, PathCell[]>()
  const columns = await readTextColumns()
  for (const sql of pathCellScanSql(columns, oldIds)) {
    for (const r of psql(sql)) {
      const list = out.get(r[2]) ?? []
      list.push({ table: r[0], column: r[1], hits: Number(r[3]) })
      out.set(r[2], list)
    }
  }
  return out
}

function loadMapping(): Mapping {
  if (!existsSync(MAP_FILE)) die(`没有映射文件 ${MAP_FILE}，先跑 --plan`)
  return JSON.parse(readFileSync(MAP_FILE, 'utf8')) as Mapping
}
function cellsFlat(mapping: Mapping, cells: Map<string, PathCell[]>) {
  const flat: PathCell[] = []
  for (const list of cells.values()) flat.push(...list)
  void mapping
  return flat
}

async function plan(): Promise<Mapping> {
  const teams = await readTeams()
  const taken = new Set(teams.map(t => t.id))
  const shareKeys = new Set(teams.map(t => t.shareKey))
  const pairs: MappingPair[] = []
  for (const team of teams) {
    const next = pickTeamId(taken)
    taken.add(next)
    shareKeys.add(next)
    const pair: MappingPair = { oldId: team.id, newId: next }
    if (team.shareKey === team.id) {
      let fresh = `tm_${randomBytes(5).toString('hex')}`
      while (shareKeys.has(fresh)) fresh = `tm_${randomBytes(5).toString('hex')}`
      shareKeys.add(fresh)
      pair.newShareKey = fresh
    }
    pairs.push(pair)
  }
  const mapping: Mapping = { generatedAt: new Date().toISOString(), pairs }
  const fks = await readFks()
  const cells = await findPathCells(pairs.map(p => p.oldId))
  const counts = storage({ cmd: 'count', prefixes: pairs.map(p => oldPrefix(p.oldId)) })
  log(`线上团队 ${pairs.length} 枚｜引用 Team.id 的外键 ${fks.length} 条`)
  for (const p of pairs) {
    const list = cells.get(p.oldId) ?? []
    log(`  ${p.oldId} → ${p.newId}${p.newShareKey ? `（分享键→${p.newShareKey}）` : ''}｜库里单元格 ${list.reduce((s, c) => s + c.hits, 0)}（${list.map(c => `${c.table}.${c.column}=${c.hits}`).join(' ') || '无'}）｜桶里对象 ${counts.counted?.[oldPrefix(p.oldId)] ?? 0} 枚 / ${(counts.bytes?.[oldPrefix(p.oldId)] ?? 0).toLocaleString()} 字节`)
  }
  log(`  TeamActivationCard.redeemedByTeamId 命中 ${Number(psql(activationCardCountSql(pairs.map(p => p.oldId)))[0][0])}`)
  writeFileSync(MAP_FILE, `${JSON.stringify(mapping, null, 2)}\n`)
  log(`映射写出：${MAP_FILE}`)
  return mapping
}

function sqlFor(mapping: Mapping, fks: FkDef[], cells: PathCell[]) {
  return renderSql(buildPhases(mapping, fks, cells), COMMIT)
}

async function apply() {
  const mapping = loadMapping()
  const fks = await readFks()
  const cells = cellsFlat(mapping, await findPathCells(mapping.pairs.map(p => p.oldId)))
  log(`准备执行：团队 ${mapping.pairs.length} 枚｜外键 ${fks.length} 条临时延迟｜路径单元格 ${cells.reduce((s, c) => s + c.hits, 0)} 格换头｜模式=${COMMIT ? 'COMMIT' : '演练回滚'}`)
  const out = psql(sqlFor(mapping, fks, cells), { expectRows: false })
  log(`psql 执行完${COMMIT ? '并提交' : '并回滚'}${out.length ? `：回显 ${out.length} 行` : ''}`)
  if (COMMIT) {
    writeFileSync(SWITCH_FILE, `${JSON.stringify({ switchedAt: new Date().toISOString(), teams: mapping.pairs.length })}\n`)
    log(`切换时间记在 ${SWITCH_FILE}（--prune 用它卡 24 小时）`)
    await verify()
  } else {
    const still = (await readTeams()).filter(t => mapping.pairs.some(p => p.oldId === t.id)).length
    log(`演练读回：仍是旧号 ${still}/${mapping.pairs.length}（应当全数不变），库里一切照旧`)
    if (still !== mapping.pairs.length) die('回滚没回干净，停下')
  }
  const deferred = Number(psql(SQL_FK_DEFERRABLE)[0][0])
  log(`外键：还带 DEFERRABLE 的 ${deferred} 条（应为 0）`)
  if (deferred !== 0) die('外键没回到原样，别再往下跑')
}

async function move() {
  const mapping = loadMapping()
  const res = storage({ cmd: 'copy', pairs: mapping.pairs.map(p => ({ from: oldPrefix(p.oldId), to: newPrefix(p.newId) })) })
  log(`复制完成：新复制 ${res.copied} 枚，已存在跳过 ${res.skipped} 枚（源一枚没删）`)
}

async function verify() {
  const mapping = loadMapping()
  const teams = psql(SQL_TEAM_SHAPE).map(r => ({ id: r[0], shareKey: r[1] }))
  const badShape = teams.filter(t => !/^[1-9]\d{5}$/.test(t.id))
  const staleKeys = teams.filter(t => t.shareKey === t.id || mapping.pairs.some(p => p.oldId === t.shareKey))
  log(`库里读回：团队 ${teams.length} 枚｜ID 形状不合规 ${badShape.length}｜分享键还顶旧号或等于自身 ${staleKeys.length}`)
  if (badShape.length || staleKeys.length) die('库这一段不对')
  const columns = await readTextColumns()
  const paths: { source: string; p: string }[] = []
  for (const sql of allStoredPathSql(columns)) {
    for (const r of psql(sql)) paths.push({ source: r[0], p: r[1] })
  }
  const byPair = new Map<string, string>()
  for (const p of mapping.pairs) byPair.set(newPrefix(p.newId), oldPrefix(p.oldId))
  const distinct = [...new Set(paths.map(x => x.p))]
  const res = storage({ cmd: 'head', keys: distinct })
  const missing = res.missing ?? []
  // 旧前缀还剩多少只数一次：每条缺失各起一趟容器脚本，一千多条就把线上 API 打满了
  const oldLeft = storage({ cmd: 'count', prefixes: [...byPair.values()] }).counted ?? {}
  const lost = missing.filter((k) => {
    const np = k.slice(0, k.indexOf('/', 6) + 1)
    const op = byPair.get(np)
    return op ? (oldLeft[op] ?? 0) > 0 : false
  })
  log(`路径去重核：${distinct.length} 条｜找不到对象 ${missing.length}｜其中「旧前缀还在＝这次弄丢」${lost.length}`)
  for (const one of missing.slice(0, 10)) log(`  · 没有对象：${one}`)
  if (lost.length) {
    for (const one of lost.slice(0, 10)) log(`  ✗ 丢了：${one}`)
    die('有路径被这次搬迁落下：再跑一次 --move 接上，然后重跑 --verify，别 --prune')
  }
  log('每个切换前就有对象的路径，现在都还在')
}

async function prune() {
  if (!COMMIT) die('--prune 不可逆：--verify 全绿之后再加 --commit')
  if (!existsSync(SWITCH_FILE)) die(`找不到切换时间记录（${SWITCH_FILE}）：确认是同一批迁移之后再 --force-prune`)
  const switchedAt = Date.parse((JSON.parse(readFileSync(SWITCH_FILE, 'utf8')) as { switchedAt: string }).switchedAt)
  const held = Date.now() - switchedAt
  if (held < SIGNED_URL_LIFETIME_MS && !FORCE) {
    die(`切换才过 ${(held / 3_600_000).toFixed(1)} 小时，签名直链最长老的还没到期（24 小时）：再等约 ${((SIGNED_URL_LIFETIME_MS - held) / 3_600_000).toFixed(1)} 小时，或明确加 --force-prune`)
  }
  const mapping = loadMapping()
  const prefixes = mapping.pairs.map(p => oldPrefix(p.oldId))
  const counts = storage({ cmd: 'count', prefixes })
  log(`删旧前缀：${prefixes.map(pf => `${pf}=${counts.counted?.[pf] ?? 0}`).join(' ')}`)
  // 删的时候页边界会挪（ListObjectVersions 按 KeyMarker 翻页，边删边翻可能跳过条目），
  // 所以一遍不够就接着来，直到复核说旧前缀里一个版本/标记都不剩。
  let totalDeleted = 0
  for (let pass = 1; pass <= 6; pass++) {
    const res = storage({ cmd: 'purge', prefixes })
    totalDeleted += res.deleted ?? 0
    const after = storage({ cmd: 'versions', prefixes })
    const left = Object.values(after.versions ?? {}).reduce((s, n) => s + n, 0)
    log(`第 ${pass} 遍：这遍删了 ${res.deleted ?? 0} 个（累计 ${totalDeleted}）｜还剩 ${left} 个版本/标记`)
    if (left === 0) { log('旧前缀清干净了'); return }
  }
  die('连删六遍旧前缀还没空，别硬猜，去 ListObjectVersions 看剩的是什么')
}

try {
  if (mode === '--plan') await plan()
  else if (mode === '--move') await move()
  else if (mode === '--apply') await apply()
  else if (mode === '--verify') await verify()
  else if (mode === '--prune') await prune()
  else die(`不认识的模式 ${mode}（--plan|--move|--apply|--verify|--prune）`)
} catch (e) {
  if (!failures.length) console.error(`跑挂：${(e as Error).message.slice(0, 800)}`)
  process.exitCode = 1
}
