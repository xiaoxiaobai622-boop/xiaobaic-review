import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { sendMessageCard } from '@/lib/feishu'
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

    if (retryNotification?.uploaderId) {
      uploader = retryNotification.uploaderId
    }

    if (retryNotification) {
      const retryCommentIds = new Set(retryNotification.commentIds)
      comments = comments.filter((comment: any) => retryCommentIds.has(comment.id))
      const commentVideoIds = new Set(comments.map((comment: any) => comment.videoId).filter(Boolean))
      videos = videos.filter((video: any) => commentVideoIds.has(video.id))
    }

    if (!uploader) {
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

    // Get uploader's Feishu binding
    const uploaderUser = await prisma.user.findUnique({
      where: { id: uploader },
      include: { feishuBinding: true },
    })

    if (!uploaderUser?.feishuBinding) {
      return NextResponse.json(
        { error: 'Uploader has not bound Feishu account' },
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

    // Build message card content
    let cardTitle: string
    let cardContent: string
    let deepLink: string

    if (scope === 'video') {
      const video = videos[0]
      cardTitle = '🎬 MLE6 逐帧审阅批注意见'
      cardContent = `**项目：** ${project.title}\n**视频：** ${video.name}\n**版本：** ${video.versionLabel}\n\n本次新增 **${commentsToPush.length}** 条批注意见\n\n━━━━━━━━━━━━━━\n\n`

      // Add up to 10 comments in card
      const displayComments = commentsToPush.slice(0, 10)
      cardContent += displayComments.map((c: any) => `**${c.timecode}**\n${c.content}`).join('\n\n')

      if (commentsToPush.length > 10) {
        cardContent += `\n\n...还有 ${commentsToPush.length - 10} 条批注意见`
      }

      cardContent += `\n\n━━━━━━━━━━━━━━\n审阅人：${user.name || '管理员'}`

      // Build deep link to video
      deepLink = buildDeepLink({
        projectId,
        videoId,
      })
    } else {
      // Project scope
      cardTitle = '🎬 MLE6 逐帧审阅批注意见'
      cardContent = `**项目：** ${project.title}\n\n本次推送：\n**${videos.length}** 个视频\n**${commentsToPush.length}** 条批注意见\n\n━━━━━━━━━━━━━━\n\n`

      // Group by video
      const grouped = videos.map((v: any) => ({
        video: v,
        count: commentsToPush.filter((c: any) => c.videoId === v.id).length,
      })).filter((g: any) => g.count > 0)

      cardContent += grouped.map((g: any) => `${g.video.name}：${g.count}条`).join('\n')
      cardContent += `\n\n━━━━━━━━━━━━━━`

      // Build deep link to project
      deepLink = buildDeepLink({ projectId })
    }

    // Create notification record (PENDING)
    const notification = await prisma.feishuNotification.create({
      data: {
        projectId,
        videoId: scope === 'video' ? videoId : null,
        userId: user.id,
        scope,
        commentIds: commentsToPush.map((c: any) => c.id),
        uploaderId: uploader,
        uploaderOpenId: uploaderUser.feishuBinding.openId,
        status: 'PENDING',
        retryCount: retryNotification ? retryNotification.retryCount + 1 : 1,
      },
    })

    // Send message card
    try {
      const messageId = await sendMessageCard(uploaderUser.feishuBinding.openId, {
        title: cardTitle,
        content: cardContent,
        buttons: [
          {
            text: scope === 'video' ? '查看本集' : '查看项目',
            url: deepLink,
            type: 'primary',
          },
        ],
      })

      // Update notification to SENT
      await prisma.feishuNotification.update({
        where: { id: notification.id },
        data: {
          status: 'SENT',
          feishuMessageId: messageId,
          sentAt: new Date(),
        },
      })

      logMessage(`Pushed ${commentsToPush.length} comments to Feishu user ${uploaderUser.feishuBinding.openId}`)

      return NextResponse.json({
        success: true,
        notificationId: notification.id,
        messageId,
        pushedComments: commentsToPush.length,
      })
    } catch (sendError) {
      // Update notification to FAILED
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
        },
        { status: 500 }
      )
    }
  } catch (error) {
    logError('Push execution error:', error)
    return NextResponse.json(
      { error: 'Failed to execute push' },
      { status: 500 }
    )
  }
}
