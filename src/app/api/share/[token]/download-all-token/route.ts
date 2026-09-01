import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyProjectAccess } from '@/lib/project-access'
import { rateLimit } from '@/lib/rate-limit'
import { generateVideoAccessToken } from '@/lib/video-access'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import { logError } from '@/lib/logging'
import { resolveShareMetadata, getShareScopeVideoIds, isShareLinkActive } from '@/lib/share-links'

export const runtime = 'nodejs'

/**
 * Generate per-video download URLs for all approved videos.
 * Used by share page "Download All" button (batch individual downloads, no ZIP).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const shareMessages = messages?.share || {}

  const { token: slug } = await params

  // Rate limit
  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 5,
    message: shareMessages.tooManyRequestsGeneric || 'Too many download requests. Please slow down.',
  }, `download-all-token:${slug}`)
  if (rateLimitResult) return rateLimitResult

  try {
    const resolved = await resolveShareMetadata(slug)
    if (resolved.link && !isShareLinkActive(resolved.link)) {
      return NextResponse.json({ error: shareMessages.accessDenied || 'Access denied' }, { status: 410 })
    }
    const project = resolved.project ? {
      id: resolved.project.id,
      sharePassword: resolved.link?.sharePassword || resolved.project.sharePassword,
      authMode: resolved.link?.authMode || resolved.project.authMode,
      allowAssetDownload: resolved.link ? resolved.link.permissions.includes('download') : resolved.project.allowAssetDownload,
      title: resolved.project.title,
    } : null

    if (!project) {
      return NextResponse.json({ error: shareMessages.projectNotFound || 'Project not found' }, { status: 404 })
    }

    // Verify access (must have download permission, no guests)
    const accessCheck = await verifyProjectAccess(
      request,
      project.id,
      project.sharePassword,
      project.authMode,
      {
        allowGuest: false,
        requiredPermission: 'download',
      }
    )

    if (!accessCheck.authorized) {
      return NextResponse.json({ error: shareMessages.accessDenied || 'Access denied' }, { status: 403 })
    }

    // Non-admins need allowAssetDownload enabled
    if (!accessCheck.isAdmin && !project.allowAssetDownload) {
      return NextResponse.json(
        { error: shareMessages.downloadsDisabled || 'Downloads are disabled for this project' },
        { status: 403 }
      )
    }

    // Find all approved videos with latest version per name
    const approvedVideos = await prisma.video.findMany({
      where: {
        projectId: project.id,
        approved: true,
        status: { in: ['READY', 'PROCESSING'] },
      },
      select: {
        id: true,
        name: true,
        versionLabel: true,
        originalFileName: true,
        originalStoragePath: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    const scopedIds = resolved.link ? await getShareScopeVideoIds(resolved.link, project.id) : null
    const scopedApprovedVideos = scopedIds
      ? approvedVideos.filter(video => scopedIds.has(video.id))
      : approvedVideos

    if (scopedApprovedVideos.length === 0) {
      return NextResponse.json(
        { error: shareMessages.noApprovedVideos || 'No approved videos available for download' },
        { status: 404 }
      )
    }

    // Stable admin session id so repeated downloads reuse the cached token
    const sessionId = accessCheck.shareTokenSessionId || (accessCheck.isAdmin ? `admin:${project.id}` : `guest:${Date.now()}`)

    const urls = await Promise.all(
      scopedApprovedVideos.map(async (video) => {
        const accessToken = await generateVideoAccessToken(
          video.id,
          project.id,
          'original',
          request,
          sessionId
        )
        return `/api/content/${accessToken}?download=true`
      })
    )

    return NextResponse.json({
      urls,
      videoCount: scopedApprovedVideos.length,
    })
  } catch (error) {
    logError('Bulk download token generation error:', error)
    return NextResponse.json(
      { error: shareMessages.downloadFailed || 'Failed to generate download link' },
      { status: 500 }
    )
  }
}
