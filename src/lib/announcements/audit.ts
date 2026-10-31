import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { logError } from '@/lib/logging'

export interface AuditActor {
  id: string
  name?: string | null
  email?: string | null
}

export async function recordAnnouncementAudit(params: {
  announcementId?: string | null
  actor: AuditActor
  action: string
  detail?: Prisma.InputJsonValue
}): Promise<void> {
  const actorLabel = params.actor.name?.trim() || params.actor.email?.trim() || params.actor.id
  try {
    await prisma.announcementAuditLog.create({
      data: {
        announcementId: params.announcementId ?? null,
        actorUserId: params.actor.id,
        actorLabel,
        action: params.action,
        detail: params.detail,
      },
    })
  } catch (error) {
    // An audit write must not turn a successful publish into a 500. The error is
    // logged so a missing trail is still visible to operators.
    logError('[ANNOUNCEMENT AUDIT] write failed:', error)
  }
}

export async function listAnnouncementAudit(announcementId: string, limit = 30) {
  return prisma.announcementAuditLog.findMany({
    where: { announcementId },
    orderBy: { createdAt: 'desc' },
    take: Math.max(1, Math.min(limit, 100)),
  })
}

export async function listGlobalAnnouncementAudit(limit = 100) {
  return prisma.announcementAuditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.max(1, Math.min(limit, 200)),
  })
}
