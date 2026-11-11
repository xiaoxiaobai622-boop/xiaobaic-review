import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireProjectAction } from '@/lib/project-authorization'
import { getSecuritySettings } from '@/lib/video-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Who came in through this one link. `shareLinkId` is deliberately not a foreign
 * key, so a deleted link leaves its audit trail behind — which is why the link
 * must still exist in this project for the rows to be readable at all.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; linkId: string }> }) {
  const { id, linkId } = await params
  const access = await requireProjectAction(request, id, 'share')
  if (access instanceof Response) return access
  const link = await prisma.shareLink.findFirst({ where: { id: linkId, projectId: id }, select: { id: true } })
  if (!link) return NextResponse.json({ error: '分享记录不存在' }, { status: 404 })

  // One `where` shared by both reads: `take` truncates the list, so counting the
  // returned rows would hide everything past the page from the "共 N 条" label.
  const where = { shareLinkId: link.id }
  const [accesses, total, settings] = await Promise.all([
    prisma.sharePageAccess.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, createdAt: true, accessMethod: true, email: true, ipAddress: true },
    }),
    prisma.sharePageAccess.count({ where }),
    getSecuritySettings(),
  ])
  // Rows only exist while 追踪分析 is on, so an empty list means "nobody came"
  // just as often as "nothing is being recorded". The page has to tell them apart.
  return NextResponse.json({ accesses, total, trackingEnabled: settings.trackAnalytics })
}
