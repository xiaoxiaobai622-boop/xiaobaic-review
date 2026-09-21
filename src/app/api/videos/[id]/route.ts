import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiAdmin } from '@/lib/auth'
import { recomputeProjectApprovalStatus } from '@/lib/project-approval'
import { rateLimit } from '@/lib/rate-limit'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import { logError, logMessage } from '@/lib/logging'
import { canAccessProject, canManageProjectApproval } from '@/lib/project-access'
import { createRecycleBinItem } from '@/lib/recycle-bin'
import { parentDirectory, referencedStoragePaths } from '@/lib/video-storage-paths'
import { rollbackLatestVideoVersion } from '@/lib/video-version-rollback'
import { videoNameSlotTaken } from '@/lib/video-versions'

export const runtime = 'nodejs'


// POST /api/videos/[id] - Perform an explicit version action.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const body = await request.json().catch(() => null)
  if (body?.action !== 'rollback-to-collection') {
    return NextResponse.json({ error: 'Unsupported video action.' }, { status: 400 })
  }

  const { id } = await params
  return rollbackLatestVideoVersion(request, id)
}



// GET /api/videos/[id] - Get video status (for polling during processing)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const videoMessages = messages?.videos || {}

  const authResult = await requireApiAdmin(request)
  if (authResult instanceof Response) {
    return authResult
  }

  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 120, // Allow 2 requests per second for polling
    message: videoMessages.tooManyVideoStatusRequests || 'Too many video status requests. Please slow down.',
  }, 'video-status')
  if (rateLimitResult) return rateLimitResult

  try {
    const { id } = await params
    
    const video = await prisma.video.findUnique({
      where: { id },
      select: {
        id: true,
        projectId: true,
        name: true,
        status: true,
        processingProgress: true,
        processingError: true,
        duration: true,
        width: true,
        height: true,
      }
    })

    if (!video) {
  return NextResponse.json({ error: videoMessages.videoNotFoundApi || 'Video not found' }, { status: 404 })
    }

    if (!(await canAccessProject(prisma, authResult, video.projectId))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    return NextResponse.json(video)
  } catch (error) {
    logError('Error fetching video status:', error)
    return NextResponse.json(
      { error: videoMessages.failedToFetchVideoStatus || 'Failed to fetch video status' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const videoMessages = messages?.videos || {}

  const authResult = await requireApiAdmin(request)
  if (authResult instanceof Response) {
    return authResult
  }

  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 60,
    message: videoMessages.tooManyVideoUpdateRequests || 'Too many video update requests. Please slow down.',
  }, 'video-update')
  if (rateLimitResult) return rateLimitResult

  // Renaming can collide with the unique (projectId, name, version) index; both the
  // pre-check and the violation itself answer the same way as /api/videos/batch.
  const nameVersionTaken = () => NextResponse.json(
    {
      error: videoMessages.videoNameVersionTaken || 'That video already has a version with this name.',
      code: 'VIDEO_NAME_VERSION_TAKEN',
    },
    { status: 409 }
  )

  try {
    const { id } = await params
    const body = await request.json()
    const { approved, name, versionLabel, folderId, moveGroup } = body

    if (versionLabel !== undefined) {
      return NextResponse.json(
        { error: videoMessages.versionLabelAutomatic || 'Version labels are generated automatically' },
        { status: 400 }
      )
    }

    if (approved !== undefined && typeof approved !== 'boolean') {
      return NextResponse.json(
        { error: videoMessages.invalidApprovedBoolean || 'Invalid request: approved must be a boolean' },
        { status: 400 }
      )
    }

    if (name !== undefined && (!name || typeof name !== 'string' || name.trim().length === 0)) {
      return NextResponse.json(
        { error: videoMessages.invalidName || 'Invalid request: name must be a non-empty string' },
        { status: 400 }
      )
    }

    if (folderId !== undefined && folderId !== null && (typeof folderId !== 'string' || folderId.trim().length === 0)) {
      return NextResponse.json({ error: 'Invalid folderId' }, { status: 400 })
    }

    if (moveGroup !== undefined && typeof moveGroup !== 'boolean') {
      return NextResponse.json({ error: 'Invalid moveGroup' }, { status: 400 })
    }

    if (approved === undefined && name === undefined && folderId === undefined) {
      return NextResponse.json(
        { error: videoMessages.invalidUpdateRequest || 'Invalid request: at least one field must be provided' },
        { status: 400 }
      )
    }

    const video = await prisma.video.findUnique({
      where: { id }
    })

    if (!video) {
  return NextResponse.json({ error: videoMessages.videoNotFoundApi || 'Video not found' }, { status: 404 })
    }

    if (!(await canAccessProject(prisma, authResult, video.projectId))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    if (folderId !== undefined && folderId !== null) {
      const folder = await prisma.projectFolder.findFirst({ where: { id: folderId, projectId: video.projectId } })
      if (!folder) return NextResponse.json({ error: 'Folder not found' }, { status: 404 })
    }

    if (approved !== undefined && !(await canManageProjectApproval(prisma, authResult, video.projectId))) {
      return NextResponse.json(
        { error: 'Only project managers or the project creator can approve videos' },
        { status: 403 }
      )
    }

    if (approved) {
      await prisma.video.updateMany({
        where: {
          projectId: video.projectId,
          name: video.name,
          id: { not: id },
          OR: [
            { approved: true },
            { reviewStatus: 'APPROVED' },
          ],
        },
        data: {
          approved: false,
          approvedAt: null,
          reviewStatus: null,
        },
      })
    }

    const updateData: any = {}

    if (approved !== undefined) {
      updateData.approved = approved
      updateData.approvedAt = approved ? new Date() : null
      updateData.reviewStatus = approved ? 'APPROVED' : null
    }

    if (name !== undefined) {
      updateData.name = name.trim()
    }
    if (folderId !== undefined) {
      updateData.folderId = folderId || null
    }

    if (moveGroup && folderId !== undefined) {
      await prisma.video.updateMany({
        where: { projectId: video.projectId, name: video.name },
        data: { folderId: folderId || null },
      })
    } else {
      if (updateData.name !== undefined && updateData.name !== video.name) {
        const taken = await videoNameSlotTaken(prisma, updateData.name, [
          { projectId: video.projectId, version: video.version, videoId: video.id },
        ])
        if (taken) return nameVersionTaken()
      }
      await prisma.video.update({
        where: { id },
        data: updateData
      })
    }

    if (approved !== undefined) {
      logMessage(`[VIDEO-APPROVAL] Admin toggled approval for video ${id} to ${approved}`)
      await recomputeProjectApprovalStatus(video.projectId)

      // Admin-toggled approvals don't send email notifications (only client-initiated ones do)
      logMessage('[VIDEO-APPROVAL] Admin approval - emails NOT sent (by design)')
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    if ((error as { code?: string })?.code === 'P2002') return nameVersionTaken()
    return NextResponse.json(
      { error: videoMessages.failedToUpdateVideoApproval || 'Failed to update video approval' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const videoMessages = messages?.videos || {}

  const authResult = await requireApiAdmin(request)
  if (authResult instanceof Response) {
    return authResult
  }

  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 30,
    message: videoMessages.tooManyVideoDeleteRequests || 'Too many video delete requests. Please slow down.',
  }, 'video-delete')
  if (rateLimitResult) return rateLimitResult

  try {
    const { id } = await params
    const video = await prisma.video.findUnique({
      where: { id },
      include: {
        project: {
          select: { id: true },
        },
        assets: true,
      }
    })
    if (!video) {
      return NextResponse.json({ error: videoMessages.videoNotFoundApi || 'Video not found' }, { status: 404 })
    }

    if (!(await canAccessProject(prisma, authResult, video.project.id))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Everything this row names, co-owners included. Whether an object may go is
    // decided when the record is purged, not here: another version, a video still
    // sitting in the bin, or the collected upload this original came from can all
    // point at the same file.
    const paths = referencedStoragePaths(video, video.assets)
    const mpsDirectory = parentDirectory(video.hlsPath)

    await prisma.$transaction(async (tx) => {
      await createRecycleBinItem(tx, video.project.id, {
        itemType: 'VIDEO',
        itemName: `${video.name} ${video.versionLabel}`,
        metadata: { videoId: video.id, originalFileName: video.originalFileName, name: video.name, version: video.version },
        paths,
        directories: mpsDirectory ? [mpsDirectory] : [],
      })
      // The row survives so restore can bring back the comments/analytics that a
      // hard delete cascades away. Versions are deliberately not renumbered: the
      // tombstone still owns its (projectId, name, version) slot, and shifting the
      // later versions down would make that slot impossible to restore into.
      await tx.video.update({ where: { id }, data: { deletedAt: new Date() } })
    })

    // Losing a version can remove the only approved cut of its group, which makes
    // the project's APPROVED badge a lie until this runs.
    await recomputeProjectApprovalStatus(video.project.id)

    return NextResponse.json({
      success: true,
      message: videoMessages.videoDeletedSuccessfully || 'Video moved to recycle bin',
    })
  } catch (error) {
    return NextResponse.json(
      { error: videoMessages.failedToDeleteVideoApi || 'Failed to delete video' },
      { status: 500 }
    )
  }
}
