import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { generateVideoAccessToken } from '@/lib/video-access'
import { rateLimit } from '@/lib/rate-limit'
import { getAppUrl } from '@/lib/url'
import { logError } from '@/lib/logging'
import { resolveShareMetadata, isShareLinkActive, isVideoInShareScope } from '@/lib/share-links'
import { verifyProjectAccess } from '@/lib/project-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 300,
    message: '请求过于频繁，请稍后再试',
  }, 'share-stream')
  if (limited) return limited

  try {
    const { token } = await params
    const videoId = request.nextUrl.searchParams.get('videoId')
    const quality = request.nextUrl.searchParams.get('quality') || '720p'
    if (!videoId) return NextResponse.json({ error: 'videoId is required' }, { status: 400 })

    const resolved = await resolveShareMetadata(token)
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
      select: { id: true, name: true, folderId: true },
    })
    if (!video) return NextResponse.json({ error: 'Video not found' }, { status: 404 })
    if (resolved.link && !(await isVideoInShareScope(resolved.link, project.id, video))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const contentToken = await generateVideoAccessToken(
      video.id,
      project.id,
      quality,
      request,
      `share-stream:${project.id}:${quality}`,
    )

    const appUrl = await getAppUrl(request)
    return NextResponse.redirect(new URL(`/api/content/${contentToken}`, appUrl), 302)
  } catch (error) {
    logError('[SHARE] Stream redirect failed:', error)
    return NextResponse.json({ error: 'Stream redirect failed' }, { status: 500 })
  }
}
