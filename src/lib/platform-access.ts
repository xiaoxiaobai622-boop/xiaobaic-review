import { prisma } from '@/lib/db'

export const BETA_PLAN = 'BETA'

// 免费内测期所有团队共用这一份额度，不再有试用/月卡两档。
export const BETA_QUOTA = {
  maxMembers: 5,
  maxProjects: 0,
  maxVideos: 0,
  maxStorageGB: 10,
} as const

// 「额度列填 0 或负数 = 不限」这一条口径原来住在 `@/lib/billing-pricing`，
// 写闸门是全站唯一还在用它的活代码；计费面 10-04 整体搬进 `src/disabled-billing/` 后就地自带一份，
// 免得一条通向已停功能的 import 把死代码拖回构建产物。搬回来的那天两枚二选一。
export function isUnlimitedQuota(value: number): boolean {
  return value <= 0
}

export function isTeamSubscriptionActive(_team: { subscriptionPlan: string; subscriptionExpiresAt: Date | null }) {
  // 免费内测期没有到期这回事：写闸门照旧调用这里，但只有团队状态能拦下写操作。
  return true
}

export async function isTeamFeatureEnabled(teamId: string, featureKey: string) {
  const [grant, feature] = await Promise.all([
    prisma.teamFeatureGrant.findUnique({
      where: { teamId_featureKey: { teamId, featureKey } },
      select: { enabled: true },
    }),
    prisma.platformFeature.findUnique({
      where: { key: featureKey },
      select: { defaultEnabled: true },
    }),
  ])

  return grant?.enabled ?? feature?.defaultEnabled ?? false
}

export async function getTeamQuota(teamId: string) {
  const row = await prisma.teamQuota.findUnique({ where: { teamId } })
  // 读一次额度不许落一行：quota 只由「新建团队」和后台手动改额度两处写。之前的 `upsert` 让任何一次
  // 容量/席位检查都给缺行团队补写一行，于是「线上 6 个团队只有 4 行 quota」这种真实差异会被查看动作抹掉。
  // 缺行时返回内测口径，不能回落到 schema 默认（10 人 / 20 GB / 5 项目 / 50 视频）。
  return row ?? { teamId, ...BETA_QUOTA, source: 'PLAN' }
}

export async function getTeamUsage(teamId: string) {
  const [members, projects, videos] = await Promise.all([
    prisma.teamMember.count({ where: { teamId, status: 'ACTIVE' } }),
    prisma.project.count({ where: { teamId } }),
    prisma.video.count({ where: { project: { teamId } } }),
  ])
  return { members, projects, videos }
}

/**
 * One place decides what a team's storage actually is. Two rows can name the same
 * object (a rolled-back version keeps its file through a 收录 copy, and promote
 * moves the collected file onto the video row), so summing per-row sizes charges
 * the team twice for one object — the meter therefore dedupes by path and keeps the
 * largest declaration. Tombstones are grouped separately rather than dropped: the
 * recycle bin really does still occupy the bucket for 7 days, and the upload gate
 * must count what it cannot reclaim, while the UI needs to show it as its own line.
 * "rank" only breaks size ties so a shared object always reports under the same
 * source — without it Postgres picks arbitrarily and the per-source split flips
 * between two identical requests.
 */
type TeamStorageUsageRow = { projectId: string; source: string; inBin: boolean; bytes: bigint }

function teamStorageUsageRows(teamId: string | null) {
  return prisma.$queryRaw<TeamStorageUsageRow[]>`
    WITH named AS (
      SELECT v."projectId" AS "projectId", v."originalStoragePath" AS path, v."originalFileSize" AS bytes,
             (v."deletedAt" IS NOT NULL) AS "inBin", 'video' AS source, 1 AS rank
      FROM "Video" v JOIN "Project" p ON p.id = v."projectId"
      WHERE (${teamId}::text IS NULL OR p."teamId" = ${teamId}) AND v."originalFileSize" > 0
      UNION ALL
      SELECT v."projectId", a."storagePath", a."fileSize", (v."deletedAt" IS NOT NULL), 'asset', 2
      FROM "VideoAsset" a JOIN "Video" v ON v.id = a."videoId" JOIN "Project" p ON p.id = v."projectId"
      WHERE (${teamId}::text IS NULL OR p."teamId" = ${teamId}) AND a."uploadCompletedAt" IS NOT NULL AND a."fileSize" > 0
      UNION ALL
      SELECT u."projectId", u."storagePath", u."fileSize", false, 'upload', 3
      FROM "ProjectUpload" u JOIN "Project" p ON p.id = u."projectId"
      WHERE (${teamId}::text IS NULL OR p."teamId" = ${teamId}) AND u."uploadCompletedAt" IS NOT NULL AND u."fileSize" > 0
      UNION ALL
      SELECT al."projectId", ph."storagePath", ph."fileSize", false, 'photo', 4
      FROM "Photo" ph JOIN "PhotoAlbum" al ON al.id = ph."albumId" JOIN "Project" p ON p.id = al."projectId"
      WHERE (${teamId}::text IS NULL OR p."teamId" = ${teamId}) AND ph."uploadCompletedAt" IS NOT NULL AND ph."fileSize" > 0
    ), deduped AS (
      SELECT DISTINCT ON (path) "projectId", bytes, "inBin", source
      FROM named ORDER BY path, "inBin" ASC, bytes DESC, rank ASC
    )
    SELECT "projectId", source, "inBin", sum(bytes)::bigint AS bytes
    FROM deduped GROUP BY "projectId", source, "inBin"
  `
}

export type TeamStorageBreakdown = {
  /** Objects named by rows that are not in the recycle bin. */
  liveBytes: bigint
  /** Objects only the recycle bin still names — recoverable, but not free. */
  recycleBinBytes: bigint
  totalBytes: bigint
  bySource: Record<'video' | 'asset' | 'upload' | 'photo', bigint>
  byProject: Map<string, { liveBytes: bigint; recycleBinBytes: bigint }>
}

const ZERO = BigInt(0)

function summarizeStorageRows(rows: TeamStorageUsageRow[]): TeamStorageBreakdown {
  const breakdown: TeamStorageBreakdown = {
    liveBytes: ZERO,
    recycleBinBytes: ZERO,
    totalBytes: ZERO,
    bySource: { video: ZERO, asset: ZERO, upload: ZERO, photo: ZERO },
    byProject: new Map(),
  }
  for (const row of rows) {
    const bytes = row.bytes ?? ZERO
    const project = breakdown.byProject.get(row.projectId) ?? { liveBytes: ZERO, recycleBinBytes: ZERO }
    if (row.inBin) {
      breakdown.recycleBinBytes += bytes
      project.recycleBinBytes += bytes
    } else {
      breakdown.liveBytes += bytes
      project.liveBytes += bytes
    }
    if (row.source === 'video' || row.source === 'asset' || row.source === 'upload' || row.source === 'photo') {
      breakdown.bySource[row.source] += bytes
    }
    breakdown.byProject.set(row.projectId, project)
  }
  breakdown.totalBytes = breakdown.liveBytes + breakdown.recycleBinBytes
  return breakdown
}

export async function getTeamStorageBreakdown(teamId: string): Promise<TeamStorageBreakdown> {
  return summarizeStorageRows(await teamStorageUsageRows(teamId))
}

/**
 * Platform-wide meter: the same dedupe-by-path口径 as a single team's, so the console's
 * total can never contradict the sum of what each team is charged for.
 */
export async function getPlatformStorageTotals(): Promise<PlatformStorageTotals> {
  const breakdown = summarizeStorageRows(await teamStorageUsageRows(null))
  return {
    liveBytes: Number(breakdown.liveBytes),
    recycleBinBytes: Number(breakdown.recycleBinBytes),
    totalBytes: Number(breakdown.totalBytes),
    bySource: {
      video: Number(breakdown.bySource.video),
      asset: Number(breakdown.bySource.asset),
      upload: Number(breakdown.bySource.upload),
      photo: Number(breakdown.bySource.photo),
    },
  }
}

export type PlatformStorageTotals = {
  liveBytes: number
  recycleBinBytes: number
  totalBytes: number
  bySource: Record<'video' | 'asset' | 'upload' | 'photo', number>
}

export async function getTeamStorageUsage(teamId: string): Promise<bigint> {
  return (await getTeamStorageBreakdown(teamId)).totalBytes
}


export async function checkTeamStorageQuota(teamId: string, incomingBytes: number | bigint) {
  const quota = await getTeamQuota(teamId)
  if (isUnlimitedQuota(quota.maxStorageGB)) return { allowed: true, usedBytes: BigInt(0), limitBytes: null }
  const usedBytes = await getTeamStorageUsage(teamId)
  const limitBytes = BigInt(quota.maxStorageGB) * BigInt(1024) * BigInt(1024) * BigInt(1024)
  return { allowed: usedBytes + BigInt(incomingBytes) <= limitBytes, usedBytes, limitBytes }
}
