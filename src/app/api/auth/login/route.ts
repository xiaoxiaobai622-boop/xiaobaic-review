import { NextRequest, NextResponse } from 'next/server'
import { verifyCredentials, issueAdminTokens } from '@/lib/auth'
import { checkRateLimit, incrementRateLimit, clearRateLimit } from '@/lib/rate-limit'
import { validateRequest, loginSchema, safeParseBody } from '@/lib/validation'
import { logSecurityEvent } from '@/lib/video-access'
import { getClientIpAddress } from '@/lib/utils'
import { enqueueExternalNotification } from '@/lib/external-notifications/enqueueExternalNotification'
import { getAppUrl, buildFailedLoginLink } from '@/lib/url'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import { getAdminDeviceFingerprint } from '@/lib/studio-device'
export const runtime = 'nodejs'




export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const authMessages = messages?.auth || {}

  try {
    const parsed = await safeParseBody(request)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    // Validate input first to get the email/username
    const validation = validateRequest(loginSchema, body)
    if (!validation.success) {
      // Don't count validation errors as failed login attempts
      // This prevents attackers from triggering rate limit with invalid input
      return NextResponse.json(
        { error: validation.error, details: validation.details },
        { status: 400 }
      )
    }
    
    const { email, password } = validation.data

    // Check rate limit TIED TO THE USERNAME/EMAIL being attempted
    // This prevents brute-force attacks via browser rotation
    const rateLimitCheck = await checkRateLimit(request, 'login', email)
    if (rateLimitCheck.limited) {
      const ipAddress = getClientIpAddress(request)

      await logSecurityEvent({
        type: 'ADMIN_LOGIN_RATE_LIMIT_HIT',
        severity: 'WARNING',
        ipAddress,
        details: {
          email,
          retryAfter: rateLimitCheck.retryAfter,
        },
        wasBlocked: true,
      })

      return NextResponse.json(
        {
          error: authMessages.tooManyFailedLoginAttempts || 'Too many failed login attempts for this account. Please try again later.',
          retryAfter: rateLimitCheck.retryAfter
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateLimitCheck.retryAfter || 900)
          }
        }
      )
    }

    // Verify credentials (supports both username and email)
    const user = await verifyCredentials(email, password)

    if (!user) {
      // FAILED LOGIN: Increment rate limit counter FOR THIS SPECIFIC USERNAME/EMAIL
      // This prevents attackers from bypassing via browser rotation
      const { lockedOut } = await incrementRateLimit(request, 'login', email)

      const ipAddress = getClientIpAddress(request)
      await logSecurityEvent({
        type: 'ADMIN_PASSWORD_LOGIN_FAILED',
        severity: 'WARNING',
        ipAddress,
        details: {
          email,
        },
        wasBlocked: false,
      })

      if (lockedOut) {
        // Lockout just triggered — send SECURITY_ALERT (not ADMIN_ACCESS)
        const lockoutBody = authMessages.adminLoginLockedOutForEmailAfterTooManyAttempts?.replace('{email}', email)
          || `Admin login locked out for ${email} after too many failed attempts`
        void enqueueExternalNotification({
          eventType: 'SECURITY_ALERT',
          title: authMessages.securityAlertTitle || 'Security Alert',
          body: lockoutBody,
          notifyType: 'failure',
          pushData: {
            email,
            ip: ipAddress,
            title: authMessages.securityAlertTitle || 'Security Alert',
            body: lockoutBody,
          },
        }).catch(() => {})
      } else {
        // Normal failed attempt — send ADMIN_ACCESS warning
        const baseUrl = await getAppUrl(request).catch(() => '')
        const link = buildFailedLoginLink(request, baseUrl)
        const attemptBody = authMessages.someoneTriedToLogInWithEmailViaPassword?.replace('{email}', email)
          || `Someone tried to log in with ${email} via password`
        void enqueueExternalNotification({
          eventType: 'ADMIN_ACCESS',
          title: authMessages.failedLoginAttemptTitle || 'Failed Login Attempt',
          body: [
            attemptBody,
            link ? `Link: ${link}` : null,
          ]
            .filter(Boolean)
            .join('\n'),
          notifyType: 'warning',
          pushData: {
            email,
            ip: ipAddress,
            title: authMessages.failedLoginAttemptTitle || 'Failed Login Attempt',
            body: attemptBody,
          },
        }).catch(() => {})
      }

      return NextResponse.json(
        { error: authMessages.invalidUsernameEmailOrPassword || 'Invalid username/email or password' },
        { status: 401 }
      )
    }

    // SUCCESSFUL LOGIN: Clear rate limit counter for this username/email
    await clearRateLimit(request, 'login', email)

    const fingerprint = getAdminDeviceFingerprint(request)
    const tokens = await issueAdminTokens(user, fingerprint)

    const ipAddress = getClientIpAddress(request)
    await logSecurityEvent({
      type: 'ADMIN_PASSWORD_LOGIN_SUCCESS',
      severity: 'INFO',
      ipAddress,
      details: {
        userId: user.id,
        email: user.email,
      },
      wasBlocked: false,
    })

    const loginBody = authMessages.userLoggedInViaPassword?.replace('{user}', user.name || user.email)
      || `${user.name || user.email} logged in via password`

    void enqueueExternalNotification({
      eventType: 'ADMIN_ACCESS',
      title: authMessages.adminLogin || 'Admin Login',
      body: loginBody,
      notifyType: 'info',
      pushData: {
        email: user.email,
        ip: ipAddress,
        title: authMessages.adminLogin || 'Admin Login',
        body: loginBody,
      },
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        name: user.name,
        avatarUrl: user.avatarUrl,
        onboardingCompleted: user.onboardingCompleted,
        role: user.role,
      },
      needsOnboarding: user.onboardingCompleted === false,
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessExpiresAt: tokens.accessExpiresAt,
        refreshExpiresAt: tokens.refreshExpiresAt,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: authMessages.errorOccurredDuringLogin || 'An error occurred during login' },
      { status: 500 }
    )
  }
}
