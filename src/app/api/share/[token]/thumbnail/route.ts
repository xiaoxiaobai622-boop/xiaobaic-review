import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { generateVideoAccessToken } from '@/lib/video-access'
import { rateLimit } from '@/lib/rate-limit'
import { logError } from '@/lib/logging'
import { resolveShare, isShareLinkActive, scopeVideoIds } from '@/lib/share-links'
import { getAppDomain } from '@/lib/url'
import { verifyProjectAccess } from '@/lib/project-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 120,
    message: '请求过于频繁，请稍后再试',
  }, 'share-thumbnail')
  if (limited) return limited

  try {
    const { token } = await params
    const videoId = request.nextUrl.searchParams.get('videoId')
    if (!videoId) return NextResponse.json({ error: 'videoId is required' }, { status: 400 })

    const resolved = await resolveShare(token)
    if (resolved.link && !isShareLinkActive(resolved.link)) return NextResponse.json({ error: 'Share link is no longer active' }, { status: 410 })
    const project = resolved.project ? {
      id: resolved.project.id,
      sharePassword: resolved.link?.sharePassword || resolved.project.sharePassword,
      authMode: resolved.link?.authMode || resolved.project.authMode,
    } : null
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const accessCheck = await verifyProjectAccess(request, project.id, project.sharePassword, project.authMode, {
      requiredPermission: 'view',
    })
    if (!accessCheck.authorized) return accessCheck.errorResponse || NextResponse.json({ error: 'Access denied' }, { status: 403 })

    const video = await prisma.video.findFirst({
      where: { id: videoId, projectId: project.id, status: 'READY' },
      select: { id: true, thumbnailPath: true },
    })
    if (!video || !video.thumbnailPath) {
      return NextResponse.json({ error: 'Thumbnail not found' }, { status: 404 })
    }
    const scopedIds = resolved.link && resolved.project ? scopeVideoIds(resolved.link, resolved.project.videos) : null
    if (scopedIds && !scopedIds.has(video.id)) return NextResponse.json({ error: 'Access denied' }, { status: 403 })

    const contentToken = await generateVideoAccessToken(
      video.id,
      project.id,
      'thumbnail',
      request,
      `share-thumb:${project.id}`,
    )

    const appDomain = await getAppDomain()
    return NextResponse.redirect(new URL(`/api/content/${contentToken}`, appDomain), 302)
  } catch (error) {
    logError('[SHARE] Thumbnail generation failed:', error)
    return NextResponse.json({ error: 'Thumbnail generation failed' }, { status: 500 })
  }
}
