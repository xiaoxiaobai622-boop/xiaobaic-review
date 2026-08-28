import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiUser } from '@/lib/auth'
import { getTeamMember } from '@/lib/team-access'
import { getTeamQuota } from '@/lib/platform-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function serializeBytes(value: bigint | null | undefined) {
  return value?.toString() ?? '0'
}

function sumBytes(values: Array<bigint | null | undefined>) {
  return values.reduce<bigint>((total, value) => value == null ? total : total + value, BigInt(0))
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

  const [team, quota, videoBytes, assetBytes, uploadBytes, photoBytes, projects] = await Promise.all([
    prisma.team.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        avatarUrl: true,
        status: true,
        createdAt: true,
        _count: { select: { members: true, projects: true } },
      },
    }),
    getTeamQuota(id),
    prisma.video.aggregate({
      where: { project: { teamId: id } },
      _sum: { originalFileSize: true },
      _count: { _all: true },
    }),
    prisma.videoAsset.aggregate({
      where: { video: { project: { teamId: id } }, uploadCompletedAt: { not: null } },
      _sum: { fileSize: true },
    }),
    prisma.projectUpload.aggregate({
      where: { project: { teamId: id }, uploadCompletedAt: { not: null } },
      _sum: { fileSize: true },
    }),
    prisma.photo.aggregate({
      where: { album: { project: { teamId: id } }, uploadCompletedAt: { not: null } },
      _sum: { fileSize: true },
    }),
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
        _count: { select: { videos: true, members: true } },
      },
    }),
  ])

  if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 })

  const projectSummaries = await Promise.all(projects.map(async (project) => {
    const [videos, assets, uploads] = await Promise.all([
      prisma.video.aggregate({ where: { projectId: project.id }, _sum: { originalFileSize: true } }),
      prisma.videoAsset.aggregate({ where: { video: { projectId: project.id }, uploadCompletedAt: { not: null } }, _sum: { fileSize: true } }),
      prisma.projectUpload.aggregate({ where: { projectId: project.id, uploadCompletedAt: { not: null } }, _sum: { fileSize: true } }),
    ])
    const sizeBytes = sumBytes([videos._sum.originalFileSize, assets._sum.fileSize, uploads._sum.fileSize])
    return { ...project, sizeBytes: serializeBytes(sizeBytes) }
  }))

  const usedBytes = sumBytes([
    videoBytes._sum.originalFileSize,
    assetBytes._sum.fileSize,
    uploadBytes._sum.fileSize,
    photoBytes._sum.fileSize,
  ])

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
      videos: videoBytes._count._all,
      usedBytes: serializeBytes(usedBytes),
      recycleBinBytes: '0',
    },
    projects: projectSummaries,
  })
}
