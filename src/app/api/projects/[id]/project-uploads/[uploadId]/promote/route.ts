import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiAdmin } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { validateUploadedFile } from '@/lib/file-validation'
import { deleteFile, getVideoContentType } from '@/lib/storage'
import { getVideoQueue } from '@/lib/queue'
import { logError } from '@/lib/logging'
import { directPlaybackReadyData, probeStoredDirectPlayableMp4 } from '@/lib/direct-video-playback'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; uploadId: string }> }
) {
  const authResult = await requireApiAdmin(request)
  if (authResult instanceof Response) return authResult

  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 60 * 1000,
    maxRequests: 50,
    message: 'Too many video promotions. Please try again later.',
  }, 'promote-project-upload', authResult.id)
  if (rateLimitResult) return rateLimitResult

  try {
    const { id: projectId, uploadId } = await params
    const body = await request.json().catch(() => ({}))
    const videoName = typeof body.videoName === 'string' ? body.videoName.trim() : ''

    if (!videoName || videoName.length > 255) {
      return NextResponse.json({ error: 'A valid video name is required.' }, { status: 400 })
    }

    const upload = await prisma.projectUpload.findFirst({
      where: { id: uploadId, projectId, uploadCompletedAt: { not: null } },
    })
    if (!upload) {
      return NextResponse.json({ error: 'Collected file not found.' }, { status: 404 })
    }

    const normalizedMimeType = upload.fileType === 'application/octet-stream'
      ? getVideoContentType(upload.fileName)
      : upload.fileType
    const validation = validateUploadedFile(upload.fileName, normalizedMimeType, Number(upload.fileSize))
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error || 'Only video files can become a video version.' }, { status: 400 })
    }

    const result = await prisma.$transaction(async (tx) => {
      const project = await tx.project.findUnique({
        where: { id: projectId },
        include: { videos: { where: { name: videoName }, orderBy: { version: 'desc' } } },
      })
      if (!project) throw new Error('PROJECT_NOT_FOUND')
      if (project.status === 'APPROVED') throw new Error('PROJECT_APPROVED')
      if (project.enableRevisions && project.maxRevisions > 0 && project.videos.length >= project.maxRevisions) {
        throw new Error('MAX_REVISIONS')
      }

      const latestVersion = project.videos[0]?.version || 0
      const nextVersion = latestVersion + 1
      const video = await tx.video.create({
        data: {
          projectId,
          name: videoName,
          version: nextVersion,
          versionLabel: `v${nextVersion}`,
          originalFileName: upload.originalFileName || upload.fileName,
          originalFileSize: upload.fileSize,
          originalStoragePath: upload.storagePath,
          fileType: normalizedMimeType,
          uploadedBy: upload.uploadedBySessionId ? 'client' : authResult.id,
          uploadedByName: upload.uploadedByName || upload.uploadedByEmail || authResult.name || authResult.email,
          status: 'PROCESSING',
          processingProgress: 0,
          duration: 0,
          width: 0,
          height: 0,
        },
      })

      // Ownership moves from the collection inbox to the video. The original
      // file stays in server storage, so no browser download or re-upload occurs.
      await tx.projectUpload.delete({ where: { id: upload.id } })
      return video
    })

    if (upload.thumbnailPath) {
      await deleteFile(upload.thumbnailPath).catch(() => {})
    }

    const directPlayback = await probeStoredDirectPlayableMp4(
      result.originalStoragePath,
      result.originalFileName
    )

    if (directPlayback.compatible && directPlayback.metadata) {
      await prisma.video.update({
        where: { id: result.id },
        data: directPlaybackReadyData(directPlayback.metadata),
      })
    } else {
      try {
        await getVideoQueue().add('process-video', {
          videoId: result.id,
          originalStoragePath: result.originalStoragePath,
          projectId,
        })
      } catch (error) {
        await prisma.video.update({
          where: { id: result.id },
          data: { status: 'ERROR', processingError: 'Failed to queue video processing.' },
        }).catch(() => {})
        throw error
      }
    }

    return NextResponse.json({
      videoId: result.id,
      videoName: result.name,
      version: result.version,
      versionLabel: result.versionLabel,
    })
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'PROJECT_NOT_FOUND') {
        return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
      }
      if (error.message === 'PROJECT_APPROVED') {
        return NextResponse.json({ error: 'Approved projects cannot receive new versions.' }, { status: 400 })
      }
      if (error.message === 'MAX_REVISIONS') {
        return NextResponse.json({ error: 'The maximum number of revisions has been reached.' }, { status: 400 })
      }
    }
    logError('Failed to promote collected file to video:', error)
    return NextResponse.json({ error: 'Failed to create a video version from this file.' }, { status: 500 })
  }
}
