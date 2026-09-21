import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiAdmin } from '@/lib/auth'
import { canAdministerProject } from '@/lib/project-access'
import { generateUniqueProjectSlugs } from '@/lib/share-tokens'
import { invalidateShareTokensByProject } from '@/lib/session-invalidation'
import { generateShareUrl } from '@/lib/url'
import { rateLimit } from '@/lib/rate-limit'
import { logError, logMessage } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MASTER_PROJECT_SELECT = {
  slug: true,
  shareSlug: true,
  team: { select: { shareKey: true, slug: true } },
} as const

// POST /api/projects/[id]/share-slug/rotate
// Retire the project's master share address. Every notification email carries it,
// so this is the one supported way to pull a leaked address out of circulation:
// both the URL segment and the API token are replaced, the old address stops
// resolving immediately, and viewers holding a session for it are dropped.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiAdmin(request)
  if (user instanceof Response) return user
  const { id } = await params
  if (!(await canAdministerProject(prisma, user, id))) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const rateLimitResult = await rateLimit(
    request,
    {
      windowMs: 60 * 1000,
      maxRequests: 5,
      message: '重置过于频繁，请稍后再试',
    },
    `share-address-rotate:${id}`,
  )
  if (rateLimitResult) return rateLimitResult

  try {
    const project = await prisma.project.findUnique({ where: { id }, select: { id: true, teamId: true } })
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 })

    const { slug, shareSlug } = await generateUniqueProjectSlugs(prisma, project.teamId)
    await prisma.project.update({ where: { id }, data: { slug, shareSlug } })

    let invalidatedSessions = 0
    try {
      invalidatedSessions = await invalidateShareTokensByProject(id)
    } catch (error) {
      // The address is already retired; a Redis outage must not undo that.
      logError('[SECURITY] Failed to invalidate share sessions after address rotation:', error)
    }
    logMessage(`[SECURITY] Project ${id} share address rotated - ${invalidatedSessions} share sessions invalidated`)

    const updated = await prisma.project.findUnique({ where: { id }, select: MASTER_PROJECT_SELECT })
    if (!updated) return NextResponse.json({ error: '项目不存在' }, { status: 404 })

    return NextResponse.json({
      success: true,
      slug,
      shareSlug,
      url: await generateShareUrl(updated, request),
      invalidatedSessions,
    })
  } catch (error) {
    logError('Failed to rotate project share address:', error)
    return NextResponse.json({ error: '重置分享地址失败' }, { status: 500 })
  }
}
