import type { Prisma } from '@prisma/client'
import { BETA_QUOTA } from './platform-access'

export class SeatLimitError extends Error {
  readonly code = 'SEAT_LIMIT_REACHED'

  constructor() {
    super('Team seat limit reached')
    this.name = 'SeatLimitError'
  }
}

export async function lockTeamSeats(tx: Prisma.TransactionClient, teamId: string) {
  // Serialises every activation for this team. The count below is then stable
  // until the transaction commits, so two concurrent accepts cannot both pass.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${teamId}))`
}

export async function assertSeatAvailable(tx: Prisma.TransactionClient, teamId: string) {
  // Match getTeamQuota's fallback: a missing row means the beta allowance, not
  // the schema default of 10.
  const quota = await tx.teamQuota.findUnique({
    where: { teamId },
    select: { maxMembers: true },
  })
  const maxMembers = quota?.maxMembers ?? BETA_QUOTA.maxMembers
  if (maxMembers <= 0) return

  const active = await tx.teamMember.count({ where: { teamId, status: 'ACTIVE' } })
  if (active >= maxMembers) throw new SeatLimitError()
}
