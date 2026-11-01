import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAuth } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { getRedis } from '@/lib/redis'
import { revokePlatformSession } from '@/lib/platform-session-registry'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const auth = await requirePlatformAuth(request)
  if (auth instanceof Response) return auth
  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 10,
    message: '操作过于频繁',
  }, 'platform-revoke-others', auth.id)
  if (limited) return limited

  const currentSessionId = auth.sessionId
  const redis = getRedis()
  const sessions = await redis.zrange(`platform:sessions:${auth.id}`, 0, -1)
  const others = sessions.filter((sessionId) => sessionId !== currentSessionId)
  await Promise.all(others.map((sessionId) => revokePlatformSession(sessionId)))
  return NextResponse.json({ success: true, revoked: others.length })
}
