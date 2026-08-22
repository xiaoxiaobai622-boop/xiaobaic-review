import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth'
import { canAccessProject } from '@/lib/project-access'
import { generateVideoAccessToken, getCachedVideoAccessToken } from '@/lib/video-access'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import { logError } from '@/lib/logging'


export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
    const sessionId = searchParams.get('sessionId')

    if (!videoId || !projectId || !quality || !sessionId) {
      return NextResponse.json(
        { error: videosMessages.missingRequiredParameters || 'Missing required parameters' },
        { status: 400 }
      )
    }

    if (!(await canAccessProject(prisma, authResult, projectId))) {
      return NextResponse.json(
        { error: '你没有这个项目的访问权限，请联系团队管理员' },
        { status: 403 }
      )
    }

    // Verify video belongs to project
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      select: { id: true, projectId: true }
    })

    if (!video || video.projectId !== projectId) {
      return NextResponse.json(
        { error: videosMessages.videoNotFoundOrDoesNotBelongToProject || 'Video not found or does not belong to project' },
        { status: 404 }
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
      sessionId
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
