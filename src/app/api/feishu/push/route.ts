import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { buildReviewCommentCard, sendMessageCard } from '@/lib/feishu'
import { logError, logMessage } from '@/lib/logging'
import { buildDeepLink } from '@/lib/deep-link'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/feishu/push
 *
 * Execute Feishu notification push.
 * Sends interactive message card to video uploader's Feishu account.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { retryNotificationId } = body
    const retryNotification = retryNotificationId
      ? await prisma.feishuNotification.findUnique({
          where: { id: retryNotificationId },
          select: {
            id: true,
            projectId: true,
            videoId: true,
            scope: true,
            commentIds: true,
            uploaderId: true,
            retryCount: true,
            status: true,
          },
        })
      : null

    if (retryNotificationId && !retryNotification) {
      return NextResponse.json({ error: 'Notification not found' }, { status: 404 })
    }
    if (retryNotification && retryNotification.status !== 'FAILED') {
      return NextResponse.json({ error: 'Only failed notifications can be retried' }, { status: 400 })
    }

    const scope = retryNotification?.scope ?? body.scope
    const projectId = retryNotification?.projectId ?? body.projectId
    const videoId = retryNotification?.videoId ?? body.videoId
    const videoIds = retryNotification ? undefined : body.videoIds
    const rePushAll = retryNotification ? true : (body.rePushAll ?? false)

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

    if (scope === 'project' && !videoIds && !rePushAll) {
      return NextResponse.json(
        { error: 'videoIds is required for project scope' },
        { status: 400 }
      )
    }

    // Get project
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, title: true, projectCode: true },
    })

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Get videos and comments
    let videos
    let comments
    let uploader

    if (scope === 'video') {
      const video = await prisma.video.findUnique({
        where: { id: videoId },
        select: {
          id: true,
          name: true,
          version: true,
          versionLabel: true,
          uploadedBy: true,
        },
      })

      if (!video) {
        return NextResponse.json({ error: 'Video not found' }, { status: 404 })
      }

      comments = await prisma.comment.findMany({
        where: { projectId, videoId },
        select: { id: true, videoId: true, timecode: true, content: true },
        orderBy: { timecode: 'asc' },
      })

      videos = [video]
      uploader = video.uploadedBy
    } else {
      // Project scope - filter by videoIds if provided
      videos = await prisma.video.findMany({
        where: {
          projectId,
          ...(videoIds ? { id: { in: videoIds } } : {}),
        },
        select: {
          id: true,
          name: true,
          version: true,
          versionLabel: true,
          uploadedBy: true,
        },
        orderBy: [{ name: 'asc' }, { version: 'asc' }],
      })

      const targetVideoIds = videos.map((v: any) => v.id)
      comments = await prisma.comment.findMany({
        where: { projectId, videoId: { in: targetVideoIds } },
        select: { id: true, videoId: true, timecode: true, content: true },
        orderBy: [{ videoId: 'asc' }, { timecode: 'asc' }],
      })

      uploader = videos[0]?.uploadedBy
    }

    if (retryNotification) {
      const retryCommentIds = new Set(retryNotification.commentIds)
      comments = comments.filter((comment: any) => retryCommentIds.has(comment.id))
      const commentVideoIds = new Set(comments.map((comment: any) => comment.videoId).filter(Boolean))
      videos = videos.filter((video: any) => commentVideoIds.has(video.id))
    }

    if (!uploader && scope === 'video') {
      return NextResponse.json(
        { error: 'No uploader found' },
        { status: 400 }
      )
    }

    if (comments.length === 0) {
      return NextResponse.json(
        { error: 'No comments to push' },
        { status: 400 }
      )
    }

    // Determine which comments to push
    let commentsToPush = comments

    if (!rePushAll) {
      // Only push unpushed comments
      const previousNotifications = await prisma.feishuNotification.findMany({
        where: {
          projectId,
          ...(scope === 'video' && videoId ? { videoId } : {}),
          status: 'SENT',
        },
        select: { commentIds: true },
      })

      const pushedIds = new Set(previousNotifications.flatMap((n: any) => n.commentIds))
      commentsToPush = comments.filter((c: any) => !pushedIds.has(c.id))

      if (commentsToPush.length === 0) {
        return NextResponse.json(
          { error: 'All comments have been pushed. Enable "Re-push" to send again.' },
          { status: 400 }
        )
      }
    }

    // Project pushes use the same card as a single-video push.  Each video
    // gets its own notification so the recipient and "查看本集" link match.
    const groupedVideos = videos
      .map((video: any) => ({
        video,
        comments: commentsToPush.filter((comment: any) => comment.videoId === video.id),
      }))
      .filter((group: any) => group.comments.length > 0)

    if (groupedVideos.length === 0) {
      return NextResponse.json({ error: 'No comments to push' }, { status: 400 })
    }

    const pushGroups: Array<{
      video: any
      comments: any[]
      uploaderUser: any
    }> = []

    for (const group of groupedVideos) {
      // A retry for a video whose uploader was removed still uses the
      // uploader recorded on the failed notification.
      const retryUploaderId = retryNotification?.videoId === group.video.id
        ? retryNotification?.uploaderId
        : null
      const uploaderId = retryUploaderId
        ? retryUploaderId
        : group.video.uploadedBy
      if (!uploaderId) {
        return NextResponse.json({ error: `视频「${group.video.name}」没有上传者` }, { status: 400 })
      }

      const uploaderUser = await prisma.user.findUnique({
        where: { id: uploaderId },
        include: { feishuBinding: true },
      })
      if (!uploaderUser?.feishuBinding) {
        return NextResponse.json(
          { error: `视频「${group.video.name}」的上传者尚未绑定飞书账号` },
          { status: 400 }
        )
      }
      pushGroups.push({ video: group.video, comments: group.comments, uploaderUser })
    }

    const notificationIds: string[] = []
    const messageIds: string[] = []
    let sentComments = 0

    for (const group of pushGroups) {
      const notification = await prisma.feishuNotification.create({
        data: {
          projectId,
          videoId: group.video.id,
          userId: user.id,
          scope,
          commentIds: group.comments.map((comment: any) => comment.id),
          uploaderId: group.uploaderUser.id,
          uploaderOpenId: group.uploaderUser.feishuBinding.openId,
          status: 'PENDING',
          retryCount: retryNotification ? retryNotification.retryCount + 1 : 1,
        },
      })
      notificationIds.push(notification.id)

      try {
        const card = buildReviewCommentCard({
          projectTitle: project.title,
          videoName: group.video.name,
          versionLabel: group.video.versionLabel,
          comments: group.comments,
          reviewerName: user.name || '管理员',
        })
        const messageId = await sendMessageCard(group.uploaderUser.feishuBinding.openId, {
          title: card.title,
          content: card.content,
          buttons: [{
            text: '查看本集',
            url: buildDeepLink({
              projectId,
              videoId: group.video.id,
              videoName: group.video.name,
              version: group.video.version,
            }),
            type: 'primary',
          }],
        })

        await prisma.feishuNotification.update({
          where: { id: notification.id },
          data: { status: 'SENT', feishuMessageId: messageId, sentAt: new Date() },
        })
        messageIds.push(messageId)
        sentComments += group.comments.length
        logMessage(`Pushed ${group.comments.length} comments to Feishu user ${group.uploaderUser.feishuBinding.openId}`)
      } catch (sendError) {
        await prisma.feishuNotification.update({
          where: { id: notification.id },
          data: {
            status: 'FAILED',
            errorMessage: sendError instanceof Error ? sendError.message : String(sendError),
          },
        })
        logError('Failed to send Feishu message:', sendError)
        return NextResponse.json(
          {
            error: 'Failed to send Feishu notification',
            details: sendError instanceof Error ? sendError.message : 'Unknown error',
            notificationId: notification.id,
            notificationIds,
            pushedComments: sentComments,
          },
          { status: 500 }
        )
      }
    }

    return NextResponse.json({
      success: true,
      notificationId: notificationIds[0],
      notificationIds,
      messageId: messageIds[0],
      messageIds,
      pushedComments: sentComments,
    })
  } catch (error) {
    logError('Push execution error:', error)
    return NextResponse.json(
      { error: 'Failed to execute push' },
      { status: 500 }
    )
  }
}
