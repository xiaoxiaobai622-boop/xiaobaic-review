import type { Prisma } from '@prisma/client'

/**
 * 团队 ID 是要被说出口的：界面上那行「团队 ID」会被人复制进接口、邀请和工单里，25 位的 cuid
 * 没人能手打。号池取 100000–999999，首位不许是 0——带前导 0 的号粘进表格或终端会被吃掉，
 * 那行就说不清自己是哪一枚了。
 */
const TEAM_ID_MIN = 100_000
const TEAM_ID_SPAN = 900_000
const TEAM_ID_PROBE_LIMIT = 64

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
 * Runs inside the create transaction. Shares the advisory lock with the team-identifier
 * allocator, so two concurrent creates read one snapshot and can't claim the same number.
 * Reads every id because a numeric id can collide with a legacy cuid-shaped one only by
 * string equality — the pool is a set of strings, not a numeric range.
 */
export async function allocateTeamId(tx: Prisma.TransactionClient): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(86230402)`
  const rows = await tx.team.findMany({ select: { id: true } })
  return pickTeamId(new Set(rows.map((row) => row.id)))
}
