import { NextRequest } from 'next/server'
import { prisma } from './db'
import { getClientIpAddress } from './utils'

/**
 * Platform-console actions are not security incidents, but they must leave a
 * trail. SecurityEvent is the append-only table already exposed to the console,
 * so we tag these rows with one stable type and keep the action in details.
 */
export async function logPlatformAudit(params: {
  request: NextRequest
  actorId: string
  action: string
  teamId?: string | null
  projectId?: string | null
  targetType?: string
  targetId?: string
  details?: Record<string, unknown>
}): Promise<void> {
  await prisma.securityEvent.create({
    data: {
      type: 'PLATFORM_ADMIN_ACTION',
      severity: 'INFO',
      userId: params.actorId,
      projectId: params.projectId ?? undefined,
      ipAddress: getClientIpAddress(params.request),
      wasBlocked: false,
      details: {
        action: params.action,
        teamId: params.teamId ?? null,
        targetType: params.targetType ?? null,
        targetId: params.targetId ?? null,
        ...params.details,
      },
    },
  })
}
