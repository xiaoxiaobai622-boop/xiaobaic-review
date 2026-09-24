import { prisma } from '@/lib/db'

export const TRIAL_PLAN = 'TRIAL'
export const MONTHLY_PLAN = 'MONTHLY'
export const UNACTIVATED_PLAN = 'UNACTIVATED'

export const TRIAL_QUOTA = {
  maxMembers: 2,
  maxProjects: 0,
  maxVideos: 0,
  maxStorageGB: 1,
} as const

export const MONTHLY_QUOTA = {
  maxMembers: 10,
  maxProjects: 0,
  maxVideos: 0,
  maxStorageGB: 50,
} as const

export function isUnlimitedQuota(value: number) {
  return value <= 0
}

export function isTeamSubscriptionActive(team: { subscriptionPlan: string; subscriptionExpiresAt: Date | null }) {
  if (team.subscriptionPlan === UNACTIVATED_PLAN) return false
  return !team.subscriptionExpiresAt || team.subscriptionExpiresAt.getTime() > Date.now()
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
  return prisma.teamQuota.upsert({
    where: { teamId },
    // Without an explicit create the row materializes from the schema defaults
    // (10 seats / 5 projects / 50 videos / 20 GB), which is more generous than the
    // trial a team gets from POST /api/teams — a team that predates that write would
    // quietly gain 19 GB the first time anything read its quota.
    create: { teamId, ...TRIAL_QUOTA },
    update: {},
  })
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

function teamStorageUsageRows(teamId: string) {
  return prisma.$queryRaw<TeamStorageUsageRow[]>`
    WITH named AS (
      SELECT v."projectId" AS "projectId", v."originalStoragePath" AS path, v."originalFileSize" AS bytes,
             (v."deletedAt" IS NOT NULL) AS "inBin", 'video' AS source, 1 AS rank
      FROM "Video" v JOIN "Project" p ON p.id = v."projectId"
      WHERE p."teamId" = ${teamId} AND v."originalFileSize" > 0
      UNION ALL
      SELECT v."projectId", a."storagePath", a."fileSize", (v."deletedAt" IS NOT NULL), 'asset', 2
      FROM "VideoAsset" a JOIN "Video" v ON v.id = a."videoId" JOIN "Project" p ON p.id = v."projectId"
      WHERE p."teamId" = ${teamId} AND a."uploadCompletedAt" IS NOT NULL AND a."fileSize" > 0
      UNION ALL
      SELECT u."projectId", u."storagePath", u."fileSize", false, 'upload', 3
      FROM "ProjectUpload" u JOIN "Project" p ON p.id = u."projectId"
      WHERE p."teamId" = ${teamId} AND u."uploadCompletedAt" IS NOT NULL AND u."fileSize" > 0
      UNION ALL
      SELECT al."projectId", ph."storagePath", ph."fileSize", false, 'photo', 4
      FROM "Photo" ph JOIN "PhotoAlbum" al ON al.id = ph."albumId" JOIN "Project" p ON p.id = al."projectId"
      WHERE p."teamId" = ${teamId} AND ph."uploadCompletedAt" IS NOT NULL AND ph."fileSize" > 0
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

export async function getTeamStorageBreakdown(teamId: string): Promise<TeamStorageBreakdown> {
  const rows = await teamStorageUsageRows(teamId)
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
