import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/feishu/push/[projectId]/preview?videoId=xxx
 *
 * Preview what would be pushed (statistics and recipient info).
 * Used before actual push to show confirmation dialog.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Extract projectId from URL path and videoId from query params
    const url = new URL(request.url)
    const pathParts = url.pathname.split('/')
    const projectId = pathParts[pathParts.length - 2] // .../push/[projectId]/preview
    const videoId = url.searchParams.get('videoId')
    const scope = videoId ? 'video' : 'project'

    if (!scope || !projectId) {
      return NextResponse.json(
        { error: 'scope and projectId are required' },
        { status: 400 }
      )
    }

    if (scope === 'video' && !videoId) {
      return NextResponse.json(
        { error: 'videoId is required for video scope' },
        { status: 400 }
      )
    }

    // Get project info
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, title: true, projectCode: true },
    })

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Collect comments based on scope
    let comments
    let videos
    let uploader

    if (scope === 'video' && videoId) {
      // Single video scope
      const video = await prisma.video.findUnique({
        where: { id: videoId },
        select: {
          id: true,
          name: true,
          version: true,
          versionLabel: true,
          uploadedBy: true,
          uploadedByName: true,
        },
      })

      if (!video) {
        return NextResponse.json({ error: 'Video not found' }, { status: 404 })
      }

      comments = await prisma.comment.findMany({
        where: {
          projectId,
          videoId,
        },
        select: { id: true, timecode: true, content: true, createdAt: true },
        orderBy: { timecode: 'asc' },
      })

      videos = [video]
      uploader = video.uploadedBy
    } else {
      // Project scope - get all videos and keep only the latest version of each
      const allVideos = await prisma.video.findMany({
        where: { projectId },
        select: {
          id: true,
          name: true,
          version: true,
          versionLabel: true,
          uploadedBy: true,
          uploadedByName: true,
        },
        orderBy: [{ name: 'asc' }, { version: 'desc' }],
      })

      // Group by video name and keep only the highest version
      const videoMap = new Map<string, typeof allVideos[0]>()
      for (const video of allVideos) {
        const existing = videoMap.get(video.name)
        if (!existing || video.version > existing.version) {
          videoMap.set(video.name, video)
        }
      }
      videos = Array.from(videoMap.values())

      const videoIds = videos.map((v) => v.id)

      comments = await prisma.comment.findMany({
        where: {
          projectId,
          videoId: { in: videoIds },
        },
        select: { id: true, videoId: true, timecode: true, content: true, createdAt: true },
        orderBy: [{ videoId: 'asc' }, { timecode: 'asc' }],
      })

      // For project scope, use first video's uploader (V1 requirement: notify video uploader)
      uploader = videos[0]?.uploadedBy
    }

    if (!uploader) {
      return NextResponse.json(
        { error: 'No uploader found for this scope' },
        { status: 400 }
      )
    }

    // Check if uploader has Feishu binding
    const uploaderUser = await prisma.user.findUnique({
      where: { id: uploader },
      select: { id: true, name: true, avatarUrl: true },
    })

    if (!uploaderUser) {
      return NextResponse.json(
        { error: 'Uploader user not found' },
        { status: 404 }
      )
    }

    const uploaderBinding = await prisma.feishuBinding.findUnique({
      where: { userId: uploader },
      select: { nickname: true, avatarUrl: true },
    })

    const isBound = !!uploaderBinding

    // Find previously pushed comments
    const previousNotifications = await prisma.feishuNotification.findMany({
      where: {
        projectId,
        ...(scope === 'video' && videoId ? { videoId } : {}),
        status: 'SENT',
      },
      select: { commentIds: true, createdAt: true },
    })

    const pushedCommentIds = new Set(
      previousNotifications.flatMap((n: any) => n.commentIds)
    )

    const unpushedComments = comments.filter((c: any) => !pushedCommentIds.has(c.id))

    // Group comments by video for project scope with detailed push status
    const videoListWithStatus: any[] = []
    if (scope === 'project') {
      for (const video of videos) {
        const videoComments = comments.filter((c: any) => c.videoId === video.id)
        if (videoComments.length === 0) continue // Skip videos without comments

        // Find last push for this video
        const lastPush = await prisma.feishuNotification.findFirst({
          where: {
            projectId,
            videoId: video.id,
            status: 'SENT',
          },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true, commentIds: true },
        })

        const videoPushedIds = new Set(lastPush?.commentIds || [])
        const videoUnpushed = videoComments.filter((c: any) => !videoPushedIds.has(c.id))

        // Get this video's uploader and their Feishu binding.
        // Queried separately instead of via nested select to keep the types simple.
        const uploaderId = video.uploadedBy
        const videoUploader = uploaderId
          ? await prisma.user.findUnique({
              where: { id: uploaderId },
              select: { id: true, name: true, avatarUrl: true },
            })
          : null
        const videoBinding = uploaderId
          ? await prisma.feishuBinding.findUnique({
              where: { userId: uploaderId },
              select: { nickname: true, avatarUrl: true },
            })
          : null

        videoListWithStatus.push({
          video: {
            id: video.id,
            name: video.name,
            versionLabel: video.versionLabel,
          },
          totalComments: videoComments.length,
          pushedComments: videoComments.length - videoUnpushed.length,
          unpushedComments: videoUnpushed.length,
          lastPushAt: lastPush?.createdAt || null,
          uploader: {
            id: videoUploader?.id || '',
            name: videoUploader?.name || null,
            avatarUrl: videoUploader?.avatarUrl || null,
            feishuNickname: videoBinding?.nickname || undefined,
            feishuAvatar: videoBinding?.avatarUrl || undefined,
            isBound: !!videoBinding,
          },
        })
      }
    }

    return NextResponse.json({
      scope,
      project: {
        id: project.id,
        title: project.title,
        code: project.projectCode,
      },
      videos: scope === 'video' ? videos[0] : undefined,
      videoList: scope === 'project' ? videoListWithStatus : undefined,
      totalComments: comments.length,
      pushedComments: comments.length - unpushedComments.length,
      unpushedComments: unpushedComments.length,
      recipient: {
        userId: uploaderUser.id,
        name: uploaderUser.name,
        feishuNickname: uploaderBinding?.nickname || undefined,
        avatarUrl: uploaderUser.avatarUrl,
        feishuAvatar: uploaderBinding?.avatarUrl || undefined,
        isBound,
      },
      hasPreviousPush: previousNotifications.length > 0,
      lastPushAt: previousNotifications[0]?.createdAt || null,
    })
  } catch (error) {
    console.error('Preview push error:', error)
    return NextResponse.json(
      { error: 'Failed to preview push' },
      { status: 500 }
    )
  }
}
