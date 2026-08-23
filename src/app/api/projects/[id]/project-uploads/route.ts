import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiAdmin } from '@/lib/auth'
import { canAccessProject } from '@/lib/project-access'
import { rateLimit } from '@/lib/rate-limit'
import { deleteFile } from '@/lib/storage'
import { logError } from '@/lib/logging'
import { dispatchDurableTask, recordDurableTask } from '@/lib/durable-tasks'

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
      select: {
        id: true,
        storagePath: true,
        thumbnailPath: true,
        sourceVideo: {
          include: { assets: true },
        },
      },
    })

    if (!upload) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 })
    }

    // Deleting a rolled-back collection item is the explicit hard-delete
    // action. Until this point, both the original and previews are retained so
    // the version can be restored without transcoding.
    if (upload.sourceVideo) {
      if (upload.sourceVideo.status !== 'ROLLED_BACK') {
        return NextResponse.json({ error: 'This retained video version is still active.' }, { status: 409 })
      }

      const video = upload.sourceVideo
      const cleanupPaths = [
        video.originalStoragePath,
        video.preview2160Path,
        video.preview1080Path,
        video.preview720Path,
        video.cleanPreview2160Path,
        video.cleanPreview1080Path,
        video.cleanPreview720Path,
      ].filter((value): value is string => Boolean(value))

      for (const asset of video.assets) {
        const sharedCount = await prisma.videoAsset.count({
          where: { storagePath: asset.storagePath, id: { not: asset.id } },
        })
        if (sharedCount === 0) cleanupPaths.push(asset.storagePath)
      }

      if (video.thumbnailPath) {
        const [sharedAssetCount, sharedVideoCount, sharedUploadCount] = await Promise.all([
          prisma.videoAsset.count({ where: { storagePath: video.thumbnailPath, videoId: { not: video.id } } }),
          prisma.video.count({ where: { thumbnailPath: video.thumbnailPath, id: { not: video.id } } }),
          prisma.projectUpload.count({ where: { thumbnailPath: video.thumbnailPath, id: { not: upload.id } } }),
        ])
        if (sharedAssetCount === 0 && sharedVideoCount === 0 && sharedUploadCount === 0) {
          cleanupPaths.push(video.thumbnailPath)
        }
      }

      const cleanupTask = await prisma.$transaction(async (tx) => {
        const task = await recordDurableTask(
          tx,
          'DELETE_STORAGE',
          `delete-rolled-back-video-storage:${video.id}`,
          { paths: [...new Set(cleanupPaths)], directories: [] },
        )
        await tx.projectUpload.delete({ where: { id: upload.id } })
        await tx.video.delete({ where: { id: video.id } })
        return task
      })
      await dispatchDurableTask(cleanupTask.id)
      return NextResponse.json({ success: true, deletedRetainedVersion: true })
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
