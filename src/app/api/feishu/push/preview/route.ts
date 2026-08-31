import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/feishu/push/preview
 *
 * Preview what would be pushed (statistics and recipient info).
 * Used before actual push to show confirmation dialog.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { scope, projectId, videoId } = body

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

    if (scope === 'video') {
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
      // Project scope
      videos = await prisma.video.findMany({
        where: { projectId },
        select: {
          id: true,
          name: true,
          version: true,
          versionLabel: true,
          uploadedBy: true,
          uploadedByName: true,
        },
        orderBy: [{ name: 'asc' }, { version: 'asc' }],
      })

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
      select: {
        id: true,
        name: true,
        feishuBinding: {
          select: { id: true, nickname: true },
        },
      },
    })

    if (!uploaderUser) {
      return NextResponse.json(
        { error: 'Uploader user not found' },
        { status: 404 }
      )
    }

    const isBound = !!uploaderUser.feishuBinding

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

    // Group comments by video for project scope
    const commentsByVideo = scope === 'project'
      ? videos.map((v: any) => ({
          video: v,
          count: comments.filter((c: any) => c.videoId === v.id).length,
        }))
      : []

    return NextResponse.json({
      scope,
      project: {
        id: project.id,
        title: project.title,
        code: project.projectCode,
      },
      videos: scope === 'video' ? videos[0] : undefined,
      videoList: scope === 'project' ? commentsByVideo : undefined,
      totalComments: comments.length,
      pushedComments: comments.length - unpushedComments.length,
      unpushedComments: unpushedComments.length,
      recipient: {
        userId: uploaderUser.id,
        name: uploaderUser.name,
        feishuNickname: uploaderUser.feishuBinding?.nickname,
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
