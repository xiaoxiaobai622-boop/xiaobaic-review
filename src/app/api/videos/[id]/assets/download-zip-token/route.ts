import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyProjectAccess } from '@/lib/project-access'
import { rateLimit } from '@/lib/rate-limit'
import { getRedis } from '@/lib/redis'
import { getClientIpAddress } from '@/lib/utils'
import crypto from 'crypto'
import { z } from 'zod'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'

const downloadZipTokenSchema = z.object({
  assetIds: z.array(z.string().min(1)).min(1, 'No assets selected').max(50, 'Too many assets requested'),
  includeVideo: z.boolean().optional(),
})

/**
 * Generate a temporary download token for ZIP downloads
 * This allows using window.open() for non-blocking downloads
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const videoMessages = messages?.videos || {}

  const { id: videoId } = await params

  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 10,
    message: videoMessages.tooManyAssetZipTokenRequests || 'Too many asset download requests. Please slow down.',
  }, `asset-zip-token:${videoId}`)
  if (rateLimitResult) return rateLimitResult

  try {
    const body = await request.json()
    const parsed = downloadZipTokenSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 })
    }
    const { assetIds, includeVideo } = parsed.data

    const video = await prisma.video.findUnique({
      where: { id: videoId },
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
    })

    if (!video) {
      return NextResponse.json({ error: videoMessages.videoNotFoundApi || 'Video not found' }, { status: 404 })
    }

    const project = video.project

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
      return NextResponse.json({ error: videoMessages.unauthorizedApi || 'Unauthorized' }, { status: 403 })
    }

    if (!accessCheck.isAdmin) {
      if (!project.allowAssetDownload) {
        return NextResponse.json(
          { error: videoMessages.assetDownloadsNotAllowedProject || 'Asset downloads are not allowed for this project' },
          { status: 403 }
        )
      }

      if (!video.approved) {
        return NextResponse.json(
          { error: videoMessages.assetsApprovedOnly || 'Assets are only available for approved videos' },
          { status: 403 }
        )
      }
    }

    // Every requested asset must belong to this video and be fully uploaded.
    const assets = await prisma.videoAsset.findMany({
      where: {
        id: { in: assetIds },
        videoId,
        uploadCompletedAt: { not: null },
      },
      select: { id: true },
    })

    if (assets.length === 0) {
      return NextResponse.json({ error: messages?.share?.noValidAssetsFound || 'No valid assets found' }, { status: 404 })
    }

    if (assets.length !== assetIds.length) {
      return NextResponse.json({ error: videoMessages.someAssetsInvalid || 'Some assets are invalid' }, { status: 400 })
    }

    const token = crypto.randomBytes(32).toString('base64url')

    const redis = getRedis()
    // Stable admin session id so repeated downloads reuse the cached token
    const sessionId = accessCheck.shareTokenSessionId || (accessCheck.isAdmin ? `admin:${project.id}` : `guest:${Date.now()}`)
    const ipAddress = getClientIpAddress(request)
    const userAgentHash = crypto
      .createHash('sha256')
      .update(request.headers.get('user-agent') || 'unknown')
      .digest('hex')

    const tokenData = {
      videoId,
      projectId: project.id,
      assetIds,
      includeVideo: includeVideo || false,
      sessionId,
      ipAddress,
      userAgentHash,
      createdAt: Date.now(),
      isAdmin: accessCheck.isAdmin || false,
    }

    await redis.setex(
      `zip_download:${token}`,
      15 * 60, // 15 minutes
      JSON.stringify(tokenData)
    )

    return NextResponse.json({
      url: `/api/content/zip/${token}`,
    })
  } catch (error) {
    logError('ZIP download token generation error:', error)
    return NextResponse.json(
      { error: videoMessages.failedToGenerateDownloadLink || 'Failed to generate download link' },
      { status: 500 }
    )
  }
}
