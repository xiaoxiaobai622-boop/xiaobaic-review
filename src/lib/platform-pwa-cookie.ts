import { NextRequest, NextResponse } from 'next/server'

export const PLATFORM_PWA_REFRESH_COOKIE = 'vidx_platform_refresh'
export const PLATFORM_PWA_REFRESH_MAX_AGE = 12 * 60 * 60

function secureCookie(request: NextRequest) {
  return (
    request.headers.get('x-forwarded-proto') === 'https' ||
    request.nextUrl.protocol === 'https:' ||
    process.env.HTTPS_ENABLED === 'true' ||
    process.env.HTTPS_ENABLED === '1'
  )
}

export function setPlatformPwaRefreshCookie(response: NextResponse, request: NextRequest, refreshToken: string) {
  response.cookies.set({
    name: PLATFORM_PWA_REFRESH_COOKIE,
    value: refreshToken,
    httpOnly: true,
    secure: secureCookie(request),
    sameSite: 'strict',
    path: '/api/platform/auth',
    maxAge: PLATFORM_PWA_REFRESH_MAX_AGE,
  })
}

export function clearPlatformPwaRefreshCookie(response: NextResponse, request: NextRequest) {
  response.cookies.set({
    name: PLATFORM_PWA_REFRESH_COOKIE,
    value: '',
    httpOnly: true,
    secure: secureCookie(request),
    sameSite: 'strict',
    path: '/api/platform/auth',
    maxAge: 0,
  })
}

export function getPlatformPwaRefreshToken(request: NextRequest) {
  return request.cookies.get(PLATFORM_PWA_REFRESH_COOKIE)?.value || null
}

export function isSameOriginPlatformAuthRequest(request: NextRequest) {
  const origin = request.headers.get('origin')
  if (!origin) return true
  try {
    return new URL(origin).host === request.headers.get('host')
  } catch {
    return false
  }
}
