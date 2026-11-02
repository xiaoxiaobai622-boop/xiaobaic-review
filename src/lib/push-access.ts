import { NextRequest, NextResponse } from 'next/server'
import { prisma } from './db'
import { getConsoleUserFromRequest } from './auth'
import { NOTIFICATION_EVENT_TYPES } from './external-notifications/constants'

export type PushActor = {
  user: { id: string; email: string; isPlatformAdmin: boolean }
  isPlatformAdmin: boolean
  isTeamAdmin: boolean
}

export const TEAM_PUSH_EVENT_TYPES = [
  'CLIENT_COMMENT',
  'CLIENT_UPLOAD',
  'VIDEO_APPROVAL',
  'DUE_DATE_REMINDER',
] as const

export const MAIN_PUSH_EVENT_TYPES = NOTIFICATION_EVENT_TYPES.filter(
  (eventType) => !['SUPPORT_NEW_MESSAGE', 'ADMIN_ACCESS', 'SHARE_ACCESS'].includes(eventType),
)

export async function requirePushActor(request: NextRequest): Promise<PushActor | Response> {
  const user = await getConsoleUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const isPlatformAdmin = Boolean(user.isPlatformAdmin)
  const isTeamAdmin = isPlatformAdmin
    ? true
    : (await prisma.teamMember.count({
        where: { userId: user.id, status: 'ACTIVE', role: { in: ['OWNER', 'ADMIN'] } },
      })) > 0

  if (!isPlatformAdmin && !isTeamAdmin) {
    return NextResponse.json({ error: 'Team administrator permission required' }, { status: 403 })
  }

  return {
    user: { id: user.id, email: user.email, isPlatformAdmin },
    isPlatformAdmin,
    isTeamAdmin,
  }
}

export function eventsForPushActor(surface: 'main' | 'support', requested: unknown, actor: PushActor) {
  if (surface === 'support') {
    return actor.isPlatformAdmin ? ['SUPPORT_NEW_MESSAGE'] : []
  }

  const list = Array.isArray(requested)
    ? requested.filter((event): event is string => typeof event === 'string')
    : actor.isPlatformAdmin
      ? MAIN_PUSH_EVENT_TYPES
      : [...TEAM_PUSH_EVENT_TYPES]

  const allowed = new Set<string>(
    actor.isPlatformAdmin ? MAIN_PUSH_EVENT_TYPES : TEAM_PUSH_EVENT_TYPES,
  )
  return list.filter((event) => allowed.has(event))
}
