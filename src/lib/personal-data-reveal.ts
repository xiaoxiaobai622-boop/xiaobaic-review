import { prisma } from './db'
import { maskPhone } from './phone-field'

/**
 * Expands a phone number that the list endpoints only ever show masked, and records the access.
 *
 * The event is written straight to the table instead of through `logSecurityEvent`, because that
 * helper honours the security-log switch — an account allowed to read numbers would otherwise be
 * able to turn the switch off first and read them silently. Only the masked form is stored: the
 * audit trail must not become a second, unencrypted copy of the number.
 */
export async function revealPhoneNumber(params: {
  kind: 'user' | 'recipient'
  subjectId: string
  stored: string | null | undefined
  actorId: string
  projectId?: string
  ipAddress: string
}): Promise<string | null> {
  await prisma.securityEvent.create({
    data: {
      type: 'PERSONAL_DATA_REVEALED',
      severity: 'WARNING',
      userId: params.actorId,
      projectId: params.projectId,
      ipAddress: params.ipAddress,
      wasBlocked: false,
      details: {
        revealedKind: params.kind,
        revealedId: params.subjectId,
        revealedMasked: maskPhone(params.stored),
      },
    },
  })

  return params.stored ?? null
}
