import { prisma } from './db'
import { NextRequest } from 'next/server'
import { getSecuritySettings } from './video-access'
import { getClientIpAddress } from '@/lib/utils'
import { anonymizeIp } from '@/lib/ip-anonymization'
import { logError } from '@/lib/logging'

/**
 * Read the GDPR analytics consent from the X-Analytics-Consent header.
 * Returns true (accepted), false (declined), or null (not yet decided).
 */
export function readAnalyticsConsent(request: NextRequest): boolean | null {
  const header = request.headers.get('x-analytics-consent')
  if (header === 'true') return true
  if (header === 'false') return false
  return null
}

export async function trackSharePageAccess(params: {
  projectId: string
  accessMethod: 'OTP' | 'PASSWORD' | 'GUEST' | 'NONE'
  email?: string
  sessionId: string
  request: NextRequest
  analyticsConsent?: boolean | null
  shareLinkId?: string | null
}) {
  const { projectId, accessMethod, email, sessionId, request, analyticsConsent, shareLinkId } = params

  // Analytics tracking is optional and should never block share access.
  const settings = await getSecuritySettings()

  const rawIp = getClientIpAddress(request)
  const rawUserAgent = request.headers.get('user-agent') || undefined

  // GDPR: Only store network-identifying PII (IP, user agent) with explicit consent.
  // OTP email is always stored — it's functional auth/audit data, not analytics.
  // The user voluntarily provided it to authenticate; the admin needs the audit trail.
  const hasConsent = analyticsConsent === true
  const ipAddress = hasConsent ? rawIp : anonymizeIp(rawIp)
  const userAgent = hasConsent ? rawUserAgent : undefined

  if (settings.trackAnalytics) {
    try {
      await prisma.sharePageAccess.create({
        data: {
          projectId,
          accessMethod,
          email,
          sessionId,
          shareLinkId: shareLinkId ?? null,
          ipAddress,
          userAgent,
        },
      })
    } catch (error) {
      logError('[ANALYTICS] Failed to track share page access', error)
    }
  }
}
