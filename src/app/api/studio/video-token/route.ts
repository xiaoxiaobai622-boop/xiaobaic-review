import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth'
import { findAccessibleVideo } from '@/lib/project-access'
import { generateVideoAccessToken, getCachedVideoAccessToken } from '@/lib/video-access'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import { logError } from '@/lib/logging'


export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Playback renditions the studio surfaces. Originals go through
// /api/videos/[id]/download-token, so they must never be minted from here.
const PLAYBACK_QUALITIES = ['thumbnail', 'hls', '720p', '1080p', '2160p']

/**
 * Admin Video Token Generation Endpoint
 *
 * Generates video access tokens for admin users to stream/download videos
 * Admins bypass normal share authentication but still need tokens for content delivery
 */
export async function GET(request: NextRequest) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const videosMessages = messages?.videos || {}

  // Check authentication
  const authResult = await requireApiUser(request)
  if (authResult instanceof Response) {
    return authResult
  }

  try {
    // Use NextRequest's parsed URL. In production the reverse proxy can expose
    // an internal request.url that omits the original query string.
    const { searchParams } = request.nextUrl
    const videoId = searchParams.get('videoId')
    const projectId = searchParams.get('projectId')
    const quality = searchParams.get('quality')

    if (!videoId || !projectId || !quality) {
      return NextResponse.json(
        { error: videosMessages.missingRequiredParameters || 'Missing required parameters' },
        { status: 400 }
      )
    }

    // The session id doubles as the token cache bucket and as the marker that
    // grades a token as internal (`admin:` prefix in video-access). Accepting it
    // from the query let any caller mint privileged tokens and let arbitrary
    // quality values fan out unbounded Redis keys.
    if (!PLAYBACK_QUALITIES.includes(quality)) {
      return NextResponse.json(
        { error: videosMessages.invalidQuality || 'Unsupported quality' },
        { status: 400 }
      )
    }

    const sessionId = authResult.sessionId ? `admin:${authResult.sessionId}` : `admin:${authResult.id}`

    const video = await findAccessibleVideo(prisma, authResult, projectId, videoId)
    if (!video) {
      return NextResponse.json(
        { error: '你没有这个项目的访问权限，请联系团队管理员' },
        { status: 403 }
      )
    }

    // Cached token responses are cheap and should not count against the burst limit.
    const cachedToken = await getCachedVideoAccessToken(videoId, projectId, quality, sessionId)
    if (cachedToken) {
      return NextResponse.json({ token: cachedToken })
    }

    // Rate limiting: Allow generous limit for new token generation.
    const rateLimitResult = await rateLimit(request, {
      windowMs: 60 * 1000,
      maxRequests: 600,
      message: videosMessages.tooManyTokenGenerationRequests || 'Too many token generation requests. Please slow down.'
    }, 'admin-video-token', authResult.id)

    if (rateLimitResult) {
      return rateLimitResult
    }

    // Generate video access token
    const token = await generateVideoAccessToken(
      videoId,
      projectId,
      quality,
      request,
      sessionId,
      { skipCacheCheck: true },
    )

    return NextResponse.json({ token })
  } catch (error) {
    logError('[API] Failed to generate admin video token:', error)
    return NextResponse.json(
      { error: videosMessages.failedToGenerateToken || 'Failed to generate token' },
      { status: 500 }
    )
  }
}
