import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireProjectAction } from '@/lib/project-authorization'
import { rateLimit } from '@/lib/rate-limit'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import { logError } from '@/lib/logging'
import { createRecycleBinItem } from '@/lib/recycle-bin'

export const runtime = 'nodejs'

// DELETE /api/projects/[id]/photo-albums/[albumId]/photos/[photoId] - Delete photo (admin only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; albumId: string; photoId: string }> }
) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const photoMessages = messages?.photos || {}

  const { id: projectId, albumId, photoId } = await params

  const access = await requireProjectAction(request, projectId, 'edit')
  if (access instanceof Response) return access

  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 120,
    message: photoMessages.tooManyRequests || 'Too many requests. Please slow down.',
  }, 'photo-delete')
  if (rateLimitResult) return rateLimitResult

  try {
    const photo = await prisma.photo.findUnique({
      where: { id: photoId },
      include: { album: { select: { id: true, projectId: true } } },
    })

    if (!photo || photo.albumId !== albumId || photo.album.projectId !== projectId) {
      return NextResponse.json({ error: photoMessages.photoNotFound || 'Photo not found' }, { status: 404 })
    }

    await prisma.$transaction(async (tx) => {
      await createRecycleBinItem(tx, projectId, {
        itemType: 'PHOTO',
        itemName: photo.originalFileName || photo.fileName,
        metadata: { photoId: photo.id, albumId },
        paths: [photo.storagePath, photo.thumbnailPath, photo.previewPath].filter((path): path is string => Boolean(path)),
      })
      await tx.photo.delete({ where: { id: photoId } })
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    logError('Error deleting photo:', error)
    return NextResponse.json(
      { error: photoMessages.failedToDeletePhoto || 'Failed to delete photo' },
      { status: 500 }
    )
  }
}
