import { NextRequest, NextResponse } from 'next/server'
import type { AuthenticationResponseJSON } from '@simplewebauthn/browser'
import { prisma } from '@/lib/db'
import { issuePlatformTokens } from '@/lib/auth'
import { verifyPasskeyAuthentication } from '@/lib/passkey'
import { getAdminDeviceFingerprint } from '@/lib/studio-device'
import { getClientIpAddress } from '@/lib/utils'
import { rateLimit } from '@/lib/rate-limit'
import { verifyPlatformTwoFactor } from '@/lib/platform-2fa'
import { setPlatformPwaRefreshCookie } from '@/lib/platform-pwa-cookie'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 20,
    message: '验证过于频繁，请稍后再试',
  }, 'platform-passkey-verify')
  if (limited) return limited

  try {
    const body = (await request.json().catch(() => ({}))) as {
      twoFactorToken?: string
      response?: AuthenticationResponseJSON
      pwa?: boolean
    }
    const payload = verifyPlatformTwoFactor(body.twoFactorToken || '')
    if (!payload) return NextResponse.json({ error: '二次验证已过期，请重新输入密码' }, { status: 401 })
    if (!body.response?.id) return NextResponse.json({ error: '缺少通行密钥响应' }, { status: 400 })

    const result = await verifyPasskeyAuthentication(body.response, undefined, getClientIpAddress(request))
    if (!result.success || !result.user || result.user.id !== payload.userId) {
      return NextResponse.json({ error: result.error || '通行密钥验证失败' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, name: true, role: true, isPlatformAdmin: true },
    })
    if (!user?.isPlatformAdmin) return NextResponse.json({ error: '该账号不是平台管理员' }, { status: 403 })

    const tokens = await issuePlatformTokens(user, getAdminDeviceFingerprint(request))
    const pwa = body.pwa === true
    const response = NextResponse.json({
      success: true,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      tokens: pwa
        ? { accessToken: tokens.accessToken, accessExpiresAt: tokens.accessExpiresAt, sessionId: tokens.sessionId, pwa: true }
        : tokens,
    })
    if (pwa) setPlatformPwaRefreshCookie(response, request, tokens.refreshToken)
    return response
  } catch (error) {
    logError('[PLATFORM PASSKEY] verify failed:', error)
    return NextResponse.json({ error: '通行密钥验证失败' }, { status: 500 })
  }
}
