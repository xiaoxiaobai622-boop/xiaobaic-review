import { prisma } from '@/lib/db'

export const TRIAL_PLAN = 'TRIAL'
export const MONTHLY_PLAN = 'MONTHLY'
export const UNACTIVATED_PLAN = 'UNACTIVATED'
export const LEGACY_PLAN = 'LEGACY'

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
    create: { teamId },
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

export async function getTeamStorageUsage(teamId: string) {
  const [videoBytes, assetBytes, uploadBytes, photoBytes] = await Promise.all([
    prisma.video.aggregate({ where: { project: { teamId } }, _sum: { originalFileSize: true } }),
    prisma.videoAsset.aggregate({ where: { video: { project: { teamId } }, uploadCompletedAt: { not: null } }, _sum: { fileSize: true } }),
    prisma.projectUpload.aggregate({ where: { project: { teamId }, uploadCompletedAt: { not: null } }, _sum: { fileSize: true } }),
    prisma.photo.aggregate({ where: { album: { project: { teamId } }, uploadCompletedAt: { not: null } }, _sum: { fileSize: true } }),
  ])
  return [videoBytes._sum.originalFileSize, assetBytes._sum.fileSize, uploadBytes._sum.fileSize, photoBytes._sum.fileSize]
    .reduce<bigint>((total, value) => total + (value ?? BigInt(0)), BigInt(0))
}

export async function checkTeamStorageQuota(teamId: string, incomingBytes: number | bigint) {
  const quota = await getTeamQuota(teamId)
  if (isUnlimitedQuota(quota.maxStorageGB)) return { allowed: true, usedBytes: BigInt(0), limitBytes: null }
  const usedBytes = await getTeamStorageUsage(teamId)
  const limitBytes = BigInt(quota.maxStorageGB) * BigInt(1024) * BigInt(1024) * BigInt(1024)
  return { allowed: usedBytes + BigInt(incomingBytes) <= limitBytes, usedBytes, limitBytes }
}
