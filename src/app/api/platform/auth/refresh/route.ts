import { NextRequest, NextResponse } from 'next/server'
import { refreshPlatformTokens, parseBearerToken } from '@/lib/auth'
import { getAdminDeviceFingerprint } from '@/lib/studio-device'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const refreshToken = parseBearerToken(request, 'x-platform-refresh-token') || parseBearerToken(request)
  if (!refreshToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await refreshPlatformTokens({
    refreshToken,
    fingerprintHash: getAdminDeviceFingerprint(request) || undefined,
  })
  if (!result) return NextResponse.json({ error: '登录已过期，请重新登录' }, { status: 401 })

  return NextResponse.json({ tokens: result })
}
