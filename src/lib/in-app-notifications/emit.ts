import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { logError, logMessage } from '@/lib/logging'
import {
  actorKey,
  commentReviewLink,
  excerpt,
  formatFileList,
  hourBucket,
  projectFilesLink,
  versionLabelOf,
} from './format'
import {
  findParentAuthor,
  intersectMentionedViewers,
  loadNotificationProject,
  resolveProjectLeads,
  resolveProjectViewers,
} from './recipients'
import type {
  EmitInAppResult,
  InAppPayload,
  InAppRecipient,
  NotificationDraft,
} from './types'

function asJson(payload: InAppPayload | null | undefined): Prisma.InputJsonValue | undefined {
  return payload ? (payload as unknown as Prisma.InputJsonValue) : undefined
}

function mergePayload(
  existing: Prisma.JsonValue | undefined,
  incoming: InAppPayload | null | undefined,
): InAppPayload | null {
  const base =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {}
  const merged: Record<string, unknown> = incoming ? { ...base, ...incoming } : base

  const existingFiles = Array.isArray(base.fileNames)
    ? base.fileNames.filter((name): name is string => typeof name === 'string')
    : []
  const incomingFiles = Array.isArray(incoming?.fileNames) ? incoming.fileNames : []
  if (existingFiles.length || incomingFiles.length) {
    merged.fileNames = Array.from(new Set([...existingFiles, ...incomingFiles])).slice(-12)
  }

  return Object.keys(merged).length > 0 ? (merged as InAppPayload) : null
}

/**
 * 站内 feed 的唯一写入点。
 *
 * - UserNotificationEvent 先按 dedupeKey 去重，批量上传/重复 worker 回调不会把计数加两次。
 * - 聚合键相同的行只保留一行；已读后来了新事件会重新变成未读，计数从 1 开始。
 * - 这里只写站内，不发邮件/推送；渠道仍由各自的现有生产点负责，避免双份。
 */
export async function emitInAppNotifications(
  drafts: NotificationDraft[],
): Promise<EmitInAppResult> {
  const uniqueDrafts = Array.from(
    new Map(drafts.filter((draft) => draft.recipient.userId).map((draft) => [draft.dedupeKey, draft])).values(),
  )
  if (uniqueDrafts.length === 0) {
    return { insertedEvents: 0, writtenNotifications: 0, recipients: 0 }
  }

  return prisma.$transaction(
    async (tx) => {
      // Insert-and-return closes the read-before-write race: two concurrent
      // emits carrying the same dedupeKey cannot both proceed with a row.
      const insertedEvents = await tx.userNotificationEvent.createManyAndReturn({
        data: uniqueDrafts.map((draft) => ({
          dedupeKey: draft.dedupeKey,
          eventType: draft.eventType,
          teamId: draft.teamId,
          projectId: draft.projectId ?? null,
          recipientUserId: draft.recipient.userId,
          entityId: draft.commentId ?? draft.videoId ?? draft.projectId ?? null,
          createdAt: draft.createdAt ?? new Date(),
        })),
        skipDuplicates: true,
        select: { dedupeKey: true },
      })
      const insertedKeys = new Set(insertedEvents.map((row) => row.dedupeKey))
      const fresh = uniqueDrafts.filter((draft) => insertedKeys.has(draft.dedupeKey))
      if (fresh.length === 0) {
        return { insertedEvents: 0, writtenNotifications: 0, recipients: 0 }
      }

      // One aggregate row per (recipient, aggregateKey). Serialize the
      // find-or-create per key so concurrent files append instead of racing
      // into the unique constraint and rolling the whole transaction back.
      const lockKeys = Array.from(new Set(
        fresh
          .filter((draft) => Boolean(draft.aggregateKey))
          .map((draft) => `inapp:${draft.recipient.userId}:${draft.aggregateKey}`),
      )).sort()
      for (const lockKey of lockKeys) {
        // executeRaw avoids Prisma trying to deserialize the void return value.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`
      }

      let written = 0
      for (const draft of fresh) {
        const now = new Date()
        const basePayload = draft.payload ?? null
        let notificationId: string

        if (draft.aggregateKey) {
          const existing = await tx.userNotification.findUnique({
            where: {
              recipientUserId_aggregateKey: {
                recipientUserId: draft.recipient.userId,
                aggregateKey: draft.aggregateKey,
              },
            },
          })
          const wasRead = Boolean(existing?.readAt)
          const nextCount = existing ? (wasRead ? 1 : existing.aggregateCount + 1) : 1
          // A read group reopens as a fresh unread item: old file names must
          // not leak into "上传了文件 / 没有 ×N / 等 6 个文件".
          const mergedPayload = mergePayload(wasRead ? undefined : existing?.payload, {
            ...(basePayload ?? {}),
            count: nextCount,
          })
          const title = draft.aggregateTitle ? draft.aggregateTitle(nextCount) : draft.title
          const body = draft.aggregateBody
            ? draft.aggregateBody(nextCount, mergedPayload)
            : draft.body

          if (existing) {
            const updated = await tx.userNotification.update({
              where: { id: existing.id },
              data: {
                title,
                body: body ?? null,
                deepLink: draft.deepLink ?? existing.deepLink,
                aggregateCount: nextCount,
                lastEventAt: now,
                payload: asJson(mergedPayload),
                readAt: wasRead ? null : existing.readAt,
                seenAt: wasRead ? null : existing.seenAt,
                clickedAt: wasRead ? null : existing.clickedAt,
                dismissedAt: null,
                actorName: draft.actorName ?? existing.actorName,
              },
            })
            notificationId = updated.id
          } else {
            const created = await tx.userNotification.create({
              data: {
                eventType: draft.eventType,
                category: draft.category,
                teamId: draft.teamId,
                projectId: draft.projectId ?? null,
                videoId: draft.videoId ?? null,
                commentId: draft.commentId ?? null,
                actorUserId: draft.actorUserId ?? null,
                actorName: draft.actorName ?? null,
                recipientUserId: draft.recipient.userId,
                title,
                body: body ?? null,
                deepLink: draft.deepLink ?? null,
                aggregateKey: draft.aggregateKey,
                aggregateCount: nextCount,
                dedupeKey: draft.dedupeKey,
                payload: asJson(mergedPayload),
                createdAt: draft.createdAt ?? now,
                lastEventAt: now,
              },
            })
            notificationId = created.id
          }
        } else {
          const created = await tx.userNotification.create({
            data: {
              eventType: draft.eventType,
              category: draft.category,
              teamId: draft.teamId,
              projectId: draft.projectId ?? null,
              videoId: draft.videoId ?? null,
              commentId: draft.commentId ?? null,
              actorUserId: draft.actorUserId ?? null,
              actorName: draft.actorName ?? null,
              recipientUserId: draft.recipient.userId,
              title: draft.title,
              body: draft.body ?? null,
              deepLink: draft.deepLink ?? null,
              aggregateKey: null,
              aggregateCount: 1,
              dedupeKey: draft.dedupeKey,
              payload: asJson(basePayload),
              createdAt: draft.createdAt ?? now,
              lastEventAt: now,
            },
          })
          notificationId = created.id
        }

        await tx.userNotificationEvent.updateMany({
          where: { dedupeKey: draft.dedupeKey, notificationId: null },
          data: { notificationId },
        })
        await tx.userNotificationDelivery.upsert({
          where: {
            notificationId_channel_recipient: {
              notificationId,
              channel: 'IN_APP',
              recipient: draft.recipient.userId,
            },
          },
          create: {
            notificationId,
            channel: 'IN_APP',
            recipient: draft.recipient.userId,
            success: true,
          },
          update: { success: true, sentAt: now, error: null },
        })
        written += 1
      }

      return {
        insertedEvents: fresh.length,
        writtenNotifications: written,
        recipients: new Set(fresh.map((draft) => draft.recipient.userId)).size,
      }
    },
    { timeout: 20_000 },
  )
}

export interface CommentNotificationInput {
  comment: {
    id: string
    projectId: string
    videoId: string
    videoVersion?: number | null
    parentId?: string | null
    userId?: string | null
    authorEmail?: string | null
    authorName?: string | null
    content: string
    timecode: string
    visibility?: string | null
    createdAt?: Date
  }
  mentionedUserIds?: string[] | null
}

export async function emitCommentInAppNotifications(
  input: CommentNotificationInput,
): Promise<EmitInAppResult> {
  const { comment } = input
  try {
    const project = await loadNotificationProject(comment.projectId)
    if (!project) return { insertedEvents: 0, writtenNotifications: 0, recipients: 0 }

    const [video, parent] = await Promise.all([
      prisma.video.findUnique({
        where: { id: comment.videoId },
        select: { name: true, version: true, versionLabel: true, fps: true },
      }),
      comment.parentId
        ? prisma.comment.findUnique({
            where: { id: comment.parentId },
            select: { userId: true, authorEmail: true, visibility: true },
          })
        : Promise.resolve(null),
    ])

    const actorEmail = comment.authorEmail?.trim().toLowerCase()
    const viewers = (await resolveProjectViewers(comment.projectId, { excludeUserId: comment.userId }))
      .filter((viewer) => !actorEmail || viewer.email?.trim().toLowerCase() !== actorEmail)

    const actorName = comment.authorName?.trim() || '团队成员'
    const videoName = video?.name || '视频'
    const versionLabel = video ? versionLabelOf(video.version, video.versionLabel) : ''
    const deepLink = commentReviewLink({
      projectId: comment.projectId,
      videoName: video?.name,
      version: comment.videoVersion ?? video?.version ?? undefined,
      timecode: comment.timecode,
      fps: video?.fps,
      commentId: comment.id,
    })
    const basePayload: InAppPayload = {
      projectTitle: project.title,
      videoName,
      timecode: comment.timecode,
      versionLabel,
      content: excerpt(comment.content),
      visibility: comment.visibility === 'INTERNAL' ? 'INTERNAL' : 'PUBLIC',
      commentId: comment.id,
      parentId: comment.parentId ?? null,
    }

    const targets = new Map<string, { recipient: InAppRecipient; eventType: 'COMMENT_NEW' | 'COMMENT_REPLY' | 'COMMENT_MENTION' }>()
    if (comment.parentId) {
      const parentAuthor = findParentAuthor(viewers, parent, comment.userId)
      if (parentAuthor) {
        targets.set(parentAuthor.userId, { recipient: parentAuthor, eventType: 'COMMENT_REPLY' })
      }
    } else {
      for (const viewer of viewers) {
        targets.set(viewer.userId, { recipient: viewer, eventType: 'COMMENT_NEW' })
      }
    }

    const mentioned = intersectMentionedViewers(viewers, input.mentionedUserIds, comment.userId)
    for (const recipient of mentioned) {
      targets.set(recipient.userId, { recipient, eventType: 'COMMENT_MENTION' })
    }

    if (targets.size === 0) {
      return { insertedEvents: 0, writtenNotifications: 0, recipients: 0 }
    }

    const actor = actorKey(comment.userId, comment.authorEmail, comment.authorName)
    const bucket = hourBucket(comment.createdAt ?? new Date())
    const drafts: NotificationDraft[] = []

    for (const { recipient, eventType } of targets.values()) {
      if (eventType === 'COMMENT_NEW') {
        drafts.push({
          eventType,
          category: 'TEAM',
          teamId: project.teamId,
          projectId: comment.projectId,
          videoId: comment.videoId,
          commentId: comment.id,
          actorUserId: comment.userId ?? null,
          actorName,
          recipient,
          title: `${actorName} 在《${videoName}》新增了批注`,
          body: excerpt(comment.content),
          deepLink,
          aggregateKey: `comment_batch:${comment.projectId}:${comment.videoId}:${actor}:${bucket}`,
          aggregateTitle: (count) => count === 1
            ? `${actorName} 在《${videoName}》新增了批注`
            : `${actorName} 在《${videoName}》新增了 ${count} 条批注`,
          aggregateBody: () => excerpt(comment.content),
          dedupeKey: `COMMENT_NEW:${comment.id}:${recipient.userId}`,
          payload: basePayload,
          createdAt: comment.createdAt,
        })
      } else if (eventType === 'COMMENT_REPLY') {
        drafts.push({
          eventType,
          category: 'MENTION',
          teamId: project.teamId,
          projectId: comment.projectId,
          videoId: comment.videoId,
          commentId: comment.id,
          actorUserId: comment.userId ?? null,
          actorName,
          recipient,
          title: `${actorName} 回复了你`,
          body: excerpt(comment.content),
          deepLink,
          dedupeKey: `COMMENT_REPLY:${comment.id}:${recipient.userId}`,
          payload: basePayload,
          createdAt: comment.createdAt,
        })
      } else {
        drafts.push({
          eventType,
          category: 'MENTION',
          teamId: project.teamId,
          projectId: comment.projectId,
          videoId: comment.videoId,
          commentId: comment.id,
          actorUserId: comment.userId ?? null,
          actorName,
          recipient,
          title: `${actorName} 在批注中 @了你`,
          body: excerpt(comment.content),
          deepLink,
          aggregateKey: `mention_batch:${comment.projectId}:${actor}:${bucket}`,
          aggregateTitle: (count) => count === 1
            ? `${actorName} 在批注中 @了你`
            : `${actorName} 在 ${count} 条批注里 @了你`,
          aggregateBody: () => excerpt(comment.content),
          dedupeKey: `COMMENT_MENTION:${comment.id}:${recipient.userId}`,
          payload: basePayload,
          createdAt: comment.createdAt,
        })
      }
    }

    return await emitInAppNotifications(drafts)
  } catch (error) {
    logError('[IN-APP-NOTIFICATION] Failed to emit comment notification', error)
    return { insertedEvents: 0, writtenNotifications: 0, recipients: 0 }
  }
}

export interface ClientUploadNotificationInput {
  projectId: string
  fileName: string
  uploaderName?: string | null
  uploaderEmail?: string | null
  uploadId?: string | null
}

export async function emitClientUploadInAppNotification(
  input: ClientUploadNotificationInput,
): Promise<EmitInAppResult> {
  try {
    const project = await loadNotificationProject(input.projectId)
    if (!project) return { insertedEvents: 0, writtenNotifications: 0, recipients: 0 }

    const actorEmail = input.uploaderEmail?.trim().toLowerCase()
    const viewers = (await resolveProjectViewers(input.projectId))
      .filter((viewer) => !actorEmail || viewer.email?.trim().toLowerCase() !== actorEmail)
    if (viewers.length === 0) {
      return { insertedEvents: 0, writtenNotifications: 0, recipients: 0 }
    }

    const actorName = input.uploaderName?.trim() || '客户'
    const actor = actorKey(null, input.uploaderEmail, input.uploaderName || input.uploadId)
    const bucket = hourBucket()
    const deepLink = projectFilesLink(input.projectId)
    const payload: InAppPayload = {
      projectTitle: project.title,
      fileNames: [input.fileName],
      count: 1,
    }

    const drafts: NotificationDraft[] = viewers.map((recipient) => ({
      eventType: 'CLIENT_UPLOAD',
      category: 'TEAM',
      teamId: project.teamId,
      projectId: input.projectId,
      actorUserId: null,
      actorName,
      recipient,
      title: `${actorName} 上传了文件`,
      body: `文件：${input.fileName}`,
      deepLink,
      aggregateKey: `upload_batch:${input.projectId}:${actor}:${bucket}`,
      aggregateTitle: (count) => count === 1
        ? `${actorName} 上传了文件`
        : `${actorName} 上传了 ${count} 个文件`,
      aggregateBody: (_count, merged) => {
        const files = Array.isArray(merged?.fileNames) ? merged.fileNames : [input.fileName]
        return files.length ? `文件：${formatFileList(files)}` : null
      },
      dedupeKey: `CLIENT_UPLOAD:${input.uploadId || input.fileName}:${recipient.userId}`,
      payload,
    }))

    return await emitInAppNotifications(drafts)
  } catch (error) {
    logError('[IN-APP-NOTIFICATION] Failed to emit client upload notification', error)
    return { insertedEvents: 0, writtenNotifications: 0, recipients: 0 }
  }
}

export async function emitVideoReadyInAppNotification(videoId: string): Promise<EmitInAppResult> {
  try {
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      select: {
        id: true,
        projectId: true,
        name: true,
        version: true,
        versionLabel: true,
        fps: true,
        uploadedBy: true,
        uploadedByName: true,
        createdAt: true,
        project: { select: { title: true, teamId: true } },
      },
    })
    if (!video) return { insertedEvents: 0, writtenNotifications: 0, recipients: 0 }

    const actorUserId = video.uploadedBy && video.uploadedBy !== 'client' ? video.uploadedBy : null
    const viewers = await resolveProjectViewers(video.projectId, { excludeUserId: actorUserId })
    if (viewers.length === 0) {
      return { insertedEvents: 0, writtenNotifications: 0, recipients: 0 }
    }

    const actorName = video.uploadedByName?.trim() || '团队成员'
    const actor = actorKey(actorUserId, null, video.uploadedByName)
    const label = versionLabelOf(video.version, video.versionLabel)
    const isVersion = video.version > 1
    const deepLink = commentReviewLink({
      projectId: video.projectId,
      videoName: video.name,
      version: video.version,
      fps: video.fps,
    })
    const payload: InAppPayload = {
      projectTitle: video.project.title,
      videoName: video.name,
      versionLabel: label,
    }
    const bucket = hourBucket()
    const drafts: NotificationDraft[] = viewers.map((recipient) => (
      isVersion
        ? {
            eventType: 'VIDEO_VERSION',
            category: 'TEAM',
            teamId: video.project.teamId,
            projectId: video.projectId,
            videoId: video.id,
            actorUserId,
            actorName,
            recipient,
            title: `${actorName} 更新了《${video.name}》到 ${label}`,
            body: `项目：${video.project.title}`,
            deepLink,
            dedupeKey: `VIDEO_VERSION:${video.id}:${recipient.userId}`,
            payload,
            createdAt: video.createdAt,
          }
        : {
            eventType: 'VIDEO_UPLOADED',
            category: 'TEAM',
            teamId: video.project.teamId,
            projectId: video.projectId,
            videoId: video.id,
            actorUserId,
            actorName,
            recipient,
            title: `${actorName} 上传了《${video.name}》`,
            body: `项目：${video.project.title}`,
            deepLink,
            aggregateKey: `upload_batch:${video.projectId}:${actor}:${bucket}`,
            aggregateTitle: (count) => count === 1
              ? `${actorName} 上传了《${video.name}》`
              : `${actorName} 上传了 ${count} 个视频`,
            aggregateBody: (_count, merged) => {
              const files = Array.isArray(merged?.fileNames) ? merged.fileNames : [video.name]
              return files.length ? `文件：${formatFileList(files)}` : null
            },
            dedupeKey: `VIDEO_UPLOADED:${video.id}:${recipient.userId}`,
            payload: { ...payload, fileNames: [video.name] },
            createdAt: video.createdAt,
          }
    ))

    return await emitInAppNotifications(drafts)
  } catch (error) {
    logError('[IN-APP-NOTIFICATION] Failed to emit video ready notification', error)
    return { insertedEvents: 0, writtenNotifications: 0, recipients: 0 }
  }
}

export interface ApprovalNotificationInput {
  projectId: string
  videoId?: string | null
  approved: boolean
  isComplete?: boolean
  actorUserId?: string | null
  actorName?: string | null
  occurredAt?: Date
}

export async function emitApprovalInAppNotification(
  input: ApprovalNotificationInput,
): Promise<EmitInAppResult> {
  try {
    const project = await loadNotificationProject(input.projectId)
    if (!project) return { insertedEvents: 0, writtenNotifications: 0, recipients: 0 }

    const video = input.videoId
      ? await prisma.video.findUnique({
          where: { id: input.videoId },
          select: { id: true, name: true, version: true, versionLabel: true, fps: true },
        })
      : null

    const recipients = await resolveProjectLeads(input.projectId, { excludeUserId: input.actorUserId })
    if (recipients.length === 0) {
      return { insertedEvents: 0, writtenNotifications: 0, recipients: 0 }
    }

    const actorName = input.actorName?.trim() || '团队成员'
    const occurredAt = input.occurredAt ?? new Date()
    const eventType = input.approved
      ? input.isComplete
        ? 'PROJECT_APPROVED'
        : 'VIDEO_APPROVED'
      : video
        ? 'VIDEO_UNAPPROVED'
        : 'PROJECT_UNAPPROVED'
    const label = video ? versionLabelOf(video.version, video.versionLabel) : ''
    const title = input.approved
      ? input.isComplete
        ? `《${project.title}》已全部通过`
        : `${actorName} 通过了《${video?.name || project.title}》${label ? ` ${label}` : ''}`
      : video
        ? `${actorName} 取消了《${video.name}》的通过状态`
        : `${actorName} 将《${project.title}》退回审阅`
    const deepLink = video
      ? commentReviewLink({
          projectId: project.id,
          videoName: video.name,
          version: video.version,
          fps: video.fps,
        })
      : projectFilesLink(project.id)
    const payload: InAppPayload = {
      projectTitle: project.title,
      ...(video?.name ? { videoName: video.name } : {}),
      ...(label ? { versionLabel: label } : {}),
    }

    const drafts: NotificationDraft[] = recipients.map((recipient) => ({
      eventType,
      category: 'TEAM',
      teamId: project.teamId,
      projectId: project.id,
      videoId: video?.id ?? null,
      actorUserId: input.actorUserId ?? null,
      actorName,
      recipient,
      title,
      body: `项目：${project.title}`,
      deepLink,
      dedupeKey: `${eventType}:${video?.id || project.id}:${occurredAt.toISOString()}:${recipient.userId}`,
      payload,
      createdAt: occurredAt,
    }))

    return await emitInAppNotifications(drafts)
  } catch (error) {
    logError('[IN-APP-NOTIFICATION] Failed to emit approval notification', error)
    return { insertedEvents: 0, writtenNotifications: 0, recipients: 0 }
  }
}

export interface DueDateNotificationInput {
  projectId: string
  dueDate: Date
  reminderType: string
  dayKey: string
}

export async function emitDueDateInAppNotification(
  input: DueDateNotificationInput,
): Promise<EmitInAppResult> {
  try {
    const project = await loadNotificationProject(input.projectId)
    if (!project) return { insertedEvents: 0, writtenNotifications: 0, recipients: 0 }

    const recipients = await resolveProjectViewers(input.projectId)
    if (recipients.length === 0) {
      return { insertedEvents: 0, writtenNotifications: 0, recipients: 0 }
    }

    const due = input.dueDate.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'Asia/Shanghai',
    })
    const title = `《${project.title}》即将到期`
    const deepLink = projectFilesLink(project.id)
    const payload: InAppPayload = { projectTitle: project.title, dueDate: due }

    const drafts: NotificationDraft[] = recipients.map((recipient) => ({
      eventType: 'DUE_DATE_REMINDER',
      category: 'TEAM',
      teamId: project.teamId,
      projectId: project.id,
      actorUserId: null,
      actorName: '系统',
      recipient,
      title,
      body: `截止 ${due}`,
      deepLink,
      dedupeKey: `DUE_DATE_REMINDER:${project.id}:${input.reminderType}:${input.dayKey}:${recipient.userId}`,
      payload,
    }))

    return await emitInAppNotifications(drafts)
  } catch (error) {
    logError('[IN-APP-NOTIFICATION] Failed to emit due date notification', error)
    return { insertedEvents: 0, writtenNotifications: 0, recipients: 0 }
  }
}

export function logInAppEmitResult(label: string, result: EmitInAppResult): void {
  if (result.insertedEvents > 0) {
    logMessage(
      `[IN-APP-NOTIFICATION] ${label}: ${result.insertedEvents} event(s), ${result.writtenNotifications} notification row(s), ${result.recipients} recipient(s)`,
    )
  }
}
