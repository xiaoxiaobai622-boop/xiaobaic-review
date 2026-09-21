import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma, LIVE_VIDEO } from '@/lib/db'
import { requireApiAdmin } from '@/lib/auth'
import { canAccessProject } from '@/lib/project-access'
import { getRedis } from '@/lib/redis'
import { fileExists } from '@/lib/storage'
import { getLatestVideo } from '@/lib/video-comment-counts'

export const runtime = 'nodejs'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAdmin(request)
  if (auth instanceof Response) return auth
  const { id: projectId } = await params
  if (!(await canAccessProject(prisma, auth, projectId))) return NextResponse.json({ error: 'Access denied' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const rawIds: unknown[] = Array.isArray(body?.videoIds) ? body.videoIds : []
  const videoIds = [...new Set(rawIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0))]
  if (videoIds.length === 0) return NextResponse.json({ error: 'videoIds is required' }, { status: 400 })

  // Only the group names are trusted from the client: a stale or older version id
  // must not smuggle an old file out of the ZIP.
  const selected = await prisma.video.findMany({
    where: { id: { in: videoIds }, projectId, ...LIVE_VIDEO },
    select: { name: true },
  })
  const names = [...new Set(selected.map((video) => video.name))]
  if (names.length === 0) return NextResponse.json({ error: 'Access denied' }, { status: 403 })

  const grouped = await prisma.video.findMany({
    where: { projectId, name: { in: names }, ...LIVE_VIDEO },
  })
  const versionsByName: Record<string, typeof grouped> = {}
  for (const video of grouped) (versionsByName[video.name] ||= []).push(video)
  const latestVideos = Object.values(versionsByName)
    .map((versions) => getLatestVideo(versions)!)
    .sort((a, b) => a.name.localeCompare(b.name))

  // Files that cannot be opened are skipped while the archive streams, so the
  // caller is told up front how many will actually land in the ZIP.
  const presence = await Promise.all(latestVideos.map((video) => fileExists(video.originalStoragePath)))
  const availableVideos = latestVideos.filter((_, index) => presence[index])
  const skipped = latestVideos.length - availableVideos.length
  if (availableVideos.length === 0) return NextResponse.json({ error: '没有可下载的视频' }, { status: 404 })

  const token = crypto.randomBytes(32).toString('hex')
  await getRedis().setex(`video_zip_download:${token}`, 300, JSON.stringify({
    projectId,
    sessionId: `admin:${projectId}`,
    videos: availableVideos.map((video) => ({
      id: video.id,
      name: video.name,
      versionLabel: video.versionLabel,
      path: video.originalStoragePath,
      fileName: video.originalFileName,
    })),
  }))

  return NextResponse.json({ url: `/api/content/video-zip/${token}`, count: availableVideos.length, skipped })
}
