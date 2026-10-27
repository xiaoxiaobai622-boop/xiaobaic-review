import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getShareAuth } from '@/lib/auth'
import { verifyProjectAccess } from '@/lib/project-access'
import { logError } from '@/lib/logging'
import { generateVideoAccessToken } from '@/lib/video-access'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import { resolveShareMetadata, isShareLinkActive, isVideoInShareScope } from '@/lib/share-links'
import { SHARE_ERROR_CODES } from '@/lib/share-error-codes'
import { logShareDenial, requestEndpoint } from '@/lib/share-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const shareMessages = messages?.share
  const url = new URL(request.url)
  const videoId = url.searchParams.get('videoId')
  const quality = url.searchParams.get('quality') || '720p'

  if (!videoId) {
    return NextResponse.json({ error: shareMessages?.videoIdRequired || 'videoId is required' }, { status: 400 })
  }

  const shareAuth = await getShareAuth(request)
  if (shareAuth.failure) {
    return NextResponse.json({ error: shareAuth.failure.message, code: shareAuth.failure.code }, { status: 401 })
  }
  const shareContext = shareAuth.payload
  if (!shareContext) {
    return NextResponse.json(
      { error: shareMessages?.unauthorized || 'Unauthorized', code: SHARE_ERROR_CODES.AUTH_REQUIRED },
      { status: 401 },
    )
  }

  const resolved = await resolveShareMetadata(token)
  if (resolved.policy && !isShareLinkActive(resolved.policy)) {
    return NextResponse.json({ error: 'Share link is no longer active', code: SHARE_ERROR_CODES.LINK_INACTIVE }, { status: 410 })
  }
  const project = resolved.project ? {
    id: resolved.project.id,
    slug: resolved.project.slug,
    sharePassword: resolved.policy?.sharePassword ?? resolved.project.sharePassword,
    authMode: resolved.policy?.authMode ?? resolved.project.authMode,
  } : null

  if (!project || shareContext.projectId !== project.id || shareContext.shareId !== token) {
    logShareDenial({ shareToken: shareContext.shareId, endpoint: requestEndpoint(request), reason: SHARE_ERROR_CODES.SCOPE_DENIED })
    return NextResponse.json({ error: shareMessages?.accessDenied || 'Access denied', code: SHARE_ERROR_CODES.SCOPE_DENIED }, { status: 403 })
  }

  const accessCheck = await verifyProjectAccess(request, project.id, project.sharePassword, project.authMode, {
    requiredPermission: quality === 'original' ? 'download' : 'view',
  })
  if (!accessCheck.authorized) return accessCheck.errorResponse || NextResponse.json({ error: shareMessages?.accessDenied || 'Access denied' }, { status: 403 })

  const video = await prisma.video.findUnique({
    where: { id: videoId, status: { not: 'ROLLED_BACK' } },
    select: {
      id: true,
      projectId: true,
      approved: true,
      thumbnailPath: true,
      name: true,
      folderId: true,
    },
  })

  if (!video || video.projectId !== project.id) {
    return NextResponse.json({ error: shareMessages?.videoNotFound || 'Video not found' }, { status: 404 })
  }

  if (!(await isVideoInShareScope(resolved.policy, project.id, video))) {
    return NextResponse.json({ error: shareMessages?.accessDenied || 'Access denied' }, { status: 403 })
  }

  if (quality === 'original' && !video.approved) {
    logShareDenial({ shareToken: shareContext.shareId, endpoint: requestEndpoint(request), reason: SHARE_ERROR_CODES.PERMISSION_DENIED })
    return NextResponse.json({ error: shareMessages?.originalQualityUnavailable || 'Original quality unavailable', code: SHARE_ERROR_CODES.PERMISSION_DENIED }, { status: 403 })
  }

  const sessionId = shareContext.sessionId || `share:${project.id}:${token}`

  try {
    const tokenValue = await generateVideoAccessToken(
      video.id,
      project.id,
      quality,
      request,
      sessionId,
      { shareId: token }
    )

    return NextResponse.json({ token: tokenValue })
  } catch (error) {
    logError(`[SHARE] Failed to generate video token (videoId=${videoId}, quality=${quality})`, error)
    return NextResponse.json({ error: shareMessages?.failedToGenerateToken || 'Failed to generate token' }, { status: 500 })
  }
}
