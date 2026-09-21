import { NextRequest, NextResponse } from 'next/server'
import { prisma, INCLUDE_DELETED } from '@/lib/db'
import { requireApiAdmin } from '@/lib/auth'
import { canAccessProject } from '@/lib/project-access'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

// Move the source video group into another group as its newest versions.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAdmin(request)
  if (auth instanceof Response) return auth
  const { id: sourceId } = await params
  const body = await request.json().catch(() => ({}))
  const targetName = typeof body.targetName === 'string' ? body.targetName.trim() : ''
  if (!targetName || targetName.length > 255) return NextResponse.json({ error: 'A valid target video name is required.' }, { status: 400 })
  if (await rateLimit(request, { windowMs: 60_000, maxRequests: 30, message: 'Too many requests.' }, 'duplicate-video')) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429 })
  }

  const source = await prisma.video.findUnique({ where: { id: sourceId } })
  if (!source) return NextResponse.json({ error: 'Video not found.' }, { status: 404 })
  if (!(await canAccessProject(prisma, auth, source.projectId))) return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  if (source.status !== 'READY') return NextResponse.json({ error: 'Only ready videos can be used as a new version.' }, { status: 400 })
  if (source.name === targetName) return NextResponse.json({ error: 'Choose a different video group.' }, { status: 400 })

  try {
    const moved = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${source.projectId}:${targetName}`}))`
      const project = await tx.project.findUnique({ where: { id: source.projectId }, select: { status: true, enableRevisions: true, maxRevisions: true } })
      if (!project) throw new Error('PROJECT_NOT_FOUND')
      if (project.status === 'APPROVED') throw new Error('PROJECT_APPROVED')
      // Both groups are read with the recycle bin in view: version numbers may not
      // reuse a slot a tombstone still occupies, and a binned version has to travel
      // with its group so restoring it lands back in the same place.
      const [existing, sourceVersions] = await Promise.all([
        tx.video.findMany({ where: { projectId: source.projectId, name: targetName, deletedAt: INCLUDE_DELETED }, orderBy: { version: 'desc' }, select: { version: true, status: true, folderId: true, deletedAt: true } }),
        tx.video.findMany({ where: { projectId: source.projectId, name: source.name, deletedAt: INCLUDE_DELETED }, orderBy: { version: 'asc' }, select: { id: true, status: true, deletedAt: true } }),
      ])
      const liveVersions = sourceVersions.filter((video) => !video.deletedAt && video.status !== 'ROLLED_BACK')
      const activeCount = existing.filter((video) => !video.deletedAt && video.status !== 'ROLLED_BACK').length
      if (project.enableRevisions && project.maxRevisions > 0 && activeCount + liveVersions.length > project.maxRevisions) throw new Error('MAX_REVISIONS')
      const targetFolderId = existing.find((video) => !video.deletedAt)?.folderId || null
      const temporaryName = `__moving_${sourceId}_${Date.now()}`
      await tx.video.updateMany({ where: { projectId: source.projectId, name: source.name }, data: { name: temporaryName } })
      let version = existing[0]?.version || 0
      for (const sourceVersion of sourceVersions) {
        version += 1
        await tx.video.update({
          where: { id: sourceVersion.id },
          data: { name: targetName, version, versionLabel: `v${version}`, folderId: targetFolderId, approved: false, approvedAt: null, reviewStatus: null },
        })
      }
      return { count: liveVersions.length, version, latestId: liveVersions[liveVersions.length - 1]?.id }
    })
    return NextResponse.json({ videoId: moved.latestId, movedCount: moved.count, version: moved.version, versionLabel: `v${moved.version}` })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'PROJECT_APPROVED') return NextResponse.json({ error: 'Approved projects cannot receive new versions.' }, { status: 400 })
    if (message === 'MAX_REVISIONS') return NextResponse.json({ error: 'The maximum number of revisions has been reached.' }, { status: 400 })
    return NextResponse.json({ error: 'Failed to move the video as a new version.' }, { status: 500 })
  }
}
