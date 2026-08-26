import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiAdmin } from '@/lib/auth'
import { getAutoApproveProject } from '@/lib/settings'
import { rateLimit } from '@/lib/rate-limit'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import { logError, logMessage } from '@/lib/logging'
import { canAccessProject, canManageProjectApproval } from '@/lib/project-access'
import { createRecycleBinItem } from '@/lib/recycle-bin'
import { rollbackLatestVideoVersion } from '@/lib/video-version-rollback'

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

async function checkAllVideosApproved(projectId: string): Promise<boolean> {
  const allVideos = await prisma.video.findMany({
    where: { projectId },
    select: { approved: true, name: true }
  })

  const videosByName = allVideos.reduce((acc: Record<string, any[]>, video) => {
    if (!acc[video.name]) acc[video.name] = []
    acc[video.name].push(video)
    return acc
  }, {})

  return Object.values(videosByName).every((versions: any[]) =>
    versions.some(v => v.approved)
  )
}

async function updateProjectStatus(
  projectId: string,
  videoId: string,
  approved: boolean,
  currentStatus: string
): Promise<void> {
  const allApproved = await checkAllVideosApproved(projectId)

  const autoApprove = await getAutoApproveProject()

  if (allApproved && approved && autoApprove) {
    await prisma.project.update({
      where: { id: projectId },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        approvedVideoId: videoId
      }
    })
  } else if (!approved && currentStatus === 'APPROVED') {
    await prisma.project.update({
      where: { id: projectId },
      data: {
        status: 'IN_REVIEW',
        approvedAt: null,
        approvedVideoId: null
      }
    })
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
      where: { id },
      include: { project: true }
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
      await prisma.video.update({
        where: { id },
        data: updateData
      })
    }

    if (approved !== undefined) {
      logMessage(`[VIDEO-APPROVAL] Admin toggled approval for video ${id} to ${approved}`)
      await updateProjectStatus(video.projectId, id, approved, video.project.status)

      // Admin-toggled approvals don't send email notifications (only client-initiated ones do)
      logMessage('[VIDEO-APPROVAL] Admin approval - emails NOT sent (by design)')
    }

    return NextResponse.json({ success: true })
  } catch (error) {
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

    const candidatePaths = [
      video.originalStoragePath,
      video.preview2160Path,
      video.preview1080Path,
      video.preview720Path,
      (video as any).hlsPath,
      video.cleanPreview2160Path,
      video.cleanPreview1080Path,
      video.cleanPreview720Path,
    ].filter((path): path is string => Boolean(path))
    const paths: string[] = []
    for (const path of candidatePaths) {
      const [sharedVideos, sharedAssets] = await Promise.all([
        prisma.video.count({ where: { id: { not: id }, OR: [
          { originalStoragePath: path },
          { preview2160Path: path },
          { preview1080Path: path },
          { preview720Path: path },
          { hlsPath: path },
          { cleanPreview2160Path: path },
          { cleanPreview1080Path: path },
          { cleanPreview720Path: path },
          { thumbnailPath: path },
        ] } }),
        prisma.videoAsset.count({ where: { storagePath: path, videoId: { not: id } } }),
      ])
      if (sharedVideos === 0 && sharedAssets === 0) paths.push(path)
    }

    for (const asset of video.assets) {
      const sharedCount = await prisma.videoAsset.count({
        where: { storagePath: asset.storagePath, id: { not: asset.id } },
      })
      if (sharedCount === 0) paths.push(asset.storagePath)
    }

    if (video.thumbnailPath) {
      const [thumbnailSharedAssets, thumbnailSharedVideos] = await Promise.all([
        prisma.videoAsset.count({ where: { storagePath: video.thumbnailPath, videoId: { not: id } } }),
        prisma.video.count({ where: { thumbnailPath: video.thumbnailPath, id: { not: id } } }),
      ])
      if (thumbnailSharedAssets === 0 && thumbnailSharedVideos === 0) paths.push(video.thumbnailPath)
    }

    await prisma.$transaction(async (tx) => {
      await createRecycleBinItem(tx, video.project.id, {
        itemType: 'VIDEO',
        itemName: `${video.name} ${video.versionLabel}`,
        metadata: { videoId: video.id, originalFileName: video.originalFileName, version: video.version },
        paths: [...new Set(paths)],
      })
      await tx.video.delete({ where: { id } })

      // Keep version numbers contiguous after removing a version (e.g. v1, v2, v3 -> v1, v2).
      const laterVersions = await tx.video.findMany({
        where: { projectId: video.project.id, name: video.name, version: { gt: video.version } },
        orderBy: { version: 'asc' },
        select: { id: true, version: true },
      })
      for (const remaining of laterVersions) {
        const nextVersion = remaining.version - 1
        await tx.video.update({
          where: { id: remaining.id },
          data: { version: nextVersion, versionLabel: `v${nextVersion}` },
        })
      }
    })

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
