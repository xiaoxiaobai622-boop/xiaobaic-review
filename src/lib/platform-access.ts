import { prisma } from '@/lib/db'

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
