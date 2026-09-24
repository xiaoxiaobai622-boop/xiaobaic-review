import { NextRequest, NextResponse } from 'next/server'
import { verifyPasskeyAuthentication } from '@/lib/passkey'
import { checkRateLimit, incrementRateLimit, clearRateLimit } from '@/lib/rate-limit'
import { getClientIpAddress } from '@/lib/utils'
import type { AuthenticationResponseJSON } from '@simplewebauthn/browser'
import { issueAdminTokens } from '@/lib/auth'
import { enqueueExternalNotification } from '@/lib/external-notifications/enqueueExternalNotification'
import { getAppUrl, buildFailedLoginLink } from '@/lib/url'
import { safeParseBody } from '@/lib/validation'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import { logError } from '@/lib/logging'
import { getAdminDeviceFingerprint } from '@/lib/studio-device'

export const runtime = 'nodejs'




// POST /api/auth/passkey/authenticate/verify
export async function POST(request: NextRequest) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const authMessages = messages?.auth || {}

  try {
    const parsed = await safeParseBody(request)
    if (!parsed.success) return parsed.response
    const body = parsed.data
    const response = body.response as AuthenticationResponseJSON
    const sessionId = body.sessionId as string | undefined

    if (!response || !response.id) {
      return NextResponse.json(
        { success: false, error: authMessages.invalidAuthenticationResponse || 'Invalid authentication response' },
        { status: 400 }
      )
    }

    // Rate limit tied to IP for usernameless auth
    const ipAddress = getClientIpAddress(request)
    const rateLimitCheck = await checkRateLimit(request, 'login', ipAddress)
    if (rateLimitCheck.limited) {
      return NextResponse.json(
        {
          success: false,
          error: authMessages.tooManyFailedLoginAttemptsGeneric || 'Too many failed login attempts. Please try again later.',
          retryAfter: rateLimitCheck.retryAfter,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateLimitCheck.retryAfter || 900),
          },
        }
      )
    }

    const result = await verifyPasskeyAuthentication(response, sessionId, ipAddress)

    if (!result.success || !result.user) {
      const { lockedOut } = await incrementRateLimit(request, 'login', ipAddress)

      if (lockedOut) {
        const lockoutBody = authMessages.adminLoginLockedOutAfterTooManyAttempts || 'Admin login locked out after too many failed attempts'
        void enqueueExternalNotification({
          eventType: 'SECURITY_ALERT',
          title: authMessages.securityAlertTitle || 'Security Alert',
          body: lockoutBody,
          notifyType: 'failure',
          pushData: {
            ip: ipAddress,
            title: authMessages.securityAlertTitle || 'Security Alert',
            body: lockoutBody,
          },
        }).catch(() => {})
      } else {
        const baseUrl = await getAppUrl(request).catch(() => '')
        const link = buildFailedLoginLink(request, baseUrl)
        const attemptBody = authMessages.someoneTriedToLogInViaPasskey || 'Someone tried to log in via passkey'
        void enqueueExternalNotification({
          eventType: 'ADMIN_ACCESS',
          title: authMessages.failedLoginAttemptTitle || 'Failed Login Attempt',
          body: [attemptBody, link ? `Link: ${link}` : null].filter(Boolean).join('\n'),
          notifyType: 'warning',
          pushData: {
            ip: ipAddress,
            title: authMessages.failedLoginAttemptTitle || 'Failed Login Attempt',
            body: attemptBody,
          },
        }).catch(() => {})
      }

      return NextResponse.json(
        { success: false, error: result.error || authMessages.authenticationFailed || 'Authentication failed' },
        { status: 401 }
      )
    }

    // SUCCESSFUL LOGIN: Clear rate limit
    await clearRateLimit(request, 'login', ipAddress)

    const fingerprint = getAdminDeviceFingerprint(request)
    const tokens = await issueAdminTokens(result.user, fingerprint)

    const loginBody = authMessages.userLoggedInViaPasskey?.replace('{user}', result.user.name || result.user.email)
      || `${result.user.name || result.user.email} logged in via passkey`

    void enqueueExternalNotification({
      eventType: 'ADMIN_ACCESS',
      title: authMessages.adminLogin || 'Admin Login',
      body: loginBody,
      notifyType: 'info',
      pushData: {
        email: result.user.email,
        ip: ipAddress,
        title: authMessages.adminLogin || 'Admin Login',
        body: loginBody,
      },
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        role: result.user.role,
      },
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessExpiresAt: tokens.accessExpiresAt,
        refreshExpiresAt: tokens.refreshExpiresAt,
      },
    })
  } catch (error) {
    logError('[PASSKEY] Authentication verification error:', error)

    return NextResponse.json(
      {
        success: false,
        error: authMessages.failedToVerifyPasskeyAuthentication || 'Failed to verify PassKey authentication',
      },
      { status: 500 }
    )
  }
}
