import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiAdmin } from '@/lib/auth'
import { canAccessProject } from '@/lib/project-access'
import { permanentlyDeleteRecycleBinItem, purgeExpiredRecycleBinItems } from '@/lib/recycle-bin'

export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAdmin(request)
  if (auth instanceof Response) return auth
  const { id: projectId } = await params
  if (!(await canAccessProject(prisma, auth, projectId))) return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  await purgeExpiredRecycleBinItems().catch(() => undefined)

  const items = await prisma.recycleBinItem.findMany({
    where: { projectId },
    orderBy: { deletedAt: 'desc' },
  })
  const now = Date.now()
  return NextResponse.json({
    items: items.map((item) => ({
      id: item.id,
      itemType: item.itemType,
      itemName: item.itemName,
      metadata: item.metadata,
      deletedAt: item.deletedAt,
      expiresAt: item.expiresAt,
      daysRemaining: Math.max(0, Math.ceil((item.expiresAt.getTime() - now) / (24 * 60 * 60 * 1000))),
    })),
  })
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
