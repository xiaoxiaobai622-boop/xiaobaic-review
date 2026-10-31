import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth'
import { recordMemberHeartbeat } from '@/lib/member-activity'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const user = await requireApiUser(request)
  if (user instanceof Response) return user

  // The client already throttles to one call per five minutes; this is only a
  // guard against a tab that reloads in a loop.
  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 12,
    message: 'Too many heartbeat requests. Please slow down.',
  }, 'studio-heartbeat', user.id)
  if (limited) return limited

  const updated = await recordMemberHeartbeat({
    userId: user.id,
    teamId: user.authorizedTeamId,
  })

  const response = NextResponse.json({ ok: true, updated })
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  return response
}
