import { NextRequest, NextResponse } from 'next/server'
import { prisma, LIVE_VIDEO } from '@/lib/db'
import { requireApiUser } from '@/lib/auth'
import { getTeamMember } from '@/lib/team-access'
import { getTeamQuota, getTeamStorageBreakdown } from '@/lib/platform-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ZERO = BigInt(0)

function serializeBytes(value: bigint | null | undefined) {
  return value?.toString() ?? '0'
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireApiUser(request)
  if (authResult instanceof Response) return authResult

  const { id } = await params
  const membership = await getTeamMember(id, authResult.id)
  if (!membership || membership.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const [team, quota, storage, videos, projects] = await Promise.all([
    prisma.team.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        avatarUrl: true,
        status: true,
        createdAt: true,
        subscriptionPlan: true,
        subscriptionStartedAt: true,
        subscriptionExpiresAt: true,
        // The seat gate counts ACTIVE members only; the panel has to show the same number.
        _count: { select: { members: { where: { status: 'ACTIVE' } }, projects: true } },
      },
    }),
    getTeamQuota(id),
    getTeamStorageBreakdown(id),
    prisma.video.count({ where: { project: { teamId: id } } }),
    prisma.project.findMany({
      where: { teamId: id, status: { not: 'ARCHIVED' } },
      orderBy: { updatedAt: 'desc' },
      take: 8,
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { videos: { where: LIVE_VIDEO }, members: true } },
      },
    }),
  ])

  if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 })

  const projectSummaries = projects.map((project) => {
    const usage = storage.byProject.get(project.id) ?? { liveBytes: ZERO, recycleBinBytes: ZERO }
    // Everything the team is charged for this project, recycle bin included, so the
    // project rows add back up to the team figure.
    return { ...project, sizeBytes: serializeBytes(usage.liveBytes + usage.recycleBinBytes) }
  })

  return NextResponse.json({
    team,
    currentRole: membership.role,
    quota: {
      maxMembers: quota.maxMembers,
      maxProjects: quota.maxProjects,
      maxVideos: quota.maxVideos,
      maxStorageGB: quota.maxStorageGB,
    },
    usage: {
      members: team._count.members,
      projects: team._count.projects,
      videos,
      usedBytes: serializeBytes(storage.liveBytes),
      recycleBinBytes: serializeBytes(storage.recycleBinBytes),
      bySource: {
        videos: serializeBytes(storage.bySource.video),
        assets: serializeBytes(storage.bySource.asset),
        uploads: serializeBytes(storage.bySource.upload),
        photos: serializeBytes(storage.bySource.photo),
      },
    },
    projects: projectSummaries,
  })
}
