import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiAdmin } from '@/lib/auth'
import { canManageProjectApproval } from '@/lib/project-access'
import { rateLimit } from '@/lib/rate-limit'
import { sanitizeFilename } from '@/lib/file-validation'
import { getVideoContentType } from '@/lib/storage'
import { cancelCommentNotification } from '@/lib/comment-helpers'
import { logError } from '@/lib/logging'
import { dispatchDurableTask, recordDurableTask } from '@/lib/durable-tasks'

export async function rollbackLatestVideoVersion(request: NextRequest, videoId: string) {
  const authResult = await requireApiAdmin(request)
  if (authResult instanceof Response) return authResult

  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 60 * 1000,
    maxRequests: 20,
    message: 'Too many version rollback requests. Please try again later.',
  }, 'video-version-rollback', authResult.id)
  if (rateLimitResult) return rateLimitResult

  try {
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      include: {
        project: { select: { id: true, status: true } },
        sourceUpload: { select: { id: true } },
      },
    })
    if (!video) {
      return NextResponse.json({ error: 'Video version not found.' }, { status: 404 })
    }

    const projectId = video.project.id
    if (!(await canManageProjectApproval(prisma, authResult, projectId))) {
      return NextResponse.json({ error: 'Only project administrators or the project creator can roll back a version.' }, { status: 403 })
    }
    if (video.project.status === 'APPROVED') {
      return NextResponse.json({ error: 'An approved project cannot roll back a video version.' }, { status: 409 })
    }
    if (video.status !== 'READY') {
      return NextResponse.json({ error: 'Only a fully processed video version can be rolled back.' }, { status: 409 })
    }
    if (video.sourceUpload) {
      return NextResponse.json({ error: 'This video version has already been rolled back.' }, { status: 409 })
    }

    const activeVersions = await prisma.video.findMany({
      where: { projectId, name: video.name, status: { not: 'ROLLED_BACK' } },
      orderBy: { version: 'desc' },
      select: { id: true, version: true },
    })
    if (activeVersions[0]?.id !== video.id) {
      return NextResponse.json({ error: 'Only the latest version can be rolled back.' }, { status: 409 })
    }
    if (activeVersions.length < 2) {
      return NextResponse.json({ error: 'The only version of a video cannot be rolled back.' }, { status: 409 })
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${projectId}:${video.name}`}))`

      const lockedProject = await tx.project.findUnique({
        where: { id: projectId },
        select: { status: true },
      })
      if (!lockedProject) throw new Error('PROJECT_NOT_FOUND')
      if (lockedProject.status === 'APPROVED') throw new Error('PROJECT_APPROVED')

      const lockedVersions = await tx.video.findMany({
        where: { projectId, name: video.name, status: { not: 'ROLLED_BACK' } },
        orderBy: { version: 'desc' },
        select: { id: true, version: true, status: true },
      })
      if (lockedVersions[0]?.id !== video.id) throw new Error('LATEST_VERSION_CHANGED')
      if (lockedVersions.length < 2) throw new Error('LAST_VERSION')
      if (lockedVersions[0].status !== 'READY') throw new Error('VERSION_NOT_READY')

      const commentsToDelete = await tx.comment.findMany({
        where: { videoId: video.id },
        select: { id: true },
      })
      const commentAssets = await tx.videoAsset.findMany({
        where: { videoId: video.id, commentId: { not: null } },
        select: { id: true, storagePath: true },
      })
      const commentAssetPaths: string[] = []
      for (const asset of commentAssets) {
        const sharedCount = await tx.videoAsset.count({
          where: { storagePath: asset.storagePath, id: { not: asset.id } },
        })
        if (sharedCount === 0) commentAssetPaths.push(asset.storagePath)
      }
      const safeFileName = sanitizeFilename(video.originalFileName || `version-${video.version}.mp4`)
      const upload = await tx.projectUpload.create({
        data: {
          projectId,
          fileName: safeFileName,
          originalFileName: video.originalFileName,
          fileSize: video.originalFileSize,
          fileType: video.fileType || getVideoContentType(video.originalFileName),
          storagePath: video.originalStoragePath,
          thumbnailPath: video.thumbnailPath,
          category: 'video',
          uploadedByName: video.uploadedByName || authResult.name || authResult.email,
          uploadCompletedAt: new Date(),
          transcodeStatus: 'READY',
          transcodeProgress: 100,
          sourceVideoId: video.id,
        },
      })

      await tx.video.update({
        where: { id: video.id },
        data: {
          status: 'ROLLED_BACK',
          approved: false,
          approvedAt: null,
          reviewStatus: null,
        },
      })
      if (commentAssets.length > 0) {
        await tx.videoAsset.deleteMany({ where: { id: { in: commentAssets.map((asset) => asset.id) } } })
      }
      await tx.comment.deleteMany({ where: { videoId: video.id } })

      const cleanupTask = commentAssetPaths.length > 0
        ? await recordDurableTask(
            tx,
            'DELETE_STORAGE',
            `rollback-comment-assets:${upload.id}`,
            { paths: [...new Set(commentAssetPaths)], directories: [] },
          )
        : null

      return {
        upload,
        cleanupTask,
        commentIds: commentsToDelete.map((comment) => comment.id),
        restoredLatestVersion: lockedVersions[1].version,
      }
    })

    await Promise.all(result.commentIds.map((commentId) => cancelCommentNotification(commentId)))
    if (result.cleanupTask) {
      await dispatchDurableTask(result.cleanupTask.id).catch((dispatchError) => {
        logError('Failed to dispatch rolled-back comment attachment cleanup:', dispatchError)
      })
    }

    return NextResponse.json({
      success: true,
      uploadId: result.upload.id,
      rolledBackVersion: video.version,
      restoredLatestVersion: result.restoredLatestVersion,
      deletedCommentCount: result.commentIds.length,
      retainedTranscode: true,
    })
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'PROJECT_NOT_FOUND') {
        return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
      }
      if (error.message === 'PROJECT_APPROVED') {
        return NextResponse.json({ error: 'An approved project cannot roll back a video version.' }, { status: 409 })
      }
      if (error.message === 'LATEST_VERSION_CHANGED') {
        return NextResponse.json({ error: 'The latest version changed while this request was running. Refresh and try again.' }, { status: 409 })
      }
      if (error.message === 'LAST_VERSION') {
        return NextResponse.json({ error: 'The only version of a video cannot be rolled back.' }, { status: 409 })
      }
      if (error.message === 'VERSION_NOT_READY') {
        return NextResponse.json({ error: 'Only a fully processed video version can be rolled back.' }, { status: 409 })
      }
    }
    logError('Failed to roll back latest video version:', error)
    return NextResponse.json({ error: 'Failed to roll back the latest version. No project data was changed.' }, { status: 500 })
  }
}
