import type { Prisma, PrismaClient } from '@prisma/client'

type DbClient = PrismaClient | Prisma.TransactionClient

export async function recordTeamAuditEvent(
  db: DbClient,
  params: {
    teamId: string
    actorUserId?: string | null
    targetUserId?: string | null
    action: string
    metadata?: Prisma.InputJsonValue
  },
) {
  await db.teamAuditEvent.create({
    data: {
      teamId: params.teamId,
      actorUserId: params.actorUserId ?? null,
      targetUserId: params.targetUserId ?? null,
      action: params.action,
      metadata: params.metadata ?? undefined,
    },
  })
}
