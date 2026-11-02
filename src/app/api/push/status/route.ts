import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePushActor } from '@/lib/push-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Surface lookup for the device's own push endpoint. The support PWA and the
 * main console share one service worker registration, so the client must ask
 * the server which surface currently owns this endpoint before showing or
 * toggling the subscription.
 */
export async function GET(request: NextRequest) {
  const actor = await requirePushActor(request)
  if (actor instanceof Response) return actor

  const endpoint = request.nextUrl.searchParams.get('endpoint')
  if (!endpoint) {
    return NextResponse.json({ error: 'Missing endpoint' }, { status: 400 })
  }

  const subscription = await prisma.pushSubscription.findFirst({
    where: { endpoint, userId: actor.user.id },
    select: { id: true, deviceName: true, surface: true, subscribedEvents: true },
  })

  return NextResponse.json({
    subscription,
    isPlatformAdmin: actor.isPlatformAdmin,
    isTeamAdmin: actor.isTeamAdmin,
  })
}
