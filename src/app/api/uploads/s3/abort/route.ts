import { NextRequest, NextResponse } from 'next/server'
import { isS3Mode } from '@/lib/storage'
import { s3AbortMultipartUpload } from '@/lib/s3-storage'
import { verifyS3UploadAccess } from '@/lib/s3-upload-auth'
import { logError, logMessage } from '@/lib/logging'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

function badRequest(error: string): NextResponse {
  return NextResponse.json({ error }, { status: 400 })
}

export async function POST(request: NextRequest) {
  if (!isS3Mode()) {
    return badRequest('S3 storage is not enabled')
  }

  try {
    const body = await request.json()
    const { uploadId, videoId, assetId, projectUploadId, photoId } = body as {
      uploadId: string
      videoId?: string
      assetId?: string
      projectUploadId?: string
      photoId?: string
    }

    if (!videoId && !assetId && !projectUploadId && !photoId) {
      return badRequest('Missing required field: videoId, assetId, projectUploadId, or photoId')
    }

    // Ownership only — aborting deliberately skips the feature-flag checks.
    const authResult = await verifyS3UploadAccess(request, { videoId, assetId, projectUploadId, photoId })
    if (authResult.errorResponse) return authResult.errorResponse

    const rateLimitResult = await rateLimit(request, {
      windowMs: 60 * 1000,
      maxRequests: 30,
      message: 'Too many requests. Please slow down.',
    }, 's3-abort')
    if (rateLimitResult) return rateLimitResult

    if (!uploadId || typeof uploadId !== 'string' || uploadId.length > 1024) {
      return badRequest('Missing or invalid field: uploadId')
    }

    await s3AbortMultipartUpload(authResult.s3Key, uploadId)
    logMessage(`[S3 ABORT] Aborted multipart upload ${uploadId} for key: ${authResult.s3Key}`)

    return NextResponse.json({ ok: true })
  } catch (error) {
    logError('[S3 ABORT] Error:', error)
    return NextResponse.json({ error: 'Failed to abort upload' }, { status: 500 })
  }
}
