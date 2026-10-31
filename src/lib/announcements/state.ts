import { prisma } from '@/lib/db'
import { isPrimaryMode, type PrimaryMode } from './constants'
import {
  getVisibleAnnouncementForUser,
  getVisibleAnnouncementsForUser,
  isAnnouncementActiveNow,
} from './feed'
import { announcementNow, beijingDayKey } from './time'

export interface ReceiptState {
  id: string
  readAt: Date | null
  acknowledgedAt: Date | null
  dismissedAt: Date | null
  lastShownAt: Date | null
  shownCount: number
  impressionCount: number
}

export type StateActionResult =
  | { ok: true; state?: ReceiptState; marked?: number; counted?: boolean; impressionCreated?: boolean }
  | { ok: false; status: number; code: string; error: string }

function normalizeMode(value: unknown): PrimaryMode {
  return isPrimaryMode(value) ? value : 'INBOX'
}

function stateOf(
  announcementId: string,
  row: {
    readAt: Date | null
    acknowledgedAt: Date | null
    dismissedAt: Date | null
    lastShownAt: Date | null
    shownCount: number
    impressionCount: number
  } | null,
): ReceiptState {
  return {
    id: announcementId,
    readAt: row?.readAt ?? null,
    acknowledgedAt: row?.acknowledgedAt ?? null,
    dismissedAt: row?.dismissedAt ?? null,
    lastShownAt: row?.lastShownAt ?? null,
    shownCount: row?.shownCount ?? 0,
    impressionCount: row?.impressionCount ?? 0,
  }
}

export async function getReceiptState(userId: string, announcementId: string): Promise<ReceiptState | null> {
  const row = await prisma.platformAnnouncementRead.findUnique({
    where: { announcementId_userId: { announcementId, userId } },
  })
  return row ? stateOf(announcementId, row) : null
}

export async function recordRead(
  userId: string,
  announcementIds: string[],
  modeInput: unknown = 'INBOX',
): Promise<StateActionResult> {
  const ids = Array.from(new Set(announcementIds.filter((id) => typeof id === 'string' && id.length > 0))).slice(0, 100)
  if (ids.length === 0) return { ok: false, status: 400, code: 'IDS_REQUIRED', error: 'ids required' }

  const visible = await getVisibleAnnouncementsForUser(userId, ids)
  if (visible.length === 0) return { ok: true, marked: 0 }

  const now = announcementNow()
  const mode = normalizeMode(modeInput)
  const day = beijingDayKey(now)
  const visibleIds = visible.map((announcement) => announcement.id)

  await prisma.$transaction(async (tx) => {
    await tx.platformAnnouncementRead.createMany({
      data: visible.map((announcement) => ({
        announcementId: announcement.id,
        userId,
        readAt: now,
      })),
      skipDuplicates: true,
    })
    await tx.platformAnnouncementRead.updateMany({
      where: { userId, announcementId: { in: visibleIds }, readAt: null },
      data: { readAt: now },
    })
    await tx.announcementEvent.createMany({
      data: visible.map((announcement) => ({
        announcementId: announcement.id,
        userId,
        type: 'READ',
        mode,
        beijingDay: day,
        dedupeKey: `${announcement.id}:${userId}:READ`,
        occurredAt: now,
      })),
      skipDuplicates: true,
    })
  })

  return { ok: true, marked: visibleIds.length }
}

export async function recordAck(
  userId: string,
  announcementId: string,
  modeInput: unknown,
): Promise<StateActionResult> {
  const announcement = await getVisibleAnnouncementForUser(userId, announcementId)
  if (!announcement) return { ok: false, status: 404, code: 'ANNOUNCEMENT_NOT_FOUND', error: '公告不存在或不可见' }

  const now = announcementNow()
  const mode = normalizeMode(modeInput)
  const day = beijingDayKey(now)

  const state = await prisma.$transaction(async (tx) => {
    await tx.platformAnnouncementRead.createMany({
      data: [{ announcementId, userId, readAt: now, acknowledgedAt: now }],
      skipDuplicates: true,
    })
    await tx.platformAnnouncementRead.updateMany({
      where: { announcementId, userId, readAt: null },
      data: { readAt: now },
    })
    await tx.platformAnnouncementRead.updateMany({
      where: { announcementId, userId, acknowledgedAt: null },
      data: { acknowledgedAt: now },
    })
    await tx.announcementEvent.createMany({
      data: [
        {
          announcementId,
          userId,
          type: 'READ',
          mode,
          beijingDay: day,
          dedupeKey: `${announcementId}:${userId}:READ`,
          occurredAt: now,
        },
        {
          announcementId,
          userId,
          type: 'ACK',
          mode,
          beijingDay: day,
          dedupeKey: `${announcementId}:${userId}:ACK`,
          occurredAt: now,
        },
      ],
      skipDuplicates: true,
    })
    return tx.platformAnnouncementRead.findUnique({
      where: { announcementId_userId: { announcementId, userId } },
    })
  })

  return { ok: true, state: stateOf(announcementId, state) }
}

export async function recordDismiss(
  userId: string,
  announcementId: string,
  modeInput: unknown,
): Promise<StateActionResult> {
  const announcement = await getVisibleAnnouncementForUser(userId, announcementId)
  if (!announcement) return { ok: false, status: 404, code: 'ANNOUNCEMENT_NOT_FOUND', error: '公告不存在或不可见' }

  const before = await prisma.platformAnnouncementRead.findUnique({
    where: { announcementId_userId: { announcementId, userId } },
  })
  if (announcement.ackRequired && !before?.acknowledgedAt) {
    return {
      ok: false,
      status: 409,
      code: 'ACK_REQUIRED',
      error: '这条公告需要先点「我已知晓」才能关闭',
    }
  }

  const now = announcementNow()
  const mode = normalizeMode(modeInput)
  const day = beijingDayKey(now)

  const state = await prisma.$transaction(async (tx) => {
    await tx.platformAnnouncementRead.createMany({
      data: [{ announcementId, userId, dismissedAt: now }],
      skipDuplicates: true,
    })
    await tx.platformAnnouncementRead.updateMany({
      where: { announcementId, userId, dismissedAt: null },
      data: { dismissedAt: now },
    })
    await tx.announcementEvent.createMany({
      data: [{
        announcementId,
        userId,
        type: 'DISMISS',
        mode,
        beijingDay: day,
        dedupeKey: `${announcementId}:${userId}:DISMISS`,
        occurredAt: now,
      }],
      skipDuplicates: true,
    })
    return tx.platformAnnouncementRead.findUnique({
      where: { announcementId_userId: { announcementId, userId } },
    })
  })

  return { ok: true, state: stateOf(announcementId, state) }
}

export async function recordImpression(
  userId: string,
  announcementId: string,
  modeInput: unknown,
  sessionIdInput: unknown,
): Promise<StateActionResult> {
  const announcement = await getVisibleAnnouncementForUser(userId, announcementId)
  if (!announcement) return { ok: false, status: 404, code: 'ANNOUNCEMENT_NOT_FOUND', error: '公告不存在或不可见' }

  const now = announcementNow()
  if (!isAnnouncementActiveNow(announcement, now)) {
    return { ok: false, status: 409, code: 'NOT_ACTIVE', error: '公告当前不在生效期' }
  }

  const mode = normalizeMode(modeInput)
  const day = beijingDayKey(now)
  const sessionId = typeof sessionIdInput === 'string' && sessionIdInput.trim()
    ? sessionIdInput.trim().slice(0, 100)
    : `day:${day}`

  const result = await prisma.$transaction(async (tx) => {
    await tx.platformAnnouncementRead.upsert({
      where: { announcementId_userId: { announcementId, userId } },
      create: { announcementId, userId },
      update: { updatedAt: now },
    })

    const eventInsert = await tx.announcementEvent.createMany({
      data: [{
        announcementId,
        userId,
        type: 'IMPRESSION',
        mode,
        beijingDay: day,
        dedupeKey: `${announcementId}:${userId}:IMPRESSION:${mode}:${day}`,
        occurredAt: now,
      }],
      skipDuplicates: true,
    })

    if (eventInsert.count > 0) {
      await tx.platformAnnouncementRead.update({
        where: { announcementId_userId: { announcementId, userId } },
        data: { impressionCount: { increment: eventInsert.count } },
      })
    }

    const shown = await tx.platformAnnouncementRead.updateMany({
      where: {
        announcementId,
        userId,
        OR: [
          { lastShownSessionId: null },
          { lastShownSessionId: { not: sessionId } },
        ],
      },
      data: {
        shownCount: { increment: 1 },
        lastShownAt: now,
        lastShownSessionId: sessionId,
      },
    })

    const state = await tx.platformAnnouncementRead.findUnique({
      where: { announcementId_userId: { announcementId, userId } },
    })
    return { state, impressionCreated: eventInsert.count > 0, shown: shown.count > 0 }
  })

  return {
    ok: true,
    state: stateOf(announcementId, result.state),
    impressionCreated: result.impressionCreated,
  }
}

export async function recordClick(
  userId: string,
  announcementId: string,
  modeInput: unknown,
): Promise<StateActionResult> {
  const announcement = await getVisibleAnnouncementForUser(userId, announcementId)
  if (!announcement) return { ok: false, status: 404, code: 'ANNOUNCEMENT_NOT_FOUND', error: '公告不存在或不可见' }

  const now = announcementNow()
  if (!isAnnouncementActiveNow(announcement, now)) {
    return { ok: false, status: 409, code: 'NOT_ACTIVE', error: '公告当前不在生效期' }
  }

  const mode = normalizeMode(modeInput)
  const day = beijingDayKey(now)
  const inserted = await prisma.announcementEvent.createMany({
    data: [{
      announcementId,
      userId,
      type: 'CLICK',
      mode,
      beijingDay: day,
      dedupeKey: `${announcementId}:${userId}:CLICK:${mode}:${day}`,
      occurredAt: now,
    }],
    skipDuplicates: true,
  })

  return { ok: true, counted: inserted.count > 0 }
}
