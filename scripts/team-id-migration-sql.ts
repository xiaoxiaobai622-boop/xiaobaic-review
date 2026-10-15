/**
 * 团队 ID 迁移的 SQL 单一来源：本地那套（Prisma 逐句执行）和线上那套（ssh+psql）都从这里取，
 * 否则会出现「本地演练过了、线上那条语句其实不一样」这种最坏情形。
 *
 * 这里只放纯文本生成，不碰数据库、不碰对象存储、没有在 import 时执行的副作用。
 */

export type MappingPair = { oldId: string; newId: string; newShareKey?: string }
export type Mapping = { generatedAt: string; pairs: MappingPair[] }
export type FkDef = { table: string; constraint: string; definition: string; column: string }
export type PathCell = { table: string; column: string; hits: number }
export type ColumnRef = { table: string; column: string }

/**
 * 只保留 SQL 里能安全内联的字符：映射值与 LIKE 模式都是脚本自己生成的，不接外部输入。
 * 模式串多允许 / 与 %（前缀形状），引号、空格、分号一律拒。
 */
export function sqlLiteral(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new Error(`映射值形状不对，拒绝拼进 SQL：${JSON.stringify(value.slice(0, 24))}`)
  return `'${value}'`
}
/** 约束名是驼峰标识符，不加双引号会被 Postgres 折成小写而「不存在」（本地实测踩过）。 */
export function sqlIdent(value: string): string {
  if (!/^[A-Za-z0-9_]{1,63}$/.test(value)) throw new Error(`标识符形状不对，拒绝拼进 SQL：${JSON.stringify(value.slice(0, 40))}`)
  return `"${value}"`
}
export function sqlPattern(value: string): string {
  if (!/^[A-Za-z0-9_/%-]{1,128}$/.test(value)) throw new Error(`LIKE 模式形状不对，拒绝拼进 SQL：${JSON.stringify(value.slice(0, 24))}`)
  return `'${value}'`
}

export const TEAM_PREFIX = 'teams/'

export function oldPrefix(oldId: string) {
  return `${TEAM_PREFIX}${oldId}/`
}
export function newPrefix(newId: string) {
  return `${TEAM_PREFIX}${newId}/`
}

// ── 读：盘点的三条 ────────────────────────────────────────────────────────

export const SQL_READ_TEAMS = `SELECT id, slug, name, "shareKey" FROM "Team" ORDER BY "createdAt" ASC`

/** 引用 Team.id 的外键，连定义一起取回来，改完照原文装回去。 */
export const SQL_READ_FKS = `SELECT c.conname AS constraint,
       c.conrelid::regclass::text AS table,
       pg_get_constraintdef(c.oid) AS definition,
       a.attname AS column
FROM pg_constraint c
JOIN pg_class tc ON tc.oid = c.conrelid
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
WHERE c.contype='f' AND c.confrelid = '"Team"'::regclass AND tc.relkind='r' AND cardinality(c.conkey) = 1`

/** 这条脚本只处理单列外键；复合外键得先看清楚再改，绝不能默默漏掉。 */
export const SQL_COMPOSITE_FKS = `SELECT count(*)::bigint AS n FROM pg_constraint
WHERE contype='f' AND confrelid='"Team"'::regclass AND cardinality(conkey) > 1`

/** 候选文本列：按值现查，不写死列名——线上新加一列存路径也不会漏。 */
export const SQL_TEXT_COLUMNS = `SELECT table_name AS table, column_name AS column FROM information_schema.columns
WHERE table_schema='public' AND data_type IN ('text','character varying')
  AND table_name NOT LIKE 'pg\\_%' AND table_name <> '_prisma_migrations'
ORDER BY table_name, column_name`

/**
 * 每个候选列对每个旧号数一次「以 teams/<旧号>/ 开头」。一列一条 UNION，
 * 线上上千个文本列 × 若干团队，逐列一问会慢到没法用。
 */
export function pathCellScanSql(columns: ColumnRef[], oldIds: string[], batchSize = 400): string[] {
  const parts: string[] = []
  for (const { table, column } of columns) {
    for (const oldId of oldIds) {
      parts.push(`SELECT ${sqlLiteral(table)} AS table, ${sqlLiteral(column)} AS column, ${sqlLiteral(oldId)} AS old_id,
  count(*) FILTER (WHERE ${sqlIdent(column)} LIKE ${sqlPattern(oldPrefix(oldId) + '%')})::bigint AS n FROM ${sqlIdent(table)}`)
    }
  }
  const batches: string[] = []
  for (let i = 0; i < parts.length; i += batchSize) {
    batches.push(`SELECT * FROM (${parts.slice(i, i + batchSize).join('\nUNION ALL\n')}) x WHERE x.n > 0`)
  }
  return batches
}

/** 不是外键、靠发现找不到的那列（运营后台的卡密兑换记录）。 */
export function activationCardCountSql(oldIds: string[]) {
  if (!oldIds.length) return `SELECT 0::bigint AS n`
  return `SELECT count(*)::bigint AS n FROM "TeamActivationCard" WHERE "redeemedByTeamId" IN (${oldIds.map(sqlLiteral).join(',')})`
}

// ── 写：一条语句一个元素 ──────────────────────────────────────────────────

/**
 * main    ＝ 临时表 + 外键改延迟 + 全部改写 + 自证（一个事务）
 * restore ＝ 外键按原文装回（必须另一个事务：Postgres 不允许在「本事务还有待处理的触发事件」时
 *            ALTER 同一张表，而 DEFERRED 外键恰恰要到 COMMIT 才校验——第一段提交完才装得回去，
 *            本地实测报 55006）
 */
export function buildPhases(mapping: Mapping, fks: FkDef[], pathCells: PathCell[]) {
  const values = mapping.pairs
    .map(m => `(${sqlLiteral(m.oldId)}, ${sqlLiteral(m.newId)}${m.newShareKey ? `, ${sqlLiteral(m.newShareKey)}` : ', NULL'})`).join(', ')
  const plain = (f: FkDef) => f.definition.replace(/\s+DEFERRABLE|\s+INITIALLY\s+(DEFERRED|IMMEDIATE)/gi, '')
  const oldIds = mapping.pairs.map(m => sqlLiteral(m.oldId)).join(',')

  const main: string[] = [
    `CREATE TEMP TABLE team_id_map(old_id text PRIMARY KEY, new_id text NOT NULL, new_share_key text) ON COMMIT DROP`,
    `INSERT INTO team_id_map(old_id, new_id, new_share_key) VALUES ${values}`,
  ]
  for (const f of fks) {
    main.push(`ALTER TABLE ${f.table} DROP CONSTRAINT ${sqlIdent(f.constraint)}`)
    main.push(`ALTER TABLE ${f.table} ADD CONSTRAINT ${sqlIdent(f.constraint)} ${plain(f)} DEFERRABLE INITIALLY DEFERRED`)
  }
  // 先换存储键的开头（只动字符串，不碰对象）
  for (const p of pathCells) {
    main.push(`UPDATE ${sqlIdent(p.table)} SET ${sqlIdent(p.column)} = 'teams/' || m.new_id || '/' || substring(${sqlIdent(p.column)} from length('teams/' || m.old_id || '/') + 1)
  FROM team_id_map m WHERE ${sqlIdent(p.column)} LIKE 'teams/' || m.old_id || '/%'`)
  }
  for (const f of fks) {
    main.push(`UPDATE ${f.table} t SET ${sqlIdent(f.column)} = m.new_id FROM team_id_map m WHERE t.${sqlIdent(f.column)} = m.old_id`)
  }
  main.push(`UPDATE "TeamActivationCard" SET "redeemedByTeamId" = m.new_id FROM team_id_map m WHERE "TeamActivationCard"."redeemedByTeamId" = m.old_id`)
  // 分享键恰好等于旧 ID 的团队换成一枚新的 tm_ 键：不能顶成新 ID，那样键又等于 ID，等于没改干净
  main.push(`UPDATE "Team" SET "shareKey" = m.new_share_key FROM team_id_map m WHERE "Team"."shareKey" = m.old_id AND m.new_share_key IS NOT NULL`)
  main.push(`UPDATE "Team" t SET "id" = m.new_id FROM team_id_map m WHERE t."id" = m.old_id`)
  main.push(selfCheckSql(mapping.pairs.length, oldIds))

  const restore: string[] = []
  for (const f of fks) {
    restore.push(`ALTER TABLE ${f.table} DROP CONSTRAINT ${sqlIdent(f.constraint)}`)
    restore.push(`ALTER TABLE ${f.table} ADD CONSTRAINT ${sqlIdent(f.constraint)} ${plain(f)}`)
  }
  return { main, restore }
}

/** 自证：号池形状、映射盖住全部团队、库里零残留——任何一条不对就整段回滚。 */
export function selfCheckSql(expectedTeams: number, quotedOldIds: string) {
  return `DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM "Team";
  IF n <> ${expectedTeams} THEN RAISE EXCEPTION '团队行数对不上：期望 %，实际 %', ${expectedTeams}, n; END IF;
  SELECT count(*) INTO n FROM "Team" WHERE "id" !~ '^[1-9][0-9]{5}$';
  IF n > 0 THEN RAISE EXCEPTION '还有 % 枚团队 ID 不是 6 位数字', n; END IF;
  SELECT count(*) INTO n FROM "Team" t WHERE NOT EXISTS (SELECT 1 FROM team_id_map m WHERE m.new_id = t."id");
  IF n > 0 THEN RAISE EXCEPTION '有 % 枚团队 ID 不在映射里（映射没盖住全部团队）', n; END IF;
  SELECT count(*) INTO n FROM "Team" t WHERE t."id" IN (${quotedOldIds});
  IF n > 0 THEN RAISE EXCEPTION 'Team.id 里还留着 % 枚旧号', n; END IF;
  SELECT count(*) INTO n FROM "Team" t WHERE t."shareKey" IN (${quotedOldIds});
  IF n > 0 THEN RAISE EXCEPTION 'Team.shareKey 里还留着 % 枚旧号（对外链接里还会写着旧 ID）', n; END IF;
  SELECT count(*) INTO n FROM "Team" WHERE "shareKey" = "id";
  IF n > 0 THEN RAISE EXCEPTION '有 % 枚团队的分享键又等于自己的 ID 了', n; END IF;
END $$`
}

/** psql 一次一块：两段各自一个事务，中间必须 COMMIT 才装得回外键。 */
export function renderSql(phases: { main: string[]; restore: string[] }, commit: boolean) {
  if (!commit) {
    return `BEGIN;\n-- 演练：整段执行完回滚，库里一个字节都不留（外键从没真被改过）\n${phases.main.join(';\n')};\nROLLBACK;\n`
  }
  return `BEGIN;\n${phases.main.join(';\n')};\nCOMMIT;\nBEGIN;\n${phases.restore.join(';\n')};\nCOMMIT;\n`
}

/** 只换分享键那一段（切换之后又发现键顶着旧号时用，不必重跑整段）。 */
export function buildShareKeyPhases(pairs: { oldKey: string; fresh: string }[]) {
  const values = pairs.map(p => `(${sqlLiteral(p.oldKey)}, ${sqlLiteral(p.fresh)})`).join(', ')
  return [
    `CREATE TEMP TABLE share_key_map(old_key text PRIMARY KEY, new_key text NOT NULL) ON COMMIT DROP`,
    `INSERT INTO share_key_map(old_key, new_key) VALUES ${values}`,
    `UPDATE "Team" SET "shareKey" = m.new_key FROM share_key_map m WHERE "Team"."shareKey" = m.old_key`,
    `DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM "Team" WHERE "shareKey" = "id";
  IF n > 0 THEN RAISE EXCEPTION '还有 % 枚团队的分享键等于自己的 ID', n; END IF;
END $$`,
  ]
}

// ── 读：切完之后核对用的三条 ─────────────────────────────────────────────

export const SQL_TEAM_SHAPE = `SELECT id, "shareKey" FROM "Team" ORDER BY id ASC`
export const SQL_FK_DEFERRABLE = `SELECT count(*)::bigint AS n FROM pg_constraint
WHERE contype='f' AND confrelid='"Team"'::regclass AND condeferrable`
export const SQL_PATH_CELLS = `SELECT DISTINCT "hlsPath" AS p FROM "Video" WHERE "hlsPath" LIKE 'teams/%'`

/** 所有嵌着 teams/ 前缀的单元格（去重），逐条回查对象在不在。 */
export function allStoredPathSql(columns: ColumnRef[]) {
  const parts = columns.map(({ table, column }) =>
    `SELECT ${sqlLiteral(table)} AS source, ${sqlIdent(column)} AS p FROM ${sqlIdent(table)} WHERE ${sqlIdent(column)} LIKE 'teams/%'`)
  const batches: string[] = []
  for (let i = 0; i < parts.length; i += 400) {
    batches.push(`SELECT DISTINCT source, p FROM (${parts.slice(i, i + 400).join('\nUNION ALL\n')}) x`)
  }
  return batches
}
