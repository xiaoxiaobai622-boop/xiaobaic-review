import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { requireApiAdmin } from '@/lib/auth'
import { canAccessProject } from '@/lib/project-access'
import { getRedis } from '@/lib/redis'

export const runtime = 'nodejs'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAdmin(request)
  if (auth instanceof Response) return auth
  const { id: projectId } = await params
  if (!(await canAccessProject(prisma, auth, projectId))) return NextResponse.json({ error: 'Access denied' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const folderId = typeof body.folderId === 'string' ? body.folderId : ''
  if (!folderId) return NextResponse.json({ error: 'folderId is required' }, { status: 400 })

  const folder = await prisma.projectFolder.findFirst({
    where: { id: folderId, projectId },
    include: { videos: { orderBy: [{ name: 'asc' }, { version: 'desc' }] } },
  })
  if (!folder) return NextResponse.json({ error: 'Folder not found' }, { status: 404 })
  if (folder.videos.length === 0) return NextResponse.json({ error: '文件夹中没有可下载的视频' }, { status: 404 })

  const latestVideos = [...new Map(folder.videos.map((video) => [video.name, video])).values()]
  const token = crypto.randomBytes(32).toString('hex')
  const sessionId = `admin:${projectId}`
  await getRedis().setex(`folder_zip_download:${token}`, 300, JSON.stringify({
    projectId,
    folderId,
    sessionId,
    videos: latestVideos.map((video) => ({ id: video.id, name: video.name, versionLabel: video.versionLabel, path: video.originalStoragePath, fileName: video.originalFileName })),
  }))

  return NextResponse.json({ url: `/api/content/folder-zip/${token}` })
}
