import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { parseBearerToken } from '@/lib/auth'
import { revokePlatformSession } from '@/lib/platform-session-registry'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const accessToken = parseBearerToken(request)
  const secret = process.env.PLATFORM_JWT_SECRET || process.env.JWT_SECRET
  if (accessToken && secret) {
    try {
      const payload = jwt.verify(accessToken, secret, { algorithms: ['HS256'] }) as { sessionId?: string }
      if (payload.sessionId) await revokePlatformSession(payload.sessionId)
    } catch {}
  }

  return NextResponse.json({ success: true })
}
