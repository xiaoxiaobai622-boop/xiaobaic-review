import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiAdmin } from '@/lib/auth'
import { canAccessProject } from '@/lib/project-access'

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

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await authorize(request, id)
  if (auth instanceof Response) return auth
  const folderId = new URL(request.url).searchParams.get('folderId')
  if (!folderId) return NextResponse.json({ error: 'folderId is required' }, { status: 400 })
  const folder = await prisma.projectFolder.findFirst({ where: { id: folderId, projectId: id }, include: { _count: { select: { videos: true } } } })
  if (!folder) return NextResponse.json({ error: 'Folder not found' }, { status: 404 })
  if (folder._count.videos > 0) return NextResponse.json({ error: '请先移出文件夹中的视频' }, { status: 409 })
  await prisma.projectFolder.delete({ where: { id: folder.id } })
  return NextResponse.json({ success: true })
}
