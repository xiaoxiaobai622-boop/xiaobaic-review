import { NextRequest, NextResponse } from 'next/server'
import { getAppUrl } from '@/lib/url'
import { ensureProjectMasterLink, formatShareLinkUrl } from '@/lib/share-links'
import { requireApiUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canAccessProject } from '@/lib/project-access'
import { rateLimit } from '@/lib/rate-limit'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const shareMessages = messages?.share || {}

  // Check authentication
  const authResult = await requireApiUser(request)
  if (authResult instanceof Response) {
    return authResult
  }

  // Rate limiting: 60 requests per minute
  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 60,
    message: shareMessages.tooManyRequestsSlowDown || 'Too many requests. Please slow down.'
  }, 'share-url-gen')

  if (rateLimitResult) {
    return rateLimitResult
  }

  try {
    const projectId = new URL(request.url).searchParams.get('projectId')
    if (!projectId) {
      return NextResponse.json({ error: shareMessages.projectIdRequired || 'Project id is required' }, { status: 400 })
    }
    if (!(await canAccessProject(prisma, authResult, projectId))) {
      return NextResponse.json({ error: shareMessages.accessDenied || 'Access denied' }, { status: 403 })
    }

    // Reading the address is what creates it, and it is the same row every
    // notification email carries, so the folder link copied here opens at the
    // root of the domain like any other share address.
    const master = await ensureProjectMasterLink(projectId)
    if (!master) {
      return NextResponse.json({ error: shareMessages.projectNotFound || 'Project not found' }, { status: 404 })
    }

    return NextResponse.json({ shareUrl: formatShareLinkUrl(master.token, await getAppUrl(request)) })
  } catch (error) {
    logError('Error generating share URL:', error)
    return NextResponse.json(
      { error: shareMessages.failedToGenerateShareUrl || 'Failed to generate share URL' },
      { status: 500 }
    )
  }
}
