import type { Prisma } from '@prisma/client'

/**
 * 团队 ID 是要被说出口的：界面上那行「团队 ID」会被人复制进接口、邀请和工单里，25 位的 cuid
 * 没人能手打。号池取 100000–999999，首位不许是 0——带前导 0 的号粘进表格或终端会被吃掉，
 * 那行就说不清自己是哪一枚了。
 */
const TEAM_ID_MIN = 100_000
const TEAM_ID_SPAN = 900_000
const TEAM_ID_PROBE_LIMIT = 64
// 团队标识（拼进加入链接那串）从 10000 往上递增，和上面的号池共用一处边界。
const TEAM_IDENTIFIER_MIN = 10_000
const TEAM_IDENTIFIER_SCAN_LIMIT = 1_000

export function isTeamId(value: string): boolean {
  return /^[1-9]\d{5}$/.test(value)
}

/**
 * 发号只需要「这枚占没占」和「总共占了几个」两件事，所以这里不收整个 Set 类型：
 * 判据因此能拿一枚假集合把「号池快满」和「号池全满」这两种真库要跑到几十万团队才碰得到的分支直接钉住。
 */
export type TakenTeamIds = { has(value: string): boolean; size: number }

export function pickTeamId(taken: TakenTeamIds, random: () => number = Math.random): string {
  if (taken.size >= TEAM_ID_SPAN) throw new Error('TEAM_ID_LIMIT_REACHED')
  for (let attempt = 0; attempt < TEAM_ID_PROBE_LIMIT; attempt++) {
    const candidate = String(TEAM_ID_MIN + Math.floor(random() * TEAM_ID_SPAN))
    if (!taken.has(candidate)) return candidate
  }
  // 随机位一直撞车＝号池快满了，退成从头扫。这一趟最坏跑满整个号池，只在「90 万枚里几乎全是
  // occupied」时发生，那种规模的团队数离这里还很远，但真到那天也不能发不出号。
  for (let offset = 0; offset < TEAM_ID_SPAN; offset++) {
    const candidate = String(TEAM_ID_MIN + offset)
    if (!taken.has(candidate)) return candidate
  }
  throw new Error('TEAM_ID_LIMIT_REACHED')
}

/**
 * 团队号、团队标识（slug）与分享键在界面上都是「一串能复制出去的字符」，所以三处必须互不相交：
 * 一枚 6 位数字既是团队号又是某队的标识，后台那行和加入链接就分不清指谁（10-15 线上实测已有
 * slug=`10000`、`1111`，而标识是从 10000 往上递增的，再长下去就要踏进号池）。
 * 只有「正好 6 位、首位非 0」的值才算占号——cuid、`tm_` 键与 4–5 位标识跟号池结构上不同名。
 */
export function blockedTeamIds(rows: { id: string; slug: string; shareKey: string }[]): Set<string> {
  const taken = new Set<string>()
  for (const row of rows) {
    for (const value of [row.id, row.slug, row.shareKey]) {
      if (isTeamId(value)) taken.add(value)
    }
  }
  return taken
}

/**
 * Runs inside the create transaction. Shares the advisory lock with the identifier allocator,
 * so two concurrent creates read one snapshot and can't claim the same number.
 */
export async function allocateTeamId(tx: Prisma.TransactionClient): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(86230402)`
  const rows = await tx.team.findMany({ select: { id: true, slug: true, shareKey: true } })
  return pickTeamId(blockedTeamIds(rows))
}

/**
 * 下一个团队标识。递增到 5 位尽头时必须整段跳过 100000–999999：那一段是团队号的池子，
 * 标识要是长进去，同一串数字就会同时是某队的 ID 和另一队的加入链接地址。
 */
export function nextTeamIdentifier(slugs: string[]): string {
  const taken = new Set(slugs)
  let cursor = TEAM_IDENTIFIER_MIN - 1
  for (const slug of slugs) {
    if (!/^\d+$/.test(slug)) continue
    const value = Number(slug)
    if (Number.isSafeInteger(value) && value >= TEAM_IDENTIFIER_MIN && value > cursor) cursor = value
  }
  for (let step = 0; step < TEAM_IDENTIFIER_SCAN_LIMIT; step++) {
    if (isTeamId(String(cursor + 1))) cursor = TEAM_ID_MIN + TEAM_ID_SPAN - 1
    cursor += 1
    if (!taken.has(String(cursor))) return String(cursor)
  }
  throw new Error('TEAM_IDENTIFIER_LIMIT_REACHED')
}
