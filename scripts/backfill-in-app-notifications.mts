import type { Prisma } from '@prisma/client'
import { prisma } from '../src/lib/db'
import { excerpt, commentReviewLink, versionLabelOf } from '../src/lib/in-app-notifications/format'
import {
  findParentAuthor,
  resolveProjectLeads,
  resolveProjectViewers,
} from '../src/lib/in-app-notifications/recipients'
import type { InAppPayload } from '../src/lib/in-app-notifications/types'

const args = new Set(process.argv.slice(2))
const apply = args.has('--apply')
const daysArg = process.argv.find((value) => value.startsWith('--days='))
const days = Math.max(1, Number(daysArg?.split('=')[1] || '30') || 30)
const limitArg = process.argv.find((value) => value.startsWith('--limit='))
const limit = Math.max(1, Number(limitArg?.split('=')[1] || '5000') || 5000)
const since = new Date(Date.now() - days * 86400000)
const readAt = new Date()

interface Row {
  eventType: string
  category: 'TEAM' | 'MENTION'
  teamId: string
  projectId: string
  videoId: string
  commentId: string | null
  actorUserId: string | null
  actorName: string | null
  recipientUserId: string
  title: string
  body: string | null
  deepLink: string | null
  dedupeKey: string
  payload: InAppPayload
  createdAt: Date
  readAt: Date
  seenAt: Date
}

const rows: Row[] = []
const viewerCache = new Map<string, Awaited<ReturnType<typeof resolveProjectViewers>>>()

async function viewersFor(projectId: string) {
  const cached = viewerCache.get(projectId)
  if (cached) return cached
  const viewers = await resolveProjectViewers(projectId)
  viewerCache.set(projectId, viewers)
  return viewers
}

async function buildCommentRows() {
  const comments = await prisma.comment.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: {
      id: true,
      projectId: true,
      videoId: true,
      parentId: true,
      userId: true,
      authorEmail: true,
      authorName: true,
      content: true,
      timecode: true,
      visibility: true,
      createdAt: true,
      parent: { select: { userId: true, authorEmail: true } },
      video: { select: { name: true, version: true, versionLabel: true, fps: true } },
      project: { select: { title: true, teamId: true } },
    },
  })

  for (const comment of comments) {
    const viewers = await viewersFor(comment.projectId)
    const actorEmail = comment.authorEmail?.trim().toLowerCase()
    const eligible = viewers.filter(
      (viewer) => viewer.userId !== comment.userId && viewer.email?.trim().toLowerCase() !== actorEmail,
    )
    const actorName = comment.authorName?.trim() || '团队成员'
    const videoName = comment.video?.name || '视频'
    const versionLabel = comment.video ? versionLabelOf(comment.video.version, comment.video.versionLabel) : ''
    const deepLink = commentReviewLink({
      projectId: comment.projectId,
      videoName: comment.video?.name,
      version: comment.video?.version,
      timecode: comment.timecode,
      fps: comment.video?.fps,
      commentId: comment.id,
    })
    const payload: InAppPayload = {
      projectTitle: comment.project.title,
      videoName,
      timecode: comment.timecode,
      versionLabel,
      content: excerpt(comment.content),
      visibility: comment.visibility === 'INTERNAL' ? 'INTERNAL' : 'PUBLIC',
      backfill: true,
    }

    if (comment.parentId) {
      const parentAuthor = findParentAuthor(eligible, comment.parent, comment.userId)
      if (!parentAuthor) continue
      rows.push({
        eventType: 'COMMENT_REPLY',
        category: 'MENTION',
        teamId: comment.project.teamId,
        projectId: comment.projectId,
        videoId: comment.videoId,
        commentId: comment.id,
        actorUserId: comment.userId,
        actorName,
        recipientUserId: parentAuthor.userId,
        title: `${actorName} 回复了你`,
        body: excerpt(comment.content),
        deepLink,
        dedupeKey: `COMMENT_REPLY:${comment.id}:${parentAuthor.userId}`,
        payload,
        createdAt: comment.createdAt,
        readAt,
        seenAt: readAt,
      })
      continue
    }

    for (const viewer of eligible) {
      rows.push({
        eventType: 'COMMENT_NEW',
        category: 'TEAM',
        teamId: comment.project.teamId,
        projectId: comment.projectId,
        videoId: comment.videoId,
        commentId: comment.id,
        actorUserId: comment.userId,
        actorName,
        recipientUserId: viewer.userId,
        title: `${actorName} 在《${videoName}》新增了批注`,
        body: excerpt(comment.content),
        deepLink,
        dedupeKey: `COMMENT_NEW:${comment.id}:${viewer.userId}`,
        payload,
        createdAt: comment.createdAt,
        readAt,
        seenAt: readAt,
      })
    }
  }
}

async function buildApprovalRows() {
  const videos = await prisma.video.findMany({
    where: { approvedAt: { gte: since } },
    orderBy: { approvedAt: 'asc' },
    take: limit,
    select: {
      id: true,
      projectId: true,
      name: true,
      version: true,
      versionLabel: true,
      fps: true,
      approvedAt: true,
      project: { select: { title: true, teamId: true } },
    },
  })

  for (const video of videos) {
    const leads = await resolveProjectLeads(video.projectId)
    const label = versionLabelOf(video.version, video.versionLabel)
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
      backfill: true,
    }
    const existing = await prisma.userNotification.findMany({
      where: { eventType: 'VIDEO_APPROVED', videoId: video.id },
      select: { recipientUserId: true },
    })
    const existingRecipients = new Set(existing.map((row) => row.recipientUserId))

    for (const lead of leads) {
      if (existingRecipients.has(lead.userId)) continue
      rows.push({
        eventType: 'VIDEO_APPROVED',
        category: 'TEAM',
        teamId: video.project.teamId,
        projectId: video.projectId,
        videoId: video.id,
        commentId: null,
        actorUserId: null,
        actorName: '历史记录',
        recipientUserId: lead.userId,
        title: `《${video.project.title}》中的《${video.name}》已通过`,
        body: `版本：${label}`,
        deepLink,
        dedupeKey: `BACKFILL:VIDEO_APPROVED:${video.id}:${lead.userId}`,
        payload,
        createdAt: video.approvedAt ?? readAt,
        readAt,
        seenAt: readAt,
      })
    }
  }
}

async function main() {
  await buildCommentRows()
  await buildApprovalRows()

  const unique = Array.from(new Map(rows.map((row) => [row.dedupeKey, row])).values())
  const byType = unique.reduce<Record<string, number>>((acc, row) => {
    acc[row.eventType] = (acc[row.eventType] || 0) + 1
    return acc
  }, {})

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    days,
    since: since.toISOString(),
    rows: unique.length,
    byType,
  }, null, 2))

  if (!apply || unique.length === 0) return

  const batchSize = 500
  for (let index = 0; index < unique.length; index += batchSize) {
    const batch = unique.slice(index, index + batchSize)
    await prisma.userNotification.createMany({
      data: batch.map((row) => ({
        eventType: row.eventType,
        category: row.category,
        teamId: row.teamId,
        projectId: row.projectId,
        videoId: row.videoId,
        commentId: row.commentId,
        actorUserId: row.actorUserId,
        actorName: row.actorName,
        recipientUserId: row.recipientUserId,
        title: row.title,
        body: row.body,
        deepLink: row.deepLink,
        aggregateKey: null,
        aggregateCount: 1,
        dedupeKey: row.dedupeKey,
        payload: row.payload as unknown as Prisma.InputJsonValue,
        createdAt: row.createdAt,
        lastEventAt: row.createdAt,
        readAt: row.readAt,
        seenAt: row.seenAt,
      })),
      skipDuplicates: true,
    })
  }

  console.log(`wrote ${unique.length} historical notification row(s), all marked read; no email/push/Apprise sent`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
