import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { videoNameSlotTaken } from '@/lib/video-versions'
import { requireApiAdmin } from '@/lib/auth'
import { canAccessProject } from '@/lib/project-access'
import { rateLimit } from '@/lib/rate-limit'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'




export async function PATCH(request: NextRequest) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const videoMessages = messages?.videos || {}

  const authResult = await requireApiAdmin(request)
  if (authResult instanceof Response) {
    return authResult
  }

  // Rate limiting: 60 requests per minute for batch operations
  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 60,
    message: videoMessages.tooManyBatchOperations || 'Too many batch operations. Please slow down.'
  }, 'admin-batch-ops')

  if (rateLimitResult) {
    return rateLimitResult
  }

  try {
    const body = await request.json()
    const { videoIds, name } = body

    if (!Array.isArray(videoIds) || videoIds.length === 0) {
      return NextResponse.json(
        { error: videoMessages.invalidBatchRequest || 'Invalid request' },
        { status: 400 }
      )
    }

    // Batch size limit: max 100 items
    if (videoIds.length > 100) {
      return NextResponse.json(
        { error: videoMessages.batchSizeLimitExceeded || 'Batch size limit exceeded' },
        { status: 400 }
      )
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: videoMessages.invalidBatchName || 'name must be a non-empty string' },
        { status: 400 }
      )
    }

    const targetVideos = await prisma.video.findMany({
      where: { id: { in: videoIds } },
      select: { id: true, projectId: true, version: true },
    })
    if (targetVideos.length === 0) {
      return NextResponse.json({ error: videoMessages.videoNotFoundApi || 'Video not found' }, { status: 404 })
    }
    const projectIds = [...new Set(targetVideos.map((video) => video.projectId))]
    for (const projectId of projectIds) {
      if (!(await canAccessProject(prisma, authResult, projectId))) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }
    }

    const newName = name.trim()
    // (projectId, name, version) is unique, and a video sitting in the recycle bin
    // still holds its slot, so renaming onto an occupied pair has to be refused here
    // rather than surfacing as a database error. Check and write share one transaction
    // so a group is never left half-renamed; the unique index still decides under
    // concurrency, which is why the violation below is answered the same way.
    const conflict = () => NextResponse.json(
      {
        error: videoMessages.videoNameVersionTaken || 'That video already has a version with this name.',
        code: 'VIDEO_NAME_VERSION_TAKEN',
      },
      { status: 409 }
    )

    try {
      const renamed = await prisma.$transaction(async (tx) => {
        const taken = await videoNameSlotTaken(
          tx,
          newName,
          targetVideos.map((video) => ({
            projectId: video.projectId,
            version: video.version,
            videoId: video.id,
          })),
        )
        if (taken) return null
        // Only the videos that were found *and* access-checked above, so a caller
        // cannot slip in ids of rows the live-reading lookup did not return.
        const result = await tx.video.updateMany({
          where: { id: { in: targetVideos.map((video) => video.id) } },
          data: { name: newName }
        })
        return result.count
      })

      if (renamed === null) return conflict()

      return NextResponse.json({
        success: true,
        updated: renamed
      })
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') return conflict()
      throw error
    }
  } catch (error) {
    logError('Error batch updating videos:', error)
    return NextResponse.json(
      { error: videoMessages.failedToUpdateVideosBatch || 'Failed to update videos' },
      { status: 500 }
    )
  }
}
