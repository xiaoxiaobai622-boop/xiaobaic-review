import { prisma } from './db'

/** A tab may stay open all day; one write per five minutes is enough to date it. */
export const MEMBER_HEARTBEAT_THROTTLE_MS = 5 * 60 * 1000

export function heartbeatCutoff(now: Date = new Date(), throttleMs = MEMBER_HEARTBEAT_THROTTLE_MS): Date {
  return new Date(now.getTime() - throttleMs)
}

/**
 * Records one member's server-side heartbeat. `teamId` is the team the client
 * is currently working in; only that membership is touched, so a user who
 * belongs to two teams cannot make both look active from one tab.
 */
function utcWallClock(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

export async function recordMemberHeartbeat(params: {
  userId: string
  teamId?: string | null
  now?: Date
}): Promise<number> {
  const now = params.now ?? new Date()
  const nowWall = utcWallClock(now)
  const cutoffWall = utcWallClock(heartbeatCutoff(now))

  // Raw SQL on purpose: the row was added by a migration, and a long-running
  // `next dev` can still hold the Prisma client generated before it. The
  // heartbeat must keep working without forcing every reader through a restart.
  const result = params.teamId
    ? await prisma.$executeRaw`
        UPDATE "TeamMember"
        SET "lastActiveAt" = CAST(${nowWall} AS timestamp),
            "updatedAt" = CAST(${nowWall} AS timestamp)
        WHERE "userId" = ${params.userId}
          AND "teamId" = ${params.teamId}
          AND "status" = 'ACTIVE'
          AND ("lastActiveAt" IS NULL OR "lastActiveAt" < CAST(${cutoffWall} AS timestamp))
      `
    : await prisma.$executeRaw`
        UPDATE "TeamMember"
        SET "lastActiveAt" = CAST(${nowWall} AS timestamp),
            "updatedAt" = CAST(${nowWall} AS timestamp)
        WHERE "userId" = ${params.userId}
          AND "status" = 'ACTIVE'
          AND ("lastActiveAt" IS NULL OR "lastActiveAt" < CAST(${cutoffWall} AS timestamp))
      `
  return Number(result)
}
