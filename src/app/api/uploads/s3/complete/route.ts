import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { isS3Mode } from '@/lib/storage'
import { s3CompleteMultipartUpload, s3FileExists } from '@/lib/s3-storage'
import { sanitizeContentType } from '@/lib/file-validation'
import { verifyS3UploadAccess } from '@/lib/s3-upload-auth'
import { logError, logMessage } from '@/lib/logging'
import { rateLimit } from '@/lib/rate-limit'
import { handleReverseShareUploadNotification } from '@/lib/upload-notifications'
import type { CompletedPart } from '@aws-sdk/client-s3'
import { dispatchDurableTask, recordDurableTask } from '@/lib/durable-tasks'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  if (!isS3Mode()) {
    return NextResponse.json({ error: 'S3 storage is not enabled' }, { status: 400 })
  }

  try {
    const body = await request.json()
    const {
      uploadId,
      videoId,
      assetId,
      projectUploadId,
      photoId,
      parts,
      fileSize,
      contentType,
    } = body as {
      uploadId: string
      videoId?: string
      assetId?: string
      projectUploadId?: string
      photoId?: string
      parts: Array<{ partNumber: number; etag: string }>
      fileSize: number
      contentType?: string
    }

    if (!videoId && !assetId && !projectUploadId && !photoId) {
      return NextResponse.json(
        { error: 'Missing required field: videoId, assetId, projectUploadId, or photoId' },
        { status: 400 }
      )
    }

    // ── Authentication & ownership ────────────────────────────────────────────
    const authResult = await verifyS3UploadAccess(request, { videoId, assetId, projectUploadId, photoId }, { requireUploadPermission: true })
    if (authResult.errorResponse) return authResult.errorResponse

    // ── Rate limit: 30 complete requests per minute per client ──────────���─────
    const rateLimitResult = await rateLimit(request, {
      windowMs: 60 * 1000,
      maxRequests: 30,
      message: 'Too many upload requests. Please slow down.',
    }, 's3-complete')
    if (rateLimitResult) return rateLimitResult

    // ── Input validation ──────────────────────────────────────────────────────
    if (!uploadId || typeof uploadId !== 'string' || uploadId.length > 1024) {
      return NextResponse.json(
        { error: 'Missing or invalid field: uploadId' },
        { status: 400 }
      )
    }

    if (!parts?.length || parts.length > 10000) {
      return NextResponse.json(
        { error: 'Missing or invalid field: parts (must be 1–10000 items)' },
        { status: 400 }
      )
    }

    // Validate each part: number in 1–10000, ETag is a non-empty string
    for (const part of parts) {
      if (
        !Number.isInteger(part.partNumber) ||
        part.partNumber < 1 ||
        part.partNumber > 10000
      ) {
        return NextResponse.json({ error: 'Invalid part number' }, { status: 400 })
      }
      if (typeof part.etag !== 'string' || part.etag.length === 0 || part.etag.length > 256) {
        return NextResponse.json({ error: 'Invalid ETag in parts' }, { status: 400 })
      }
    }

    if (
      !fileSize ||
      !Number.isFinite(fileSize) ||
      !Number.isInteger(fileSize) ||
      fileSize <= 0
    ) {
      return NextResponse.json(
        { error: 'Missing or invalid field: fileSize (must be a positive integer)' },
        { status: 400 }
      )
    }

    // ── Derive S3 key from DB (never trust client-supplied key) ───────────────
    // Auth helper already resolved s3Key. For videos, re-check status (TOCTOU guard).
    let s3Key = authResult.s3Key
    let dbVideo: { id: string; originalStoragePath: string; originalFileName: string; projectId: string; status: string } | null = null
    let dbAsset: { id: string; storagePath: string; category: string | null; uploadCompletedAt: Date | null } | null = null
    let dbProjectUpload: { id: string; storagePath: string; projectId: string; fileName: string; uploadedByName: string | null; uploadedByEmail: string | null; uploadCompletedAt: Date | null } | null = null
    let dbPhoto: { id: string; storagePath: string; uploadCompletedAt: Date | null } | null = null

    if (videoId) {
      const video = await prisma.video.findUnique({
        where: { id: videoId },
        select: { id: true, originalStoragePath: true, originalFileName: true, projectId: true, status: true },
      })
      if (!video) return NextResponse.json({ error: 'Video record not found' }, { status: 404 })
      if (video.status !== 'UPLOADING') {
        if (video.status === 'PROCESSING' || video.status === 'READY') {
          return NextResponse.json({ ok: true, alreadyCompleted: true })
        }
        return NextResponse.json({ error: 'Video is no longer in UPLOADING state' }, { status: 409 })
      }
      s3Key = video.originalStoragePath
      dbVideo = video
    } else if (assetId) {
      dbAsset = await prisma.videoAsset.findUnique({
        where: { id: assetId },
        select: { id: true, storagePath: true, category: true, uploadCompletedAt: true },
      })
      if (!dbAsset) return NextResponse.json({ error: 'Asset record not found' }, { status: 404 })
      if (dbAsset.uploadCompletedAt) return NextResponse.json({ ok: true, alreadyCompleted: true })
    } else if (photoId) {
      dbPhoto = await prisma.photo.findUnique({
        where: { id: photoId },
        select: { id: true, storagePath: true, uploadCompletedAt: true },
      })
      if (!dbPhoto) return NextResponse.json({ error: 'Photo record not found' }, { status: 404 })
      if (dbPhoto.uploadCompletedAt) return NextResponse.json({ ok: true, alreadyCompleted: true })
    } else {
      const pu = await prisma.projectUpload.findUnique({
        where: { id: projectUploadId! },
        select: { id: true, storagePath: true, projectId: true, fileName: true, uploadedByName: true, uploadedByEmail: true, uploadCompletedAt: true },
      })
      if (!pu) return NextResponse.json({ error: 'Upload record not found' }, { status: 404 })
      dbProjectUpload = pu
      if (pu.uploadCompletedAt) return NextResponse.json({ ok: true, alreadyCompleted: true })
    }

    // ── Complete the multipart upload on S3 ────────────────────────────────────
    // ETags must be quoted per HTTP/S3 spec. The browser client strips quotes
    // from the ETag header value, so re-add them if missing.
    //
    // CRITICAL: S3's CompleteMultipartUpload requires Parts in ascending
    // PartNumber order. The client uploads parts via a worker pool that
    // finishes them in non-deterministic order, so we MUST sort here. The
    // SDK does not sort for us — sending unsorted parts returns InvalidPartOrder
    // and the upload appears as "Failed to complete upload" to the user.
    const completedParts: CompletedPart[] = parts
      .map((p) => ({
        PartNumber: p.partNumber,
        ETag: p.etag.startsWith('"') ? p.etag : `"${p.etag}"`,
      }))
      .sort((a, b) => (a.PartNumber ?? 0) - (b.PartNumber ?? 0))

    // CompleteMultipartUpload validates that every part is present and assembles
    // the object atomically.
    if (!(await s3FileExists(s3Key))) {
      await s3CompleteMultipartUpload(s3Key, uploadId, completedParts)
    }

    logMessage(`[S3 COMPLETE] Multipart upload complete for key: ${s3Key}`)

    // ── Update DB and trigger worker (mirrors TUS onUploadFinish) ─────────────
    if (dbVideo) {
      const task = await prisma.$transaction(async (tx) => {
        await tx.video.update({
          where: { id: dbVideo.id },
          data: { status: 'PROCESSING', processingProgress: 0 },
        })
        return recordDurableTask(tx, 'PROCESS_VIDEO', `process-video:${dbVideo.id}`, {
          videoId: dbVideo.id,
          originalStoragePath: dbVideo.originalStoragePath,
          projectId: dbVideo.projectId,
        })
      })
      await dispatchDurableTask(task.id)

      logMessage(`[S3 COMPLETE] Video ${dbVideo.id} queued for default 720p processing`)
    } else if (dbAsset) {
      const actualFileType = sanitizeContentType(contentType)

      const task = await prisma.$transaction(async (tx) => {
        await tx.videoAsset.update({
          where: { id: dbAsset.id },
          data: { fileType: actualFileType, fileSize: BigInt(fileSize), uploadCompletedAt: new Date() },
        })
        return recordDurableTask(tx, 'PROCESS_ASSET', `process-asset:${dbAsset.id}`, {
          assetId: dbAsset.id,
          storagePath: dbAsset.storagePath,
          ...(dbAsset.category ? { expectedCategory: dbAsset.category } : {}),
        })
      })
      await dispatchDurableTask(task.id)

      logMessage(`[S3 COMPLETE] Asset ${dbAsset.id} queued for processing`)
    } else if (dbPhoto) {
      const actualFileType = sanitizeContentType(contentType)

      const task = await prisma.$transaction(async (tx) => {
        await tx.photo.update({
          where: { id: dbPhoto.id },
          data: { fileType: actualFileType, fileSize: BigInt(fileSize), uploadCompletedAt: new Date() },
        })
        return recordDurableTask(tx, 'PROCESS_PHOTO', `process-photo:${dbPhoto.id}`, {
          photoId: dbPhoto.id,
          storagePath: dbPhoto.storagePath,
        })
      })
      await dispatchDurableTask(task.id)

      logMessage(`[S3 COMPLETE] Photo ${dbPhoto.id} queued for processing`)
    } else if (dbProjectUpload) {
      const actualFileType = sanitizeContentType(contentType)

      const task = await prisma.$transaction(async (tx) => {
        await tx.projectUpload.update({
          where: { id: dbProjectUpload.id },
          data: { fileType: actualFileType, fileSize: BigInt(fileSize), uploadCompletedAt: new Date() },
        })
        return recordDurableTask(tx, 'PROCESS_PROJECT_UPLOAD', `process-project-upload:${dbProjectUpload.id}`, {
          uploadId: dbProjectUpload.id,
          storagePath: dbProjectUpload.storagePath,
          projectId: dbProjectUpload.projectId,
        })
      })
      await dispatchDurableTask(task.id)

      logMessage(`[S3 COMPLETE] ProjectUpload ${dbProjectUpload.id} complete`)

      // Fire-and-forget notification to admins
      void handleReverseShareUploadNotification({
        projectId: dbProjectUpload.projectId,
        fileName: dbProjectUpload.fileName,
        uploaderName: dbProjectUpload.uploadedByName,
        uploaderEmail: dbProjectUpload.uploadedByEmail,
      })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    logError('[S3 COMPLETE] Error:', error)
    return NextResponse.json({ error: 'Failed to complete upload' }, { status: 500 })
  }
}
