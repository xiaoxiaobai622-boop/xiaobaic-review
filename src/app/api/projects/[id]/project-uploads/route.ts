import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiAdmin } from '@/lib/auth'
import { canAccessProject } from '@/lib/project-access'
import { rateLimit } from '@/lib/rate-limit'
import { deleteFile } from '@/lib/storage'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'

// GET /api/projects/[id]/project-uploads — admin lists all client uploads for a project
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApiAdmin(request)
  if (authResult instanceof Response) return authResult

  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 60,
    message: 'Too many requests. Please slow down.',
  }, 'project-uploads-list')
  if (rateLimitResult) return rateLimitResult

  try {
    const { id: projectId } = await params
    if (!(await canAccessProject(prisma, authResult, projectId))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    })

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const uploads = await prisma.projectUpload.findMany({
      where: { projectId, uploadCompletedAt: { not: null } },
      orderBy: { createdAt: 'desc' },
    })

    const serialized = uploads.map((u) => ({
      id: u.id,
      fileName: u.originalFileName || u.fileName,
      fileSize: u.fileSize.toString(),
      fileType: u.fileType,
      category: u.category,
      hasThumbnail: !!u.thumbnailPath,
      uploadedByName: u.uploadedByName,
      uploadedByEmail: u.uploadedByEmail,
      transcodeStatus: u.transcodeStatus,
      transcodeProgress: u.transcodeProgress,
      transcodeError: u.transcodeError,
      sourceVideoId: u.sourceVideoId,
      createdAt: u.createdAt,
    }))

    return NextResponse.json({ uploads: serialized })
  } catch (error) {
    logError('Error fetching project uploads:', error)
    return NextResponse.json({ error: 'Failed to fetch uploads' }, { status: 500 })
  }
}

// DELETE /api/projects/[id]/project-uploads?uploadId=xxx — admin deletes a project upload
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApiAdmin(request)
  if (authResult instanceof Response) return authResult

  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 30,
    message: 'Too many requests. Please slow down.',
  }, 'project-uploads-delete')
  if (rateLimitResult) return rateLimitResult

  try {
    const { id: projectId } = await params
    if (!(await canAccessProject(prisma, authResult, projectId))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
    const { searchParams } = new URL(request.url)
    const uploadId = searchParams.get('uploadId') ?? ''

    const upload = await prisma.projectUpload.findFirst({
      where: { id: uploadId, projectId },
      select: { id: true, storagePath: true, thumbnailPath: true },
    })

    if (!upload) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 })
    }

    const referencedVideoCount = await prisma.video.count({
      where: { originalStoragePath: upload.storagePath },
    })
    if (referencedVideoCount > 0) {
      return NextResponse.json(
        { error: 'This collected file is still used as a video original. Delete the video version first.' },
        { status: 409 }
      )
    }

    await deleteFile(upload.storagePath)
    if (upload.thumbnailPath) {
      await deleteFile(upload.thumbnailPath).catch(() => {})
    }
    await prisma.projectUpload.delete({ where: { id: upload.id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    logError('Error deleting project upload:', error)
    return NextResponse.json({ error: 'Failed to delete upload' }, { status: 500 })
  }
}
