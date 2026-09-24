import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiAdmin } from '@/lib/auth'
import { canAccessProject } from '@/lib/project-access'
import { rateLimit } from '@/lib/rate-limit'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import { logError } from '@/lib/logging'
import { teamProjectStorageKey } from '@/lib/storage-keys'

export const runtime = 'nodejs'

const THUMBNAIL_FILE_TYPES = ['image/jpeg', 'image/png', 'image/jpg']

// POST /api/videos/[id]/assets/[assetId]/set-thumbnail - Set asset as video thumbnail
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; assetId: string }> }
) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const videoMessages = messages?.videos || {}

  const authResult = await requireApiAdmin(request)
  if (authResult instanceof Response) {
    return authResult
  }

  const rateLimitResult = await rateLimit(
    request,
    {
      windowMs: 60 * 1000,
      maxRequests: 30,
      message: videoMessages.tooManyThumbnailUpdateRequests || 'Too many thumbnail update requests. Please slow down.',
    },
    'set-asset-thumbnail'
  )
  if (rateLimitResult) return rateLimitResult

  const { id: videoId, assetId } = await params

  try {
    const body = await request.json()
    const action = body.action || 'set'

    const video = await prisma.video.findUnique({
      where: { id: videoId },
      select: { projectId: true },
    })

    if (!video) {
      return NextResponse.json({ error: videoMessages.videoNotFoundApi || 'Video not found' }, { status: 404 })
    }
    if (!(await canAccessProject(prisma, authResult, video.projectId))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    if (action === 'remove') {
      const project = await prisma.project.findUnique({ where: { id: video.projectId }, select: { teamId: true } })
      if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
      const systemThumbnailPath = teamProjectStorageKey(project.teamId, video.projectId, 'videos', videoId, 'thumbnail.jpg')

      await prisma.video.update({
        where: { id: videoId },
        data: {
          thumbnailPath: systemThumbnailPath,
        },
      })

      return NextResponse.json({
        success: true,
        message: videoMessages.thumbnailReverted || 'Reverted to system-generated thumbnail',
      })
    }

    const asset = await prisma.videoAsset.findUnique({
      where: { id: assetId },
      select: { videoId: true, fileType: true, storagePath: true },
    })

    if (!asset || asset.videoId !== videoId) {
      return NextResponse.json(
        { error: videoMessages.assetNotFoundForVideo || 'Asset not found or does not belong to this video' },
        { status: 404 }
      )
    }

    // fileType is only populated once the TUS upload completes.
    if (!THUMBNAIL_FILE_TYPES.includes(asset.fileType.toLowerCase())) {
      return NextResponse.json(
        { error: videoMessages.invalidThumbnailFileType || 'Only JPG and PNG images can be set as thumbnails' },
        { status: 400 }
      )
    }

    await prisma.video.update({
      where: { id: videoId },
      data: {
        thumbnailPath: asset.storagePath,
      },
    })

    return NextResponse.json({
      success: true,
      message: videoMessages.thumbnailUpdated || 'Thumbnail updated successfully',
    })
  } catch (error) {
    logError('Error setting asset as thumbnail:', error)
    return NextResponse.json(
      { error: videoMessages.failedToSetThumbnailApi || 'Failed to set thumbnail' },
      { status: 500 }
    )
  }
}
