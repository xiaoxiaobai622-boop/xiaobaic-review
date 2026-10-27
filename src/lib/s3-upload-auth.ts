import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { hasWebsiteLoginSession, parseBearerToken, peekShareToken, verifyAdminAccessToken, verifyShareTokenResult } from '@/lib/auth'
import { isShareLinkActive, resolveShareMetadata, shareAllowsUploads } from '@/lib/share-links'
import { SHARE_ERROR_CODES } from '@/lib/share-error-codes'
import { logShareDenial, requestEndpoint } from '@/lib/share-auth'

interface S3UploadTarget {
  videoId?: string
  assetId?: string
  projectUploadId?: string
  photoId?: string
}

interface S3AuthSuccess {
  isAdmin: true
  s3Key: string
  errorResponse?: undefined
}

interface S3AuthShareSuccess {
  isAdmin: false
  s3Key: string
  errorResponse?: undefined
}

interface S3AuthFailure {
  isAdmin?: undefined
  s3Key?: undefined
  errorResponse: NextResponse
}

export type S3AuthResult = S3AuthSuccess | S3AuthShareSuccess | S3AuthFailure

async function resolveProjectId(target: S3UploadTarget): Promise<string | null> {
  if (target.videoId) {
    const video = await prisma.video.findUnique({
      where: { id: target.videoId },
      select: { projectId: true },
    })
    return video?.projectId || null
  }
  if (target.assetId) {
    const asset = await prisma.videoAsset.findUnique({
      where: { id: target.assetId },
      select: { video: { select: { projectId: true } } },
    })
    return asset?.video.projectId || null
  }
  if (target.projectUploadId) {
    const upload = await prisma.projectUpload.findUnique({
      where: { id: target.projectUploadId },
      select: { projectId: true },
    })
    return upload?.projectId || null
  }
  if (target.photoId) {
    const photo = await prisma.photo.findUnique({
      where: { id: target.photoId },
      select: { album: { select: { projectId: true } } },
    })
    return photo?.album.projectId || null
  }
  return null
}

/** Target → owning project. Kept next to the existing resolution so the two can't drift. */
export async function getUploadTargetProjectId(target: S3UploadTarget): Promise<string | null> {
  return resolveProjectId(target)
}

export async function canUserAdministerUploadTarget(userId: string, target: S3UploadTarget): Promise<boolean> {
  const projectId = await resolveProjectId(target)
  if (!projectId) return false

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      team: {
        status: 'ACTIVE',
        members: {
          some: {
            userId,
            status: 'ACTIVE',
            role: { in: ['OWNER', 'ADMIN'] },
          },
        },
      },
    },
    select: { id: true },
  })
  return Boolean(project)
}

/**
 * Authenticate the request and verify upload ownership.
 *
 * For non-abort operations, pass `requireUploadPermission: true` to enforce
 * comment permission, guest blocking, and feature-flag checks
 * (allowReverseShare / allowClientAssetUpload).
 *
 * For abort operations, ownership is still verified but feature-flag checks
 * are skipped (you should always be able to abort your own upload).
 */
export async function verifyS3UploadAccess(
  request: NextRequest,
  target: S3UploadTarget,
  options: { requireUploadPermission?: boolean } = {}
): Promise<S3AuthResult> {
  const { videoId, assetId, projectUploadId, photoId } = target
  const requireUploadPermission = options.requireUploadPermission ?? false

  if (!videoId && !assetId && !projectUploadId && !photoId) {
    return {
      errorResponse: NextResponse.json(
        { error: 'Missing required field: videoId, assetId, projectUploadId, or photoId' },
        { status: 400 }
      ),
    }
  }

  // Account auth and share access are independent. Reverse-share uploads need
  // both: the account proves the uploader is signed in, while the share token
  // limits the upload to this project and share session.
  const accountBearer = parseBearerToken(request)
  const explicitShareBearer = parseBearerToken(request, 'x-share-token')
  if (!accountBearer && !explicitShareBearer) {
    return { errorResponse: NextResponse.json({ error: 'Authentication required', code: SHARE_ERROR_CODES.AUTH_REQUIRED }, { status: 401 }) }
  }

  const adminPayload = accountBearer ? await verifyAdminAccessToken(accountBearer) : null
  let isAdmin = false

  if (adminPayload) {
    isAdmin = await canUserAdministerUploadTarget(adminPayload.userId, target)
  }

  if (!isAdmin) {
    const shareBearer = explicitShareBearer || (accountBearer && peekShareToken(accountBearer) ? accountBearer : null)
    if (!shareBearer) {
      const endpoint = requestEndpoint(request)
      logShareDenial({
        shareToken: accountBearer ? peekShareToken(accountBearer)?.shareId ?? null : null,
        endpoint,
        reason: SHARE_ERROR_CODES.PERMISSION_DENIED,
      })
      return { errorResponse: NextResponse.json({ error: 'Access denied', code: SHARE_ERROR_CODES.PERMISSION_DENIED }, { status: 403 }) }
    }

    const shareResult = await verifyShareTokenResult(shareBearer)
    if (!shareResult.payload) {
      return {
        errorResponse: NextResponse.json(
          { error: shareResult.failure.message, code: shareResult.failure.code },
          { status: 401 },
        ),
      }
    }
    const sharePayload = shareResult.payload
    const endpoint = requestEndpoint(request)
    const denied = (code: string, message: string, status = 403) => {
      if (status === 403) logShareDenial({ shareToken: sharePayload.shareId, endpoint, reason: code })
      return { errorResponse: NextResponse.json({ error: message, code }, { status }) }
    }

    const resolved = await resolveShareMetadata(sharePayload.shareId)
    if (!resolved.policy || !resolved.project) {
      return denied(SHARE_ERROR_CODES.LINK_MISSING, 'Share link no longer exists', 401)
    }
    if (!isShareLinkActive(resolved.policy)) {
      return {
        errorResponse: NextResponse.json({ error: 'Share link is no longer active', code: SHARE_ERROR_CODES.LINK_INACTIVE }, { status: 410 }),
      }
    }

    // Share tokens cannot touch video or photo uploads (admin-only)
    if (videoId || photoId) {
      return denied(SHARE_ERROR_CODES.PERMISSION_DENIED, 'Admin access required')
    }

    // Non-abort paths require comment permission and block guests
    if (requireUploadPermission) {
      if (!assetId && !projectUploadId) {
        return denied(SHARE_ERROR_CODES.PERMISSION_DENIED, 'Share tokens can only upload assets or project files')
      }
      if (assetId) {
        if (!sharePayload.permissions?.includes('comment')) {
          return denied(SHARE_ERROR_CODES.PERMISSION_DENIED, 'Comment permission required')
        }
        if (sharePayload.guest) {
          return denied(SHARE_ERROR_CODES.GUEST_RESTRICTED, 'Guest access cannot upload files')
        }
      }
    }

    // ── Verify ownership + feature flags for projectUploadId ─────────────────
    if (projectUploadId) {
      if (!(await hasWebsiteLoginSession(request))) {
        return { errorResponse: NextResponse.json({ error: '请登录后上传素材', code: SHARE_ERROR_CODES.LOGIN_REQUIRED }, { status: 401 }) }
      }
      const projectUpload = await prisma.projectUpload.findUnique({
        where: { id: projectUploadId },
        select: { storagePath: true, projectId: true, uploadedBySessionId: true },
      })
      if (!projectUpload) {
        return { errorResponse: NextResponse.json({ error: 'Upload record not found', code: SHARE_ERROR_CODES.LINK_MISSING }, { status: 404 }) }
      }
      if (projectUpload.projectId !== sharePayload.projectId) {
        return denied(SHARE_ERROR_CODES.SCOPE_DENIED, 'Upload does not belong to your project')
      }
      if (projectUpload.uploadedBySessionId !== sharePayload.sessionId) {
        return denied(SHARE_ERROR_CODES.SCOPE_DENIED, 'Upload does not belong to your session')
      }
      if (requireUploadPermission && !shareAllowsUploads(resolved.policy, resolved.project)) {
        return denied(SHARE_ERROR_CODES.UPLOAD_NOT_ALLOWED, 'File submissions are not enabled for this link')
      }
      return { isAdmin: false, s3Key: projectUpload.storagePath }
    }

    // ── Verify ownership + feature flags for assetId ─────────────────────────
    if (assetId) {
      const asset = await prisma.videoAsset.findUnique({
        where: { id: assetId },
        select: {
          storagePath: true,
          uploadedBy: true,
          uploadedBySessionId: true,
          video: { select: { projectId: true } },
        },
      })
      if (!asset) {
        return { errorResponse: NextResponse.json({ error: 'Asset record not found', code: SHARE_ERROR_CODES.LINK_MISSING }, { status: 404 }) }
      }
      if (asset.uploadedBy !== 'client') {
        return denied(SHARE_ERROR_CODES.PERMISSION_DENIED, 'Access denied')
      }
      if (asset.video.projectId !== sharePayload.projectId) {
        return denied(SHARE_ERROR_CODES.SCOPE_DENIED, 'Asset does not belong to your project')
      }
      if (asset.uploadedBySessionId !== sharePayload.sessionId) {
        return denied(SHARE_ERROR_CODES.SCOPE_DENIED, 'Asset does not belong to your session')
      }
      if (requireUploadPermission) {
        const project = await prisma.project.findUnique({
          where: { id: sharePayload.projectId },
          select: { allowClientAssetUpload: true },
        })
        if (!project?.allowClientAssetUpload) {
          return denied(SHARE_ERROR_CODES.UPLOAD_NOT_ALLOWED, 'File attachments are not enabled for this project')
        }
      }
      return { isAdmin: false, s3Key: asset.storagePath }
    }
  }

  // ── Admin path: resolve S3 key from DB ─────────────────────────────────────
  if (videoId) {
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      select: { originalStoragePath: true },
    })
    if (!video) return { errorResponse: NextResponse.json({ error: 'Video record not found' }, { status: 404 }) }
    return { isAdmin: true, s3Key: video.originalStoragePath }
  }

  if (assetId) {
    const asset = await prisma.videoAsset.findUnique({
      where: { id: assetId },
      select: { storagePath: true },
    })
    if (!asset) return { errorResponse: NextResponse.json({ error: 'Asset record not found' }, { status: 404 }) }
    return { isAdmin: true, s3Key: asset.storagePath }
  }

  if (photoId) {
    const photo = await prisma.photo.findUnique({
      where: { id: photoId },
      select: { storagePath: true },
    })
    if (!photo) return { errorResponse: NextResponse.json({ error: 'Photo record not found' }, { status: 404 }) }
    return { isAdmin: true, s3Key: photo.storagePath }
  }

  const projectUpload = await prisma.projectUpload.findUnique({
    where: { id: projectUploadId! },
    select: { storagePath: true },
  })
  if (!projectUpload) return { errorResponse: NextResponse.json({ error: 'Upload record not found' }, { status: 404 }) }
  return { isAdmin: true, s3Key: projectUpload.storagePath }
}
