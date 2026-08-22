import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiAdmin } from '@/lib/auth'
import { canAccessProject } from '@/lib/project-access'
import { rateLimit } from '@/lib/rate-limit'
import { sanitizeFilename, validateUploadedFile } from '@/lib/file-validation'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'




// Prevent static generation for this route
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const videoMessages = messages?.videos || {}

  // SECURITY: Require admin authentication
  const authResult = await requireApiAdmin(request)
  if (authResult instanceof Response) {
    return authResult
  }

  // Rate limiting: Max 50 video uploads per hour
  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 50,
    message: videoMessages.tooManyVideoUploads || 'Too many video uploads. Please try again later.'
  }, 'upload-video')
  if (rateLimitResult) return rateLimitResult

  try {
    const body = await request.json()
    const { projectId, originalFileName, originalFileSize, name, mimeType } = body
    if (!projectId || !(await canAccessProject(prisma, authResult, projectId))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Validate required fields
    if (!name || !name.trim()) {
  return NextResponse.json({ error: videoMessages.videoNameRequired || 'Video name is required' }, { status: 400 })
    }

    const videoName = name.trim()

    // Validate uploaded file
    const fileValidation = validateUploadedFile(
      originalFileName || 'upload.mp4',
      mimeType || 'video/mp4',
      originalFileSize || 0
    )

    if (!fileValidation.valid) {
      return NextResponse.json(
        { error: fileValidation.error || 'Invalid file' },
        { status: 400 }
      )
    }

    const sanitizedOriginalFileName = fileValidation.sanitizedFilename || sanitizeFilename(originalFileName || 'upload.mp4')

    const result = await prisma.$transaction(async (tx) => {
      // Serialize version allocation for this project/name pair. The database
      // unique constraint remains the final guard against duplicate versions.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${projectId}:${videoName}`}))`

      const project = await tx.project.findUnique({
        where: { id: projectId },
        select: { enableRevisions: true, maxRevisions: true },
      })
      if (!project) return { kind: 'missing' as const }

      const [existingVersionCount, latest] = await Promise.all([
        tx.video.count({ where: { projectId, name: videoName } }),
        tx.video.findFirst({
          where: { projectId, name: videoName },
          orderBy: { version: 'desc' },
          select: { version: true },
        }),
      ])

      if (project.enableRevisions && project.maxRevisions > 0 && existingVersionCount >= project.maxRevisions) {
        return { kind: 'limit' as const, maxRevisions: project.maxRevisions }
      }

      const nextVersion = (latest?.version ?? 0) + 1
      const video = await tx.video.create({
        data: {
          projectId,
          name: videoName,
          version: nextVersion,
          versionLabel: `v${nextVersion}`,
          originalFileName,
          originalFileSize: BigInt(originalFileSize),
          originalStoragePath: `projects/${projectId}/videos/original-${Date.now()}-${sanitizedOriginalFileName}`,
          fileType: mimeType || 'video/mp4',
          uploadedBy: authResult.id,
          uploadedByName: authResult.name || authResult.email,
          status: 'UPLOADING',
          duration: 0,
          width: 0,
          height: 0,
        },
      })
      return { kind: 'created' as const, video }
    })

    if (result.kind === 'missing') {
      return NextResponse.json({ error: videoMessages.projectNotFoundApi || 'Project not found' }, { status: 404 })
    }
    if (result.kind === 'limit') {
      return NextResponse.json(
        { error: (videoMessages.maxRevisionsExceeded || 'Maximum revisions ({maxRevisions}) exceeded for this video').replace('{maxRevisions}', String(result.maxRevisions)) },
        { status: 400 }
      )
    }
    const video = result.video

    // Return videoId - TUS will handle upload directly
    return NextResponse.json({
      videoId: video.id,
    })
  } catch (error) {
    logError('Error creating video:', error)
    return NextResponse.json({ error: videoMessages.failedToCreateVideo || 'Failed to create video' }, { status: 500 })
  }
}
