import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { verifyProjectAccess } from '@/lib/project-access'
import { enforceShareVideoScope } from '@/lib/share-scope'
import { validateAssetFile, sanitizeFilename, sanitizeDisplayFilename, isSuspiciousFilename } from '@/lib/file-validation'
import { detectAssetCategory } from '@/lib/asset-validation'
import { initStorage, deleteFile } from '@/lib/storage'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import { logError } from '@/lib/logging'
import { checkTeamStorageQuota } from '@/lib/platform-access'
import { teamProjectStorageKey } from '@/lib/storage-keys'
import { isCommentAttachmentTooLarge, MAX_COMMENT_ATTACHMENT_LABEL } from '@/lib/comment-attachment-limits'
import { SHARE_ERROR_CODES } from '@/lib/share-error-codes'
import { getShareAuth } from '@/lib/auth'

export const runtime = 'nodejs'

/**
 * A share page can be opened by a signed-in team member or client. The upload
 * itself is authorized by the presented share token, so the asset must be
 * owned by that share session too; otherwise a member's admin session and the
 * upload's share session disagree and the upload is rejected.
 */
async function resolveUploaderSessionId(
  request: NextRequest,
  projectId: string,
  accessCheck: { shareTokenSessionId?: string },
): Promise<string | undefined> {
  const shareAuth = await getShareAuth(request).catch(() => null)
  if (shareAuth?.payload?.projectId === projectId && shareAuth.payload.sessionId) {
    return shareAuth.payload.sessionId
  }
  return accessCheck.shareTokenSessionId
}

// POST /api/videos/[id]/client-assets - Create a client asset record (JSON)
// The actual file upload goes through TUS at /api/uploads
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const videosMessages = messages?.videos || {}

  const { id: videoId } = await params

  const rateLimitResult = await rateLimit(
    request,
    {
      windowMs: 60 * 1000,
      maxRequests: 60,
      message: videosMessages.tooManyRequestsSlowDown || 'Too many requests. Please slow down.',
    },
    'client-asset-create'
  )
  if (rateLimitResult) return rateLimitResult

  try {
    // Verify video exists and get project
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      include: { project: true },
    })

    if (!video) {
      return NextResponse.json({ error: videosMessages.videoNotFound || 'Video not found' }, { status: 404 })
    }

    const project = video.project

    // The share link's own `attach` permission is the control; there is no
    // project-level switch any more.
    const accessCheck = await verifyProjectAccess(
      request,
      project.id,
      project.sharePassword,
      project.authMode,
      {
        requiredPermission: 'attach',
        allowGuest: false,
      }
    )

    if (!accessCheck.authorized) {
      return accessCheck.errorResponse || NextResponse.json(
        { error: videosMessages.unauthorized || 'Unauthorized', code: SHARE_ERROR_CODES.AUTH_REQUIRED },
        { status: 401 }
      )
    }

    const scopeDenied = await enforceShareVideoScope(request, project.id, videoId, accessCheck.isAdmin)
    if (scopeDenied) return scopeDenied

    const uploaderSessionId = await resolveUploaderSessionId(request, project.id, accessCheck)
    if (!uploaderSessionId) {
      return NextResponse.json({ error: videosMessages.unauthorized || 'Unauthorized', code: SHARE_ERROR_CODES.LOGIN_REQUIRED }, { status: 401 })
    }

    // Parse JSON body
    const body = await request.json()
    const { fileName, fileSize, category: requestedCategory, authorName, authorEmail } = body

    if (!fileName || typeof fileName !== 'string') {
      return NextResponse.json({ error: videosMessages.fileNameRequired || 'fileName is required' }, { status: 400 })
    }

    if (!fileSize || typeof fileSize !== 'number' || fileSize <= 0) {
      return NextResponse.json({ error: videosMessages.validFileSizeRequired || 'Valid fileSize is required' }, { status: 400 })
    }

    if (isCommentAttachmentTooLarge(fileSize)) {
      return NextResponse.json(
        { error: (videosMessages.commentAttachmentTooLarge || 'Comment attachments can be at most {size} each').replace('{size}', MAX_COMMENT_ATTACHMENT_LABEL) },
        { status: 400 }
      )
    }

    const storageCheck = await checkTeamStorageQuota(project.teamId, BigInt(fileSize))
    if (!storageCheck.allowed) {
      return NextResponse.json({ error: '当前团队存储空间不足，请联系团队所有者处理' }, { status: 413 })
    }

    // Enforce global maxUploadSizeGB limit
    const settings = await prisma.settings.findUnique({
      where: { id: 'default' },
      select: { maxUploadSizeGB: true },
    })
    const maxBytes = (settings?.maxUploadSizeGB || 1) * 1024 * 1024 * 1024
    if (fileSize > maxBytes) {
      return NextResponse.json(
        { error: (videosMessages.fileExceedsMaximumUploadSizeGb || 'File exceeds maximum upload size of {size} GB').replace('{size}', String(settings?.maxUploadSizeGB || 1)) },
        { status: 400 }
      )
    }

    // Check for suspicious filename
    if (isSuspiciousFilename(fileName)) {
      return NextResponse.json(
        { error: videosMessages.fileTypeNotAllowed || 'File type not allowed' },
        { status: 400 }
      )
    }

    // Sanitize filename
    const sanitizedFileName = sanitizeFilename(fileName)

    // Comment attachments are references, not deliverables: a video belongs in
    // the project's version list, where it gets a player and review status.
    if (requestedCategory === 'video' || detectAssetCategory(fileName) === 'video') {
      return NextResponse.json(
        { error: videosMessages.commentAttachmentVideoNotAllowed || 'Video files cannot be added as comment attachments' },
        { status: 400 }
      )
    }

    // Validate asset file (use a generic mime type since we don't have the file yet)
    const mimeType = 'application/octet-stream'
    const assetValidation = validateAssetFile(sanitizedFileName, mimeType, requestedCategory)

    if (!assetValidation.valid) {
      return NextResponse.json(
        { error: assetValidation.error || videosMessages.invalidFileType || 'Invalid file type' },
        { status: 400 }
      )
    }

    // Generate storage path
    const timestamp = Date.now()
    const finalFileName = assetValidation.sanitizedFilename || sanitizedFileName
    const storagePath = teamProjectStorageKey(project.teamId, project.id, 'videos', 'assets', videoId, `client-${timestamp}-${finalFileName}`)
    const category = assetValidation.detectedCategory || 'other'

    // Create database record (file will be uploaded via TUS)
    const asset = await prisma.videoAsset.create({
      data: {
        videoId,
        fileName: finalFileName,
        originalFileName: sanitizeDisplayFilename(fileName),
        fileSize: BigInt(fileSize),
        fileType: mimeType,
        storagePath,
        category,
        uploadedBy: 'client',
        uploadedByName: authorName || authorEmail || null,
        uploadedBySessionId: uploaderSessionId,
      },
    })

    return NextResponse.json({
      assetId: asset.id,
      // This echo is only ever shown back to the uploader, so it carries their own name.
      fileName: asset.originalFileName || finalFileName,
      fileSize: fileSize.toString(),
      fileType: mimeType,
      category,
    })
  } catch (error) {
    logError('Error creating client asset record:', error)
    return NextResponse.json(
      { error: videosMessages.failedToCreateAssetRecord || 'Failed to create asset record' },
      { status: 500 }
    )
  }
}

// GET /api/videos/[id]/client-assets - List client assets for a video
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const videosMessages = messages?.videos || {}

  const { id: videoId } = await params

  // Rate limiting
  const rateLimitResult = await rateLimit(
    request,
    {
      windowMs: 60 * 1000,
      maxRequests: 60,
      message: videosMessages.tooManyRequestsSlowDown || 'Too many requests. Please slow down.',
    },
    'client-asset-list'
  )
  if (rateLimitResult) return rateLimitResult

  try {
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      include: { project: true },
    })

    if (!video) {
      return NextResponse.json({ error: videosMessages.videoNotFound || 'Video not found' }, { status: 404 })
    }

    const project = video.project

    // Auth via verifyProjectAccess
    const accessCheck = await verifyProjectAccess(
      request,
      project.id,
      project.sharePassword,
      project.authMode,
    )

    if (!accessCheck.authorized) {
      return accessCheck.errorResponse || NextResponse.json(
        { error: videosMessages.unauthorized || 'Unauthorized', code: SHARE_ERROR_CODES.AUTH_REQUIRED },
        { status: 401 }
      )
    }

    const scopeDenied = await enforceShareVideoScope(request, project.id, videoId, accessCheck.isAdmin)
    if (scopeDenied) return scopeDenied

    const uploaderSessionId = await resolveUploaderSessionId(request, project.id, accessCheck)
    if (!uploaderSessionId) {
      return NextResponse.json({ error: videosMessages.unauthorized || 'Unauthorized', code: SHARE_ERROR_CODES.LOGIN_REQUIRED }, { status: 401 })
    }

    const assets = await prisma.videoAsset.findMany({
      where: {
        videoId,
        uploadCompletedAt: { not: null },
        uploadedBy: 'client',
        ...(accessCheck.isAdmin ? {} : { uploadedBySessionId: uploaderSessionId }),
      },
      orderBy: { createdAt: 'desc' },
    })

    const serializedAssets = assets.map(asset => ({
      id: asset.id,
      videoId: asset.videoId,
      fileName: asset.fileName,
      originalFileName: asset.originalFileName,
      fileSize: asset.fileSize.toString(),
      fileType: asset.fileType,
      category: asset.category,
      commentId: asset.commentId,
      createdAt: asset.createdAt,
    }))

    return NextResponse.json({ assets: serializedAssets })
  } catch (error) {
    logError('Error fetching client assets:', error)
    return NextResponse.json(
      { error: videosMessages.failedToFetchClientAssets || 'Failed to fetch client assets' },
      { status: 500 }
    )
  }
}

// DELETE /api/videos/[id]/client-assets?assetId=xxx - Delete an unlinked pending client asset
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const videosMessages = messages?.videos || {}

  const { id: videoId } = await params

  const rateLimitResult = await rateLimit(
    request,
    {
      windowMs: 60 * 1000,
      maxRequests: 30,
      message: videosMessages.tooManyRequestsSlowDown || 'Too many requests. Please slow down.',
    },
    'client-asset-delete'
  )
  if (rateLimitResult) return rateLimitResult

  try {
    const { searchParams } = new URL(request.url)
    const assetId = searchParams.get('assetId') ?? ''

    const video = await prisma.video.findUnique({
      where: { id: videoId },
      include: { project: true },
    })

    if (!video) {
      return NextResponse.json({ error: videosMessages.videoNotFound || 'Video not found' }, { status: 404 })
    }

    const project = video.project

    const accessCheck = await verifyProjectAccess(
      request,
      project.id,
      project.sharePassword,
      project.authMode,
      {
        requiredPermission: 'attach',
        allowGuest: false,
      }
    )

    if (!accessCheck.authorized) {
      return accessCheck.errorResponse || NextResponse.json(
        { error: videosMessages.unauthorized || 'Unauthorized', code: SHARE_ERROR_CODES.AUTH_REQUIRED },
        { status: 401 }
      )
    }

    const scopeDenied = await enforceShareVideoScope(request, project.id, videoId, accessCheck.isAdmin)
    if (scopeDenied) return scopeDenied

    const uploaderSessionId = await resolveUploaderSessionId(request, project.id, accessCheck)
    if (!uploaderSessionId) {
      return NextResponse.json({ error: videosMessages.unauthorized || 'Unauthorized', code: SHARE_ERROR_CODES.LOGIN_REQUIRED }, { status: 401 })
    }

    const asset = await prisma.videoAsset.findFirst({
      where: {
        id: assetId,
        videoId,
        uploadedBy: 'client',
        uploadedBySessionId: uploaderSessionId,
        commentId: null,
      },
      select: {
        id: true,
        storagePath: true,
      },
    })

    if (!asset) {
      return NextResponse.json({ error: videosMessages.attachmentNotFound || 'Attachment not found' }, { status: 404 })
    }
    await initStorage()

    await deleteFile(asset.storagePath)

    await prisma.videoAsset.delete({ where: { id: asset.id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    logError('Error deleting client asset:', error)
    return NextResponse.json(
      { error: videosMessages.failedToDeleteAttachment || 'Failed to delete attachment' },
      { status: 500 }
    )
  }
}
