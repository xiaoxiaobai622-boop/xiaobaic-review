import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiAdmin } from '@/lib/auth'
import { canAccessProject } from '@/lib/project-access'
import { createRecycleBinItem } from '@/lib/recycle-bin'

export const runtime = 'nodejs'

async function authorize(request: NextRequest, projectId: string) {
  const auth = await requireApiAdmin(request)
  if (auth instanceof Response) return auth
  if (!(await canAccessProject(prisma, auth, projectId))) return new Response('Access denied', { status: 403 })
  return auth
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await authorize(request, id)
  if (auth instanceof Response) return auth
  const folders = await prisma.projectFolder.findMany({ where: { projectId: id }, orderBy: { name: 'asc' }, include: { _count: { select: { videos: true } } } })
  return NextResponse.json({ folders })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await authorize(request, id)
  if (auth instanceof Response) return auth
  const body = await request.json().catch(() => ({}))
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 120) return NextResponse.json({ error: '请输入有效的文件夹名称' }, { status: 400 })
  try {
    const folder = await prisma.projectFolder.create({ data: { projectId: id, name } })
    return NextResponse.json({ folder }, { status: 201 })
  } catch {
    return NextResponse.json({ error: '该文件夹已存在' }, { status: 409 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await authorize(request, id)
  if (auth instanceof Response) return auth
  const body = await request.json().catch(() => ({}))
  const folderId = typeof body.folderId === 'string' ? body.folderId : ''
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!folderId) return NextResponse.json({ error: 'folderId is required' }, { status: 400 })
  if (!name || name.length > 120) return NextResponse.json({ error: '请输入有效的文件夹名称' }, { status: 400 })
  const folder = await prisma.projectFolder.findFirst({ where: { id: folderId, projectId: id } })
  if (!folder) return NextResponse.json({ error: 'Folder not found' }, { status: 404 })
  try {
    const updatedFolder = await prisma.projectFolder.update({ where: { id: folder.id }, data: { name } })
    return NextResponse.json({ folder: updatedFolder })
  } catch {
    return NextResponse.json({ error: '该文件夹名称已存在' }, { status: 409 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await authorize(request, id)
  if (auth instanceof Response) return auth
  const folderId = new URL(request.url).searchParams.get('folderId')
  if (!folderId) return NextResponse.json({ error: 'folderId is required' }, { status: 400 })
  const folder = await prisma.projectFolder.findFirst({
    where: { id: folderId, projectId: id },
    include: { videos: { include: { assets: true } } },
  })
  if (!folder) return NextResponse.json({ error: 'Folder not found' }, { status: 404 })

  const videoIds = folder.videos.map((video) => video.id)
  const candidates = folder.videos.flatMap((video) => [
    video.originalStoragePath,
    video.preview2160Path,
    video.preview1080Path,
    video.preview720Path,
    video.hlsPath,
    video.cleanPreview2160Path,
    video.cleanPreview1080Path,
    video.cleanPreview720Path,
    video.thumbnailPath,
    ...video.assets.map((asset) => asset.storagePath),
  ]).filter((path): path is string => Boolean(path))

  const paths: string[] = []
  for (const path of [...new Set(candidates)]) {
    const [sharedVideos, sharedAssets] = await Promise.all([
      prisma.video.count({ where: {
        ...(videoIds.length > 0 ? { id: { notIn: videoIds } } : {}),
        OR: [
          { originalStoragePath: path },
          { preview2160Path: path },
          { preview1080Path: path },
          { preview720Path: path },
          { hlsPath: path },
          { cleanPreview2160Path: path },
          { cleanPreview1080Path: path },
          { cleanPreview720Path: path },
          { thumbnailPath: path },
        ],
      } }),
      prisma.videoAsset.count({ where: {
        storagePath: path,
        ...(videoIds.length > 0 ? { videoId: { notIn: videoIds } } : {}),
      } }),
    ])
    if (sharedVideos === 0 && sharedAssets === 0) paths.push(path)
  }

  await prisma.$transaction(async (tx) => {
    await createRecycleBinItem(tx, id, {
      itemType: 'FOLDER',
      itemName: folder.name,
      metadata: { folderId: folder.id, videoCount: folder.videos.length },
      paths,
    })
    if (videoIds.length > 0) await tx.video.deleteMany({ where: { id: { in: videoIds } } })
    await tx.projectFolder.delete({ where: { id: folder.id } })
  })
  return NextResponse.json({ success: true, message: 'Folder moved to recycle bin' })
}
