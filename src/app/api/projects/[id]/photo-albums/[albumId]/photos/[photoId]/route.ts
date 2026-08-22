import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiAdmin } from '@/lib/auth'
import { canAccessProject } from '@/lib/project-access'
import { rateLimit } from '@/lib/rate-limit'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import { logError } from '@/lib/logging'
import { dispatchDurableTask, recordDurableTask } from '@/lib/durable-tasks'

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

  const authResult = await requireApiAdmin(request)
  if (authResult instanceof Response) {
    return authResult
  }
  if (!(await canAccessProject(prisma, authResult, projectId))) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

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

    const task = await prisma.$transaction(async (tx) => {
      const durableTask = await recordDurableTask(tx, 'DELETE_STORAGE', `delete-photo-storage:${photoId}`, {
        paths: [photo.storagePath, photo.thumbnailPath, photo.previewPath].filter((path): path is string => Boolean(path)),
        directories: [],
      })
      await tx.photo.delete({ where: { id: photoId } })
      return durableTask
    })
    await dispatchDurableTask(task.id)

    return NextResponse.json({ ok: true })
  } catch (error) {
    logError('Error deleting photo:', error)
    return NextResponse.json(
      { error: photoMessages.failedToDeletePhoto || 'Failed to delete photo' },
      { status: 500 }
    )
  }
}
