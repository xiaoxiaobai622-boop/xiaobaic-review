import { NextRequest, NextResponse } from 'next/server'
import { refreshPlatformTokens, parseBearerToken } from '@/lib/auth'
import { getAdminDeviceFingerprint } from '@/lib/studio-device'
import {
  clearPlatformPwaRefreshCookie,
  getPlatformPwaRefreshToken,
  isSameOriginPlatformAuthRequest,
  setPlatformPwaRefreshCookie,
} from '@/lib/platform-pwa-cookie'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const bearerRefresh = parseBearerToken(request, 'x-platform-refresh-token') || parseBearerToken(request)
  const cookieRefresh = bearerRefresh ? null : getPlatformPwaRefreshToken(request)
  const refreshToken = bearerRefresh || cookieRefresh
  if (!refreshToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (cookieRefresh && !isSameOriginPlatformAuthRequest(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const result = await refreshPlatformTokens({
    refreshToken,
    fingerprintHash: getAdminDeviceFingerprint(request) || undefined,
  })
  if (!result) {
    const response = NextResponse.json({ error: '登录已过期，请重新登录' }, { status: 401 })
    if (cookieRefresh) clearPlatformPwaRefreshCookie(response, request)
    return response
  }

  const response = NextResponse.json({
    tokens: cookieRefresh
      ? {
          accessToken: result.accessToken,
          accessExpiresAt: result.accessExpiresAt,
          sessionId: result.sessionId,
          pwa: true,
        }
      : result,
  })
  if (cookieRefresh) setPlatformPwaRefreshCookie(response, request, result.refreshToken)
  return response
}
