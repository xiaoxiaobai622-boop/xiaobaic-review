import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiAdmin } from '@/lib/auth'
import { canAccessProject } from '@/lib/project-access'
import { permanentlyDeleteRecycleBinItem, purgeExpiredRecycleBinItems, restoreRecycleBinItem } from '@/lib/recycle-bin'

export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAdmin(request)
  if (auth instanceof Response) return auth
  const { id: projectId } = await params
  if (!(await canAccessProject(prisma, auth, projectId))) return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  await purgeExpiredRecycleBinItems().catch(() => undefined)

  const [items, restorable] = await Promise.all([
    prisma.recycleBinItem.findMany({
      where: { projectId },
      orderBy: { deletedAt: 'desc' },
    }),
    prisma.video.findMany({
      where: { projectId, deletedAt: { not: null } },
      select: { id: true },
    }),
  ])
  const restorableVideoIds = new Set(restorable.map((video) => video.id))
  const now = Date.now()
  return NextResponse.json({
    items: items.map((item) => {
      const metadata = item.metadata as Record<string, unknown> | null
      const videoId = typeof metadata?.videoId === 'string' ? metadata.videoId : null
      return {
        id: item.id,
        itemType: item.itemType,
        itemName: item.itemName,
        metadata: item.metadata,
        deletedAt: item.deletedAt,
        expiresAt: item.expiresAt,
        restorable: videoId !== null && restorableVideoIds.has(videoId),
        daysRemaining: Math.max(0, Math.ceil((item.expiresAt.getTime() - now) / (24 * 60 * 60 * 1000))),
      }
    }),
  })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAdmin(request)
  if (auth instanceof Response) return auth
  const { id: projectId } = await params
  if (!(await canAccessProject(prisma, auth, projectId))) return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  const body = await request.json().catch(() => null)
  const itemId = typeof body?.itemId === 'string' ? body.itemId : null
  if (!itemId) return NextResponse.json({ error: 'itemId is required' }, { status: 400 })

  const outcome = await restoreRecycleBinItem(itemId, projectId)
  if (!outcome.ok) {
    const messages = {
      NOT_FOUND: 'Recycle bin item not found',
      UNSUPPORTED: 'This item cannot be restored',
      ALREADY_GONE: 'The file behind this record has already been permanently deleted',
    } as const
    const status = outcome.reason === 'NOT_FOUND' ? 404 : outcome.reason === 'ALREADY_GONE' ? 410 : 400
    return NextResponse.json({ error: messages[outcome.reason] }, { status })
  }
  return NextResponse.json({ success: true })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAdmin(request)
  if (auth instanceof Response) return auth
  const { id: projectId } = await params
  if (!(await canAccessProject(prisma, auth, projectId))) return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  const itemId = new URL(request.url).searchParams.get('itemId')
  if (!itemId) return NextResponse.json({ error: 'itemId is required' }, { status: 400 })
  try {
    const deleted = await permanentlyDeleteRecycleBinItem(itemId, projectId)
    if (!deleted) return NextResponse.json({ error: 'Recycle bin item not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to permanently delete item' }, { status: 500 })
  }
}
