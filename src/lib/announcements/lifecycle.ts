import { prisma } from '@/lib/db'
import { announcementNow } from './time'

interface LifecycleAnnouncement {
  status: string
  startAt: Date | null
  endAt: Date | null
}

const SYNC_THROTTLE_MS = 10_000
let lastSyncAt = 0

/**
 * Lazy lifecycle transitions keep the system free of a scheduler: any admin or
 * feed read advances due announcements. The throttle is per process and only
 * avoids hammering two UPDATEs on every 30-second poll.
 */
export async function syncAnnouncementLifecycles(force = false) {
  const wallNow = Date.now()
  if (!force && wallNow - lastSyncAt < SYNC_THROTTLE_MS) {
    return { skipped: true, activated: 0, expired: 0 }
  }
  lastSyncAt = wallNow

  const now = announcementNow()
  const expired = await prisma.platformAnnouncement.updateMany({
    where: {
      status: { in: ['ACTIVE', 'PAUSED', 'SCHEDULED'] },
      endAt: { lte: now },
    },
    data: { status: 'EXPIRED' },
  })

  const activated = await prisma.platformAnnouncement.updateMany({
    where: {
      status: 'SCHEDULED',
      startAt: { lte: now },
      OR: [{ endAt: null }, { endAt: { gt: now } }],
    },
    data: { status: 'ACTIVE' },
  })

  return { skipped: false, activated: activated.count, expired: expired.count }
}

export function isCurrentlyActive(announcement: LifecycleAnnouncement, now = announcementNow()): boolean {
  if (announcement.status !== 'ACTIVE') return false
  if (announcement.startAt && announcement.startAt.getTime() > now.getTime()) return false
  if (announcement.endAt && announcement.endAt.getTime() <= now.getTime()) return false
  return true
}

export function statusAfterResume(announcement: LifecycleAnnouncement, now = announcementNow()): 'SCHEDULED' | 'ACTIVE' | 'EXPIRED' {
  if (announcement.endAt && announcement.endAt.getTime() <= now.getTime()) return 'EXPIRED'
  if (announcement.startAt && announcement.startAt.getTime() > now.getTime()) return 'SCHEDULED'
  return 'ACTIVE'
}

export function statusForPublish(startAt: Date | null, now = announcementNow()): 'SCHEDULED' | 'ACTIVE' {
  return startAt && startAt.getTime() > now.getTime() ? 'SCHEDULED' : 'ACTIVE'
}
