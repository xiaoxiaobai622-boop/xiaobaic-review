import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getPrimaryRecipient } from '@/lib/recipients'
import { rateLimit } from '@/lib/rate-limit'
import { verifyProjectAccess } from '@/lib/project-access'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { sanitizeComment } from '@/lib/comment-sanitization'
import { getRateLimitSettings } from '@/lib/settings'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import { logError } from '@/lib/logging'
import { resolveShareMetadata, getShareScopeVideoIds, isShareLinkActive } from '@/lib/share-links'

export const runtime = 'nodejs'




// Prevent static generation for this route
export const dynamic = 'force-dynamic'

/**
 * GET /api/share/[token]/comments
 *
 * Load comments for a share page (token-based access)
 * Replaces direct project ID access for better security
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const locale = await getConfiguredLocale().catch(() => 'en')
    const messages = await loadLocaleMessages(locale).catch(() => null)
    const shareMessages = messages?.share
    const { ipRateLimit } = await getRateLimitSettings()

    // Rate limiting to prevent scraping
    const rateLimitResult = await rateLimit(request, {
      windowMs: 60 * 1000,
      maxRequests: ipRateLimit ? Math.max(1, Math.min(ipRateLimit, 1000)) : 30,
      message: shareMessages?.tooManyRequests || 'Too many requests. Please slow down.'
    }, `share-comments:${token}`)

    if (rateLimitResult) return rateLimitResult

    // Fetch project by token (not by ID - more secure)
    const resolved = await resolveShareMetadata(token)
    if (resolved.link && !isShareLinkActive(resolved.link)) return NextResponse.json({ error: 'Share link is no longer active' }, { status: 410 })
    const project = resolved.project ? {
      id: resolved.project.id,
      sharePassword: resolved.link?.sharePassword || resolved.project.sharePassword,
      authMode: resolved.link?.authMode || resolved.project.authMode,
      companyName: resolved.project.companyName,
      hideFeedback: resolved.project.hideFeedback,
      guestMode: resolved.project.guestMode,
    } : null

    if (!project) {
      return NextResponse.json({ error: shareMessages?.accessDenied || 'Access denied' }, { status: 403 })
    }

    // SECURITY: If feedback is hidden, return empty array (don't expose comments)
    if (project.hideFeedback) {
      return NextResponse.json([])
    }

    // Get primary recipient for author name
    const primaryRecipient = await getPrimaryRecipient(project.id)
    // Priority: companyName → primary recipient → 'Client'
    const fallbackName = project.companyName || primaryRecipient?.name || 'Client'

    // Verify project access using bearer admin/share tokens
    const accessCheck = await verifyProjectAccess(request, project.id, project.sharePassword, project.authMode, {
      requiredPermission: 'comment',
    })

    if (!accessCheck.authorized) {
      return accessCheck.errorResponse!
    }

    const { isAdmin, isAuthenticated } = accessCheck
    const viewer = await getCurrentUserFromRequest(request)

    const assetSelect = {
      select: {
        id: true,
        fileName: true,
        fileSize: true,
        fileType: true,
        category: true,
        createdAt: true,
      },
    }

    // Fetch comments with nested replies
    const scopedIds = resolved.link ? await getShareScopeVideoIds(resolved.link, project.id) : null
    const comments = await prisma.comment.findMany({
      where: {
        projectId: project.id,
        parentId: null,
        ...(scopedIds ? { videoId: { in: Array.from(scopedIds) } } : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            username: true,
            email: true,
          }
        },
        assets: assetSelect,
        replies: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                username: true,
                email: true,
              }
            },
            assets: assetSelect,
          },
          orderBy: { createdAt: 'asc' }
        }
      },
      orderBy: { createdAt: 'asc' }
    })

    // Sanitize comments - never expose PII to non-admins
    const sanitizedComments = comments.map((comment: any) => sanitizeComment(
      comment,
      isAdmin,
      isAuthenticated,
      fallbackName,
      viewer?.id,
    ))

    return NextResponse.json(sanitizedComments)
  } catch (error) {
    logError('Error fetching comments:', error)
    const locale = await getConfiguredLocale().catch(() => 'en')
    const messages = await loadLocaleMessages(locale).catch(() => null)
    return NextResponse.json({ error: messages?.share?.unableToProcessRequest || 'Unable to process request' }, { status: 500 })
  }
}
