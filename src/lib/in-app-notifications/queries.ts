import { prisma } from '@/lib/db'
import type { InAppCategory } from './types'

export type NotificationFilter = 'all' | 'unread'

export interface NotificationFeedItem {
  id: string
  eventType: string
  category: InAppCategory
  title: string
  body: string | null
  deepLink: string | null
  actorName: string | null
  projectId: string | null
  videoId: string | null
  commentId: string | null
  aggregateCount: number
  createdAt: string
  lastEventAt: string
  readAt: string | null
  payload: unknown
}

export interface NotificationFeed {
  items: NotificationFeedItem[]
  unread: { TEAM: number; MENTION: number; total: number }
  nextCursor: string | null
}

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 50

function toItem(row: {
  id: string
  eventType: string
  category: string
  title: string
  body: string | null
  deepLink: string | null
  actorName: string | null
  projectId: string | null
  videoId: string | null
  commentId: string | null
  aggregateCount: number
  createdAt: Date
  lastEventAt: Date
  readAt: Date | null
  payload: unknown
}): NotificationFeedItem {
  return {
    id: row.id,
    eventType: row.eventType,
    category: row.category as InAppCategory,
    title: row.title,
    body: row.body,
    deepLink: row.deepLink,
    actorName: row.actorName,
    projectId: row.projectId,
    videoId: row.videoId,
    commentId: row.commentId,
    aggregateCount: row.aggregateCount,
    createdAt: row.createdAt.toISOString(),
    lastEventAt: row.lastEventAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
    payload: row.payload,
  }
}

export async function getNotificationFeed(params: {
  userId: string
  teamId: string
  category?: InAppCategory | null
  filter?: NotificationFilter
  cursor?: string | null
  limit?: number
}): Promise<NotificationFeed> {
  const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const filter = params.filter ?? 'all'
  const where = {
    recipientUserId: params.userId,
    teamId: params.teamId,
    dismissedAt: null,
    ...(params.category ? { category: params.category } : {}),
    ...(filter === 'unread' ? { readAt: null } : {}),
  }

  const [rows, grouping] = await Promise.all([
    prisma.userNotification.findMany({
      where,
      orderBy: [{ lastEventAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    }),
    prisma.userNotification.groupBy({
      by: ['category'],
      where: {
        recipientUserId: params.userId,
        teamId: params.teamId,
        dismissedAt: null,
        readAt: null,
      },
      _count: { _all: true },
    }),
  ])

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const unread = { TEAM: 0, MENTION: 0, total: 0 }
  for (const row of grouping) {
    const count = row._count._all
    if (row.category === 'TEAM') unread.TEAM = count
    if (row.category === 'MENTION') unread.MENTION = count
    unread.total += count
  }

  return {
    items: page.map(toItem),
    unread,
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  }
}

export async function markNotificationsRead(params: {
  userId: string
  teamId: string
  ids?: string[]
  all?: boolean
  category?: InAppCategory | null
}): Promise<number> {
  const now = new Date()
  const result = await prisma.userNotification.updateMany({
    where: {
      recipientUserId: params.userId,
      teamId: params.teamId,
      dismissedAt: null,
      readAt: null,
      ...(params.all ? {} : { id: { in: params.ids ?? [] } }),
      ...(params.category ? { category: params.category } : {}),
    },
    data: { readAt: now, seenAt: now },
  })
  return result.count
}

export async function markNotificationsSeen(params: {
  userId: string
  teamId: string
  ids?: string[]
  all?: boolean
  category?: InAppCategory | null
}): Promise<number> {
  const result = await prisma.userNotification.updateMany({
    where: {
      recipientUserId: params.userId,
      teamId: params.teamId,
      dismissedAt: null,
      seenAt: null,
      ...(params.all ? {} : { id: { in: params.ids ?? [] } }),
      ...(params.category ? { category: params.category } : {}),
    },
    data: { seenAt: new Date() },
  })
  return result.count
}

export async function markNotificationClicked(params: {
  userId: string
  teamId: string
  id: string
}): Promise<void> {
  await prisma.userNotification.updateMany({
    where: {
      id: params.id,
      recipientUserId: params.userId,
      teamId: params.teamId,
    },
    data: { clickedAt: new Date() },
  })
}
