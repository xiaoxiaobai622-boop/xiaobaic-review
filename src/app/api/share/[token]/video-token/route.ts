import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getShareContext } from '@/lib/auth'
import { verifyProjectAccess } from '@/lib/project-access'
import { logError } from '@/lib/logging'
import { generateVideoAccessToken } from '@/lib/video-access'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import { resolveShare, isShareLinkActive, scopeVideoIds } from '@/lib/share-links'

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

  const shareContext = await getShareContext(request)
  if (!shareContext) {
    return NextResponse.json({ error: shareMessages?.unauthorized || 'Unauthorized' }, { status: 401 })
  }

  const resolved = await resolveShare(token)
  if (resolved.link && !isShareLinkActive(resolved.link)) return NextResponse.json({ error: 'Share link is no longer active' }, { status: 410 })
  const project = resolved.project ? {
    id: resolved.project.id,
    slug: resolved.project.slug,
    sharePassword: resolved.link?.sharePassword || resolved.project.sharePassword,
    authMode: resolved.link?.authMode || resolved.project.authMode,
  } : null

  if (!project || shareContext.projectId !== project.id || shareContext.shareId !== token) {
    return NextResponse.json({ error: shareMessages?.accessDenied || 'Access denied' }, { status: 403 })
  }

  const accessCheck = await verifyProjectAccess(request, project.id, project.sharePassword, project.authMode, {
    requiredPermission: quality === 'original' ? 'download' : 'view',
  })
  if (!accessCheck.authorized) return accessCheck.errorResponse || NextResponse.json({ error: shareMessages?.accessDenied || 'Access denied' }, { status: 403 })

  const video = await prisma.video.findUnique({
    where: { id: videoId },
    select: {
      id: true,
      projectId: true,
      approved: true,
      thumbnailPath: true,
    },
  })

  if (!video || video.projectId !== project.id) {
    return NextResponse.json({ error: shareMessages?.videoNotFound || 'Video not found' }, { status: 404 })
  }

  const scopedIds = resolved.link && resolved.project ? scopeVideoIds(resolved.link, resolved.project.videos) : null
  if (scopedIds && !scopedIds.has(video.id)) return NextResponse.json({ error: shareMessages?.accessDenied || 'Access denied' }, { status: 403 })

  if (quality === 'original' && !video.approved) {
    return NextResponse.json({ error: shareMessages?.originalQualityUnavailable || 'Original quality unavailable' }, { status: 403 })
  }

  const sessionId = shareContext.sessionId || `share:${project.id}:${token}`

  try {
    const tokenValue = await generateVideoAccessToken(
      video.id,
      project.id,
      quality,
      request,
      sessionId
    )

    return NextResponse.json({ token: tokenValue })
  } catch (error) {
    logError(`[SHARE] Failed to generate video token (videoId=${videoId}, quality=${quality})`, error)
    return NextResponse.json({ error: shareMessages?.failedToGenerateToken || 'Failed to generate token' }, { status: 500 })
  }
}
