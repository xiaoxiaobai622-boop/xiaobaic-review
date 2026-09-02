import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForUser } from '@/lib/feishu'
import { prisma } from '@/lib/db'
import { logError, logMessage } from '@/lib/logging'
import { encrypt } from '@/lib/encryption'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Build an absolute redirect URL from the public app origin. Inside Docker,
 * request.url resolves to http://localhost:4321, which the user's browser
 * cannot reach.
 */
function redirectTo(path: string): NextResponse {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://mle6.cn').replace(/\/$/, '')
  return NextResponse.redirect(`${base}${path}`)
}

/**
 * GET /api/auth/feishu/callback
 *
 * Feishu OAuth callback. Receives authorization code and creates/updates binding.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const state = searchParams.get('state')

    // Validate state to prevent CSRF
    const storedState = request.cookies.get('feishu_oauth_state')?.value
    const storedUserId = request.cookies.get('feishu_oauth_user_id')?.value

    if (!code || !state || !storedState || state !== storedState || !storedUserId) {
      return redirectTo('/profile?feishu_error=invalid_state')
    }

    // Exchange code for user info
    const feishuUser = await exchangeCodeForUser(code)

    // Create or update binding
    await prisma.feishuBinding.upsert({
      where: { userId: storedUserId },
      create: {
        userId: storedUserId,
        openId: feishuUser.openId,
        unionId: feishuUser.unionId,
        tenantKey: feishuUser.tenantKey,
        nickname: feishuUser.name,
        avatarUrl: feishuUser.avatarUrl,
        userAccessTokenEncrypted: feishuUser.userAccessToken ? encrypt(feishuUser.userAccessToken) : null,
        refreshTokenEncrypted: feishuUser.refreshToken ? encrypt(feishuUser.refreshToken) : null,
        tokenExpiresAt: feishuUser.expiresIn ? new Date(Date.now() + feishuUser.expiresIn * 1000) : null,
      },
      update: {
        openId: feishuUser.openId,
        unionId: feishuUser.unionId,
        tenantKey: feishuUser.tenantKey,
        nickname: feishuUser.name,
        avatarUrl: feishuUser.avatarUrl,
        userAccessTokenEncrypted: feishuUser.userAccessToken ? encrypt(feishuUser.userAccessToken) : undefined,
        refreshTokenEncrypted: feishuUser.refreshToken ? encrypt(feishuUser.refreshToken) : undefined,
        tokenExpiresAt: feishuUser.expiresIn ? new Date(Date.now() + feishuUser.expiresIn * 1000) : undefined,
      },
    })

    logMessage(`User ${storedUserId} bound Feishu account: ${feishuUser.openId}`)

    // Clear OAuth cookies
    const response = redirectTo('/profile?feishu_success=true')
    response.cookies.delete('feishu_oauth_state')
    response.cookies.delete('feishu_oauth_user_id')

    return response
  } catch (error) {
    logError('Feishu OAuth callback error:', error)
    return redirectTo('/profile?feishu_error=failed')
  }
}
