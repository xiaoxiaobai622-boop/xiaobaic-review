import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyProjectAccess } from '@/lib/project-access'
import { generateVideoAccessToken } from '@/lib/video-access'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import { logError } from '@/lib/logging'

/**
 * Generate a temporary download token for asset downloads (admins and share users)
 * This allows using window.open() without loading files into browser memory
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; assetId: string }> }
) {
  try {
    const locale = await getConfiguredLocale().catch(() => 'en')
    const messages = await loadLocaleMessages(locale).catch(() => null)
    const videoMessages = messages?.videos || {}

    const { id: videoId, assetId } = await params

    const asset = await prisma.videoAsset.findUnique({
      where: { id: assetId },
      select: {
        videoId: true,
        uploadedBy: true,
        video: {
          select: {
            approved: true,
            project: {
              select: {
                id: true,
                sharePassword: true,
                authMode: true,
                allowAssetDownload: true,
              },
            },
          },
        },
      },
    })

    if (!asset || asset.videoId !== videoId) {
      return NextResponse.json({ error: messages?.share?.assetNotFound || 'Asset not found' }, { status: 404 })
    }

    const project = asset.video.project
    const isClientAsset = asset.uploadedBy === 'client'

    // Client-uploaded comment attachments only need view-level access ('comment');
    // admin/regular assets need 'download'. Guests are never allowed here.
    const accessCheck = await verifyProjectAccess(
      request,
      project.id,
      project.sharePassword,
      project.authMode,
      {
        allowGuest: false,
        requiredPermission: isClientAsset ? 'comment' : 'download',
      }
    )

    if (!accessCheck.authorized) {
      return NextResponse.json({ error: videoMessages.unauthorizedApi || 'Unauthorized' }, { status: 403 })
    }

    // Client-uploaded comment attachments bypass the project download setting and the approval gate.
    if (!accessCheck.isAdmin && !isClientAsset) {
      if (!project.allowAssetDownload) {
        return NextResponse.json(
          { error: videoMessages.assetDownloadsNotAllowedProject || 'Asset downloads are not allowed for this project' },
          { status: 403 }
        )
      }

      if (!asset.video.approved) {
        return NextResponse.json(
          { error: videoMessages.assetsApprovedOnly || 'Assets are only available for approved videos' },
          { status: 403 }
        )
      }
    }

    // Video access tokens also gate asset downloads. A stable admin session id lets
    // repeated downloads reuse the cached token instead of minting one per click.
    const sessionId = accessCheck.shareTokenSessionId || (accessCheck.isAdmin ? `admin:${project.id}` : `guest:${Date.now()}`)
    const token = await generateVideoAccessToken(videoId, project.id, 'original', request, sessionId)

    return NextResponse.json({
      url: `/api/content/${token}?download=true&assetId=${assetId}`,
    })
  } catch (error) {
    logError('Asset download token generation error:', error)
    const locale = await getConfiguredLocale().catch(() => 'en')
    const messages = await loadLocaleMessages(locale).catch(() => null)
    const videoMessages = messages?.videos || {}
    return NextResponse.json(
      { error: videoMessages.failedToGenerateDownloadLink || 'Failed to generate download link' },
      { status: 500 }
    )
  }
}
