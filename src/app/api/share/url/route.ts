import { NextRequest, NextResponse } from 'next/server'
import { generateShareUrl } from '@/lib/url'
import { requireApiUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
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
    const { searchParams } = new URL(request.url)
    const slug = searchParams.get('slug')

    if (!slug) {
      return NextResponse.json({ error: shareMessages.slugRequired || 'Slug is required' }, { status: 400 })
    }

    const project = await prisma.project.findUnique({
      where: { slug },
      select: {
        slug: true,
        shareSlug: true,
        team: { select: { shareKey: true, slug: true } },
      },
    })
    if (!project) {
      return NextResponse.json({ error: shareMessages.slugRequired || 'Project not found' }, { status: 404 })
    }

    const shareUrl = await generateShareUrl(project, request)

    return NextResponse.json({ shareUrl })
  } catch (error) {
    logError('Error generating share URL:', error)
    return NextResponse.json(
      { error: shareMessages.failedToGenerateShareUrl || 'Failed to generate share URL' },
      { status: 500 }
    )
  }
}
