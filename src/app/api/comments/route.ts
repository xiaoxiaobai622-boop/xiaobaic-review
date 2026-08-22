import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getAuthContext } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { validateRequest, createCommentSchema, safeParseBody } from '@/lib/validation'
import { getPrimaryRecipient } from '@/lib/recipients'
import { verifyProjectAccess } from '@/lib/project-access'
import { sanitizeComment } from '@/lib/comment-sanitization'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import {
  checkWechatText,
  CONTENT_SECURITY_ERROR,
  CONTENT_VIOLATION_MESSAGE,
} from '@/lib/wechat-content-security'
import {

  validateCommentPermissions,
  sanitizeAndValidateContent,
  handleCommentNotifications,
  fetchProjectComments

} from '@/lib/comment-helpers'
export const runtime = 'nodejs'


export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const commentsMessages = messages?.comments || {}
  const shareMessages = messages?.share || {}

  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 60,
    message: shareMessages.tooManyRequestsGeneric || 'Too many requests. Please slow down.'
  }, 'comments-read')

  if (rateLimitResult) {
    return rateLimitResult
  }

  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId') ?? ''

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        sharePassword: true,
        authMode: true,
        companyName: true,
        hideFeedback: true,
        guestMode: true,
      }
    })

    if (!project) {
      return NextResponse.json(
        { error: shareMessages.accessDenied || 'Access denied' },
        { status: 403 }
      )
    }

    // SECURITY: If feedback is hidden, don't expose comments
    if (project.hideFeedback) {
      return NextResponse.json([])
    }

    // Verify project access using dual auth pattern
    const accessCheck = await verifyProjectAccess(request, project.id, project.sharePassword, project.authMode)

    if (!accessCheck.authorized) {
      return accessCheck.errorResponse!
    }

    const { isAdmin, isAuthenticated } = accessCheck
    const viewerUserId = (await getAuthContext(request)).user?.id

    const primaryRecipient = await getPrimaryRecipient(projectId)
    // Priority: companyName → primary recipient → 'Client'
    const fallbackName = project.companyName || primaryRecipient?.name || 'Client'

    const assetSelect = {
      select: {
        id: true,
        fileName: true,
        fileSize: true,
        fileType: true,
        category: true,
        createdAt: true,
      },
    }

    // Fetch all comments for the project
    const allComments = await prisma.comment.findMany({
      where: {
        projectId,
        parentId: null, // Only get top-level comments
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            username: true,
            email: true,
          }
        },
        assets: assetSelect,
        replies: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                username: true,
                email: true,
              }
            },
            assets: assetSelect,
          },
          orderBy: { createdAt: 'asc' }
        }
      },
      orderBy: { createdAt: 'asc' }
    })

    // Sanitize the response data
    const sanitizedComments = allComments.map((comment: any) =>
      sanitizeComment(
        comment,
        isAdmin,
        isAuthenticated,
        fallbackName,
        viewerUserId,
      )
    )

    return NextResponse.json(sanitizedComments)
  } catch (error) {
    return NextResponse.json({ error: commentsMessages.operationFailed || 'Operation failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const commentsMessages = messages?.comments || {}
  const shareMessages = messages?.share || {}

  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 10,
    message: commentsMessages.tooManyComments || 'Too many comments. Please slow down.'
  }, 'comments-create')

  if (rateLimitResult) {
    return rateLimitResult
  }

  try {
    const authContext = await getAuthContext(request)

    const parsed = await safeParseBody(request, { maxBytes: 5_000_000 })
    if (!parsed.success) return parsed.response
    const body = parsed.data

    // Older/stale share-page bundles may omit projectId for guest sessions.
    // Recover it only from the verified signed share token; normal validation
    // and the video/project ownership check below still enforce consistency.
    const bodyWithProjectId = body && typeof body === 'object' && !Array.isArray(body)
      ? {
          ...body,
          projectId: authContext.shareContext?.projectId || body.projectId,
        }
      : body

    const validation = validateRequest(createCommentSchema, bodyWithProjectId)
    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error, details: validation.details },
        { status: 400 }
      )
    }

    const {
      projectId,
      videoId,
      videoVersion,
      timecode,
      timecodeEnd,
      content,
      parentId,
      assetIds,
      annotations,
      category,
    } = validation.data

    if (!authContext.user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    const accountAuthorName = authContext.user.name?.trim()
      || authContext.user.phone
      || authContext.user.email

    // Enforce configurable max comment attachments
    if (assetIds && assetIds.length > 0) {
      const globalSettings = await prisma.settings.findUnique({
        where: { id: 'default' },
        select: { maxCommentAttachments: true },
      })
      const maxAttachments = globalSettings?.maxCommentAttachments ?? 10
      if (assetIds.length > maxAttachments) {
        return NextResponse.json(
          { error: (commentsMessages.tooManyAttachments || 'Too many attachments. Maximum allowed: {maxAttachments}').replace('{maxAttachments}', String(maxAttachments)) },
          { status: 400 }
        )
      }
    }

    const permissionCheck = await validateCommentPermissions({
      projectId,
      isInternal: true,
      currentUser: authContext.user
    })

    if (!permissionCheck.valid) {
      return NextResponse.json(
        { error: permissionCheck.error },
        { status: permissionCheck.errorStatus || 403 }
      )
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        sharePassword: true,
        authMode: true,
      }
    })

    if (!project) {
      return NextResponse.json(
        { error: shareMessages.accessDenied || 'Access denied' },
        { status: 403 }
      )
    }

    // Verify project access
    const accessCheck = await verifyProjectAccess(request, project.id, project.sharePassword, project.authMode, {
      allowGuest: false,
      requiredPermission: 'comment',
    })

    if (!accessCheck.authorized) {
      return accessCheck.errorResponse || NextResponse.json(
        { error: shareMessages.unableToProcessRequest || 'Unable to process request' },
        { status: 400 }
      )
    }

    const uploaderSessionId = authContext.shareContext?.sessionId || accessCheck.shareTokenSessionId
    if (!uploaderSessionId) {
      return NextResponse.json(
        { error: shareMessages.unableToProcessRequest || 'Unable to process request' },
        { status: 400 }
      )
    }

    const { isAdmin, isAuthenticated } = accessCheck

    const finalAuthorEmail = authContext.user.email
    const fallbackName = accountAuthorName

    const contentValidation = await sanitizeAndValidateContent({
      content,
      authorName: accountAuthorName
    })

    if (!contentValidation.valid) {
      return NextResponse.json(
        { error: contentValidation.error },
        { status: contentValidation.errorStatus || 400 }
      )
    }

    const securityCheck = await checkWechatText(contentValidation.sanitizedContent, {
      userId: authContext.user.id,
      scene: 2,
    })
    if (!securityCheck.passed) {
      return NextResponse.json(
        { error: securityCheck.error },
        { status: securityCheck.error === CONTENT_VIOLATION_MESSAGE ? 400 : 503 },
      )
    }

    const video = await prisma.video.findUnique({
      where: { id: videoId },
      select: { id: true, projectId: true, version: true }
    })

    if (!video || video.projectId !== projectId) {
      return NextResponse.json(
        { error: commentsMessages.videoDoesNotBelongToProject || 'Video does not belong to this project' },
        { status: 400 }
      )
    }

    // If version is omitted, infer from current video record
    const finalVideoVersion = videoVersion || video.version

    // Create comment
    const comment = await prisma.comment.create({
      data: {
        projectId,
        videoId,
        videoVersion: finalVideoVersion || null,
        timecode,
        timecodeEnd: timecodeEnd || null,
        content: contentValidation.sanitizedContent!,
        authorName: contentValidation.sanitizedAuthorName,
        authorEmail: finalAuthorEmail,
        category: category || null,
        isInternal: true,
        parentId: parentId || null,
        userId: authContext.user?.id || null,
        annotations: annotations || undefined,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            username: true,
            email: true,
          }
        },
        replies: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                username: true,
                email: true,
              }
            }
          },
          orderBy: { createdAt: 'asc' }
        }
      }
    })

    // Link client assets to comment
    if (assetIds && assetIds.length > 0) {
      const assets = await prisma.videoAsset.findMany({
        where: {
          id: { in: assetIds },
          videoId,
          uploadedBy: 'client',
          uploadedBySessionId: uploaderSessionId,
          commentId: null,
        },
      })

      if (assets.length !== assetIds.length) {
        return NextResponse.json(
          { error: commentsMessages.invalidAttachments || 'One or more attachments are invalid or no longer available. Please attach the file again.' },
          { status: 400 }
        )
      }

      await prisma.videoAsset.updateMany({
        where: { id: { in: assets.map(a => a.id) } },
        data: { commentId: comment.id },
      })
    }

    // Collect attachment file names for notifications
    let attachmentNames: string[] | undefined
    if (assetIds && assetIds.length > 0) {
      const linkedAssets = await prisma.videoAsset.findMany({
        where: { commentId: comment.id },
        select: { fileName: true },
      })
      attachmentNames = linkedAssets.map(a => a.fileName)
    }

    await handleCommentNotifications({
      comment,
      projectId,
      videoId,
      parentId,
      attachmentNames,
    })

    const allComments = await fetchProjectComments(projectId)

    const sanitizedComments = allComments.map((comment: any) =>
      sanitizeComment(comment, isAdmin, isAuthenticated, fallbackName, authContext.user?.id)
    )

    return NextResponse.json(sanitizedComments)
  } catch (error) {
    return NextResponse.json({ error: commentsMessages.operationFailed || 'Operation failed' }, { status: 500 })
  }
}
