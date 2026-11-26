import { prisma } from './db'
import { NextRequest } from 'next/server'
import { headers } from 'next/headers'
import { formatShareLinkUrl, getProjectExplicitShareLink } from './share-links'

/**
 * Get the application URL from request headers
 * Priority: DB settings → Request headers (NextRequest or Server Component) → Error
 * Automatically detects headers from Server Components when request is not provided
 */
export async function getAppUrl(request?: NextRequest): Promise<string> {
  // Empty means "not configured" and "settings row unreadable" alike; both fall
  // through to request-header detection.
  const configuredDomain = await getAppDomain()
  if (configuredDomain) {
    return configuredDomain
  }

  if (request) {
    const proto = request.headers.get('x-forwarded-proto') ||
                  (request.url.startsWith('https') ? 'https' : 'http')
    const host = request.headers.get('x-forwarded-host') ||
                 request.headers.get('host')

    if (host) {
      return `${proto}://${host}`
    }
  }

  try {
    const headersList = await headers()
    const proto = headersList.get('x-forwarded-proto') || 'http'
    const host = headersList.get('x-forwarded-host') ||
                 headersList.get('host')

    if (host) {
      return `${proto}://${host}`
    }
  } catch (error) {
    // Not in a request context
  }

  throw new Error('Unable to determine app URL. Please configure domain in Settings or ensure request headers are available.')
}

/**
 * Get the application domain from settings
 * Falls back to empty string if not configured (NO LOCALHOST)
 */
export async function getAppDomain(): Promise<string> {
  try {
    const settings = await prisma.settings.findUnique({
      where: { id: 'default' },
      select: { appDomain: true },
    })

    if (settings?.appDomain) {
      return settings.appDomain
    }
  } catch (error) {
    // Silent fail
  }

  // Return empty string - NO LOCALHOST FALLBACK
  return ''
}

/**
 * The public address a client notification may carry: an explicit whole-project
 * review link the owner created and can manage in 分享记录. Returns null when the
 * project has none — notifications then skip the client side instead of minting
 * a hidden master link (2026-11-25 决策 1A).
 */
export async function generateProjectExplicitShareUrl(
  projectId: string,
  request?: NextRequest,
): Promise<string | null> {
  const link = await getProjectExplicitShareLink(projectId)
  if (!link) return null
  return formatShareLinkUrl(link.token, await getAppUrl(request))
}

/** Internal, always-available address for admin-facing notifications. */
export async function generateProjectAdminUrl(
  projectId: string,
  request?: NextRequest,
): Promise<string> {
  return `${await getAppUrl(request)}/studio/projects/${projectId}`
}

/**
 * returnUrl is echoed only when the referer is this origin's own /login page,
 * so the notification link cannot point off-site.
 */
export function buildFailedLoginLink(request: NextRequest, baseUrl: string): string | null {
  const fallbackLink = baseUrl ? `${baseUrl}/login` : null
  const referer = request.headers.get('referer') || ''
  if (!baseUrl || !referer) return fallbackLink
  try {
    const ref = new URL(referer)
    if (ref.origin !== baseUrl) return fallbackLink
    if (ref.pathname !== '/login') return fallbackLink
    const returnUrl = ref.searchParams.get('returnUrl')
    if (!returnUrl) return fallbackLink
    return `${baseUrl}/login?returnUrl=${encodeURIComponent(returnUrl)}`
  } catch {
    return fallbackLink
  }
}
