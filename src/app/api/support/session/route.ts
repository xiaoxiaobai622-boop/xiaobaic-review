import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { attachSupportCookie, isSameOriginSupportRequest, resolveSupportVisitor } from '@/lib/support/session'
import { getSupportSettings, supportPublicSettings } from '@/lib/support/settings'
import { supportErrorResponse } from '@/lib/support/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/support/session — establish or resume an anonymous support session. */
export async function POST(request: NextRequest) {
  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 60,
    message: '请求过于频繁，请稍后再试',
  }, 'support-session')
  if (limited) return limited
  if (!isSameOriginSupportRequest(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { visitor, token } = await resolveSupportVisitor(request)
    const settings = await getSupportSettings()
    const response = NextResponse.json({
      visitor: { id: visitor.id, locale: visitor.locale },
      settings: supportPublicSettings(settings),
    })
    if (token) attachSupportCookie(response, token, request)
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch (error) {
    return supportErrorResponse(error)
  }
}
