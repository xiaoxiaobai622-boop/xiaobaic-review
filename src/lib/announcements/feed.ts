import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  isBroadcastAudience,
  loadUserAudienceContext,
  summarizeAudience,
  userMatchesAudience,
  type AudienceRuleRecord,
  type AudienceSource,
} from './audience'
import { getAnnouncementControl, toPublicControl } from './control'
import {
  ANNOUNCEMENT_FEED_LIMIT,
  ANNOUNCEMENT_HISTORY_PAGE_MAX,
  ANNOUNCEMENT_HISTORY_PAGE_SIZE,
} from './constants'
import { syncAnnouncementLifecycles } from './lifecycle'
import { announcementNow, beijingDayKey, startOfBeijingDay } from './time'

export type AnnouncementWithRules = Prisma.PlatformAnnouncementGetPayload<{ include: { rules: true } }>

export interface AnnouncementFeedItem {
  id: string
  title: string
  content: string
  createdAt: Date
  broadcast: boolean
  readAt: Date | null
  acknowledgedAt: Date | null
  dismissedAt: Date | null
  lastShownAt: Date | null
  shownCount: number
  impressionCount: number
  isTest: boolean
  locale: string
  type: string
  status: string
  primaryMode: string
  priority: number
  startAt: Date | null
  endAt: Date | null
  ackRequired: boolean
  ctaLabel: string | null
  ctaUrl: string | null
  imageUrl: string | null
  publishedAt: Date | null
  active: boolean
  audienceSummary: string
}

export interface AnnouncementFeedPayload {
  items: AnnouncementFeedItem[]
  unread: number
  serverNow: Date
  beijingDay: string
  modalShownToday: number
  control: ReturnType<typeof toPublicControl>
  historyNextCursor: string | null
  historyHasMore: boolean
}

export interface AnnouncementHistoryPagePayload {
  items: AnnouncementFeedItem[]
  serverNow: Date
  beijingDay: string
  historyNextCursor: string | null
  historyHasMore: boolean
}

export function audienceSourceOf(announcement: {
  userId: string | null
  rules?: AudienceRuleRecord[]
}): AudienceSource {
  return {
    userId: announcement.userId,
    rules: (announcement.rules ?? []).map((rule) => ({
      kind: rule.kind,
      value: rule.value,
      mode: rule.mode,
    })),
  }
}

export function isAnnouncementInInboxWindow(
  announcement: { status: string; publishedAt: Date | null; startAt: Date | null },
  now: Date,
): boolean {
  if (!announcement.publishedAt) return false
  if (!['ACTIVE', 'PAUSED', 'EXPIRED', 'ARCHIVED'].includes(announcement.status)) return false
  if (announcement.startAt && announcement.startAt.getTime() > now.getTime()) return false
  return true
}

function isAnnouncementActive(
  announcement: { status: string; startAt: Date | null; endAt: Date | null },
  now: Date,
): boolean {
  if (announcement.status !== 'ACTIVE') return false
  if (announcement.startAt && announcement.startAt.getTime() > now.getTime()) return false
  if (announcement.endAt && announcement.endAt.getTime() <= now.getTime()) return false
  return true
}

function sortFeed(items: AnnouncementFeedItem[]): AnnouncementFeedItem[] {
  return items.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority
    const aTime = a.publishedAt?.getTime() ?? a.createdAt.getTime()
    const bTime = b.publishedAt?.getTime() ?? b.createdAt.getTime()
    return bTime - aTime
  })
}

function sortHistory(items: AnnouncementFeedItem[]): AnnouncementFeedItem[] {
  return items.sort((a, b) => {
    const aTime = a.publishedAt?.getTime() ?? a.createdAt.getTime()
    const bTime = b.publishedAt?.getTime() ?? b.createdAt.getTime()
    return bTime - aTime
  })
}

function historyWhere(now: Date): Prisma.PlatformAnnouncementWhereInput {
  return {
    publishedAt: { not: null },
    OR: [
      { status: { in: ['PAUSED', 'EXPIRED', 'ARCHIVED'] } },
      { status: 'ACTIVE', endAt: { lte: now } },
    ],
    AND: [{ OR: [{ startAt: null }, { startAt: { lte: now } }] }],
  }
}

const historyOrderBy: Prisma.PlatformAnnouncementOrderByWithRelationInput[] = [
  { publishedAt: 'desc' },
  { id: 'desc' },
]

function mapFeedItems(
  visible: AnnouncementWithRules[],
  stateByAnnouncement: Map<string, {
    readAt: Date | null
    acknowledgedAt: Date | null
    dismissedAt: Date | null
    lastShownAt: Date | null
    shownCount: number
    impressionCount: number
  }>,
  now: Date,
): AnnouncementFeedItem[] {
  return visible.map((announcement): AnnouncementFeedItem => {
    const state = stateByAnnouncement.get(announcement.id)
    return {
      id: announcement.id,
      title: announcement.title,
      content: announcement.content,
      createdAt: announcement.createdAt,
      broadcast: isBroadcastAudience(audienceSourceOf(announcement)),
      readAt: state?.readAt ?? null,
      acknowledgedAt: state?.acknowledgedAt ?? null,
      dismissedAt: state?.dismissedAt ?? null,
      lastShownAt: state?.lastShownAt ?? null,
      shownCount: state?.shownCount ?? 0,
      impressionCount: state?.impressionCount ?? 0,
      isTest: announcement.isTest,
      locale: announcement.locale,
      type: announcement.type,
      status: announcement.status,
      primaryMode: announcement.primaryMode,
      priority: announcement.priority,
      startAt: announcement.startAt,
      endAt: announcement.endAt,
      ackRequired: announcement.ackRequired,
      ctaLabel: announcement.ctaLabel,
      ctaUrl: announcement.ctaUrl,
      imageUrl: announcement.imageUrl,
      publishedAt: announcement.publishedAt,
      active: isAnnouncementActive(announcement, now),
      audienceSummary: summarizeAudience(audienceSourceOf(announcement)),
    }
  })
}

/**
 * One feed for inbox, banner, modal and toast. INBOX keeps paused/expired/
 * archived history; the host only acts on items whose `active` flag is true.
 */
export async function loadAnnouncementFeed(userId: string): Promise<AnnouncementFeedPayload | null> {
  await syncAnnouncementLifecycles()

  const now = announcementNow()
  const context = await loadUserAudienceContext(userId)
  if (!context) return null

  const startWindow: Prisma.PlatformAnnouncementWhereInput[] = [
    { startAt: null },
    { startAt: { lte: now } },
  ]

  const [activeCandidates, historyCandidates, control] = await Promise.all([
    prisma.platformAnnouncement.findMany({
      where: {
        status: 'ACTIVE',
        publishedAt: { not: null },
        OR: startWindow,
        AND: [{ OR: [{ endAt: null }, { endAt: { gt: now } }] }],
      },
      orderBy: [{ priority: 'desc' }, { publishedAt: 'desc' }, { createdAt: 'desc' }],
      take: ANNOUNCEMENT_FEED_LIMIT,
      include: { rules: true },
    }),
    prisma.platformAnnouncement.findMany({
      where: historyWhere(now),
      orderBy: historyOrderBy,
      take: ANNOUNCEMENT_HISTORY_PAGE_SIZE + 1,
      include: { rules: true },
    }),
    getAnnouncementControl(),
  ])

  const historyHasMore = historyCandidates.length > ANNOUNCEMENT_HISTORY_PAGE_SIZE
  const historyPageCandidates = historyCandidates.slice(0, ANNOUNCEMENT_HISTORY_PAGE_SIZE)
  const historyNextCursor = historyHasMore && historyPageCandidates.length > 0
    ? historyPageCandidates[historyPageCandidates.length - 1].id
    : null

  const candidates = new Map<string, AnnouncementWithRules>()
  for (const announcement of [...activeCandidates, ...historyPageCandidates]) {
    candidates.set(announcement.id, announcement)
  }

  // Per-announcement evaluation failures must not blank the entire inbox.
  const visible = Array.from(candidates.values()).filter((announcement) => {
    try {
      return isAnnouncementInInboxWindow(announcement, now)
        && userMatchesAudience(context, audienceSourceOf(announcement))
    } catch {
      return false
    }
  })

  const ids = visible.map((announcement) => announcement.id)
  const [states, modalShownToday] = await Promise.all([
    ids.length > 0
      ? prisma.platformAnnouncementRead.findMany({
          where: { userId, announcementId: { in: ids } },
        })
      : Promise.resolve([]),
    prisma.platformAnnouncementRead.count({
      where: {
        userId,
        lastShownAt: { gte: startOfBeijingDay(now) },
        announcement: { primaryMode: 'MODAL' },
      },
    }),
  ])

  const stateByAnnouncement = new Map(states.map((state) => [state.announcementId, state]))
  const items = sortFeed(mapFeedItems(visible, stateByAnnouncement, now))

  return {
    items,
    unread: items.filter((item) => !item.readAt).length,
    serverNow: now,
    beijingDay: beijingDayKey(now),
    modalShownToday,
    control: toPublicControl(control),
    historyNextCursor,
    historyHasMore,
  }
}

/**
 * Cursor page for older INBOX history. It is the same endpoint/payload family,
 * not a second polling channel: the client calls it only on “加载更多”.
 * The cursor is the last candidate examined, which stays valid even when some
 * candidates are filtered out by audience rules.
 */
export async function loadAnnouncementHistoryPage(
  userId: string,
  cursor: string,
  limit: number = ANNOUNCEMENT_HISTORY_PAGE_SIZE,
): Promise<AnnouncementHistoryPagePayload | null> {
  await syncAnnouncementLifecycles()

  const now = announcementNow()
  const context = await loadUserAudienceContext(userId)
  if (!context) return null

  const pageSize = Math.max(1, Math.min(
    ANNOUNCEMENT_HISTORY_PAGE_MAX,
    Number.isFinite(limit) ? Math.trunc(limit) : ANNOUNCEMENT_HISTORY_PAGE_SIZE,
  ))

  const cursorExists = await prisma.platformAnnouncement.findUnique({
    where: { id: cursor },
    select: { id: true },
  })
  if (!cursorExists) {
    return {
      items: [],
      serverNow: now,
      beijingDay: beijingDayKey(now),
      historyNextCursor: null,
      historyHasMore: false,
    }
  }

  const candidates = await prisma.platformAnnouncement.findMany({
    where: historyWhere(now),
    orderBy: historyOrderBy,
    cursor: { id: cursor },
    skip: 1,
    take: pageSize + 1,
    include: { rules: true },
  })

  const historyHasMore = candidates.length > pageSize
  const pageCandidates = candidates.slice(0, pageSize)
  const historyNextCursor = historyHasMore && pageCandidates.length > 0
    ? pageCandidates[pageCandidates.length - 1].id
    : null

  const visible = pageCandidates.filter((announcement) => {
    try {
      return isAnnouncementInInboxWindow(announcement, now)
        && userMatchesAudience(context, audienceSourceOf(announcement))
    } catch {
      return false
    }
  })

  const ids = visible.map((announcement) => announcement.id)
  const states = ids.length > 0
    ? await prisma.platformAnnouncementRead.findMany({
        where: { userId, announcementId: { in: ids } },
      })
    : []
  const stateByAnnouncement = new Map(states.map((state) => [state.announcementId, state]))

  return {
    items: sortHistory(mapFeedItems(visible, stateByAnnouncement, now)),
    serverNow: now,
    beijingDay: beijingDayKey(now),
    historyNextCursor,
    historyHasMore,
  }
}

export async function getVisibleAnnouncementForUser(
  userId: string,
  announcementId: string,
): Promise<AnnouncementWithRules | null> {
  const [context, announcement] = await Promise.all([
    loadUserAudienceContext(userId),
    prisma.platformAnnouncement.findUnique({
      where: { id: announcementId },
      include: { rules: true },
    }),
  ])
  if (!context || !announcement) return null

  const now = announcementNow()
  if (!isAnnouncementInInboxWindow(announcement, now)) return null
  if (!userMatchesAudience(context, audienceSourceOf(announcement))) return null
  return announcement
}

export async function getVisibleAnnouncementsForUser(
  userId: string,
  announcementIds: string[],
): Promise<AnnouncementWithRules[]> {
  if (announcementIds.length === 0) return []
  const [context, announcements] = await Promise.all([
    loadUserAudienceContext(userId),
    prisma.platformAnnouncement.findMany({
      where: { id: { in: announcementIds } },
      include: { rules: true },
    }),
  ])
  if (!context) return []

  const now = announcementNow()
  return announcements.filter((announcement) => (
    isAnnouncementInInboxWindow(announcement, now)
    && userMatchesAudience(context, audienceSourceOf(announcement))
  ))
}

export function isAnnouncementActiveNow(announcement: {
  status: string
  startAt: Date | null
  endAt: Date | null
}, now = announcementNow()): boolean {
  return isAnnouncementActive(announcement, now)
}
