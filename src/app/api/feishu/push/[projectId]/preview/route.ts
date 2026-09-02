import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/db'
import {
  fetchFeishuProfileByOpenId,
  fetchFeishuProfileByUserAccessToken,
  refreshFeishuUserAccessToken,
} from '@/lib/feishu'
import { decrypt, encrypt } from '@/lib/encryption'

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
    const shouldRefreshProfiles = url.searchParams.get('refresh') === '1'

    async function refreshBinding(binding: {
      id: string
      openId: string
      nickname: string | null
      avatarUrl: string | null
      userAccessTokenEncrypted: string | null
      refreshTokenEncrypted: string | null
      tokenExpiresAt: Date | null
    } | null) {
      if (!binding || !shouldRefreshProfiles || !binding.openId) return binding
      try {
        let accessToken = binding.userAccessTokenEncrypted ? decrypt(binding.userAccessTokenEncrypted) : null
        let refreshToken = binding.refreshTokenEncrypted ? decrypt(binding.refreshTokenEncrypted) : null
        let tokenExpiresAt = binding.tokenExpiresAt
        if ((!accessToken || !tokenExpiresAt || tokenExpiresAt.getTime() <= Date.now() + 60_000) && refreshToken) {
          const refreshed = await refreshFeishuUserAccessToken(refreshToken)
          accessToken = refreshed.accessToken
          refreshToken = refreshed.refreshToken || refreshToken
          tokenExpiresAt = refreshed.expiresIn ? new Date(Date.now() + refreshed.expiresIn * 1000) : null
          await prisma.feishuBinding.update({
            where: { id: binding.id },
            data: {
              userAccessTokenEncrypted: encrypt(accessToken),
              refreshTokenEncrypted: encrypt(refreshToken),
              tokenExpiresAt,
            },
          })
        }
        const profile = accessToken
          ? await fetchFeishuProfileByUserAccessToken(accessToken)
          : await fetchFeishuProfileByOpenId(binding.openId)
        const nickname = profile.name || binding.nickname
        const avatarUrl = profile.avatarUrl || binding.avatarUrl
        if (nickname !== binding.nickname || avatarUrl !== binding.avatarUrl) {
          await prisma.feishuBinding.update({ where: { id: binding.id }, data: { nickname, avatarUrl } })
        }
        return { ...binding, nickname, avatarUrl }
      } catch {
        return binding
      }
    }

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

    // A project can contain videos uploaded by different users (or legacy
    // rows without an uploader). Keep those rows in the preview so the UI can
    // show their individual recipient state; only a single-video preview
    // requires a recipient at this stage.
    if (!uploader && scope === 'video') {
      return NextResponse.json(
        { error: 'No uploader found for this scope' },
        { status: 400 }
      )
    }

    // Video.uploadedBy is legacy metadata without a foreign key. A deleted
    // user should still produce a useful preview, but cannot receive Feishu.
    const uploaderUser = uploader
      ? await prisma.user.findUnique({
          where: { id: uploader },
          select: { id: true, name: true, avatarUrl: true },
        })
      : null

    let uploaderBinding = uploaderUser
      ? await prisma.feishuBinding.findUnique({
          where: { userId: uploaderUser.id },
          select: {
            id: true,
            openId: true,
            nickname: true,
            avatarUrl: true,
            userAccessTokenEncrypted: true,
            refreshTokenEncrypted: true,
            tokenExpiresAt: true,
          },
        })
      : null
    uploaderBinding = await refreshBinding(uploaderBinding)

    const isBound = !!uploaderBinding

    // Find previously pushed comments
    const previousNotifications = await prisma.feishuNotification.findMany({
      where: {
        projectId,
        ...(scope === 'video' && videoId ? { videoId } : {}),
        status: 'SENT',
      },
      select: { videoId: true, commentIds: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })

    const lastAttempt = await prisma.feishuNotification.findFirst({
      where: {
        projectId,
        scope,
        ...(scope === 'video' && videoId ? { videoId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, errorMessage: true, retryCount: true, createdAt: true },
    })

    const pushedCommentIds = new Set(
      previousNotifications.flatMap((n: any) => n.commentIds)
    )

    // Keep the complete SENT history per video. Looking only at the latest
    // notification loses comments that were sent in an earlier batch.
    const pushedCommentIdsByVideo = new Map<string, Set<string>>()
    const lastPushAtByVideo = new Map<string, Date>()
    for (const notification of previousNotifications) {
      if (!notification.videoId) continue

      const videoCommentIds = pushedCommentIdsByVideo.get(notification.videoId) || new Set<string>()
      notification.commentIds.forEach((commentId: string) => videoCommentIds.add(commentId))
      pushedCommentIdsByVideo.set(notification.videoId, videoCommentIds)

      if (!lastPushAtByVideo.has(notification.videoId)) {
        lastPushAtByVideo.set(notification.videoId, notification.createdAt)
      }
    }

    const unpushedComments = comments.filter((c: any) => !pushedCommentIds.has(c.id))

    // Group comments by video for project scope with detailed push status
    const videoListWithStatus: any[] = []
    if (scope === 'project') {
      for (const video of videos) {
        const videoComments = comments.filter((c: any) => c.videoId === video.id)
        if (videoComments.length === 0) continue // Skip videos without comments

        const videoPushedIds = pushedCommentIdsByVideo.get(video.id) || new Set<string>()
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
        let videoBinding = uploaderId
          ? await prisma.feishuBinding.findUnique({
              where: { userId: uploaderId },
              select: {
                id: true,
                openId: true,
                nickname: true,
                avatarUrl: true,
                userAccessTokenEncrypted: true,
                refreshTokenEncrypted: true,
                tokenExpiresAt: true,
              },
            })
          : null
        videoBinding = await refreshBinding(videoBinding)

        videoListWithStatus.push({
          video: {
            id: video.id,
            name: video.name,
            versionLabel: video.versionLabel,
          },
          totalComments: videoComments.length,
          pushedComments: videoComments.length - videoUnpushed.length,
          unpushedComments: videoUnpushed.length,
          lastPushAt: lastPushAtByVideo.get(video.id) || null,
          uploader: {
          id: videoUploader?.id || video.uploadedBy || '',
          name: videoUploader?.name || video.uploadedByName || null,
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
        userId: uploaderUser?.id || uploader,
        name: uploaderUser?.name || videos[0]?.uploadedByName || null,
        feishuNickname: uploaderBinding?.nickname || undefined,
        avatarUrl: uploaderUser?.avatarUrl || null,
        feishuAvatar: uploaderBinding?.avatarUrl || undefined,
        isBound,
      },
      hasPreviousPush: previousNotifications.length > 0,
      lastPushAt: previousNotifications[0]?.createdAt || null,
      lastFailedPush: lastAttempt?.status === 'FAILED'
        ? {
            id: lastAttempt.id,
            errorMessage: lastAttempt.errorMessage,
            retryCount: lastAttempt.retryCount,
            createdAt: lastAttempt.createdAt,
          }
        : null,
    })
  } catch (error) {
    console.error('Preview push error:', error)
    return NextResponse.json(
      { error: 'Failed to preview push' },
      { status: 500 }
    )
  }
}
