import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import { logError, logMessage } from '@/lib/logging'
import { verifyProjectAccess } from '@/lib/project-access'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

const unapproveVideoSchema = z.object({
  selectedVideoId: z.string().min(1, 'Selected video is required'),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const projectMessages = messages?.projects || {}
  const videoMessages = messages?.videos || {}

  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 20,
    message: projectMessages.tooManyApprovalRequests || 'Too many approval requests. Please slow down.',
  }, 'project-unapprove-video')

  if (rateLimitResult) return rateLimitResult

  try {
    const { id: projectId } = await params
    const body = await request.json().catch(() => ({}))
    const parsed = unapproveVideoSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 })
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        sharePassword: true,
        authMode: true,
        clientCanApprove: true,
      },
    })

    if (!project) {
      return NextResponse.json({ error: projectMessages.projectNotFoundApi || 'Project not found' }, { status: 404 })
    }

    const accessCheck = await verifyProjectAccess(
      request,
      project.id,
      project.sharePassword,
      project.authMode,
      {
        allowGuest: false,
        requiredAnyPermission: ['approve', 'comment'],
      }
    )

    if (!accessCheck.authorized) {
      return accessCheck.errorResponse || NextResponse.json(
        { error: projectMessages.passwordRequiredToApproveProject || 'Authentication required' },
        { status: 401 }
      )
    }

    if (!accessCheck.isAdmin && project.clientCanApprove === false) {
      return NextResponse.json({
        error: projectMessages.onlyAdminsCanApproveProject || 'Only administrators can approve videos for this project',
      }, { status: 403 })
    }

    const { selectedVideoId } = parsed.data
    const selectedVideo = await prisma.video.findFirst({
      where: {
        id: selectedVideoId,
        projectId,
      },
      select: { id: true, approved: true },
    })

    if (!selectedVideo) {
      return NextResponse.json({ error: projectMessages.selectedVideoNotFound || 'Selected video not found' }, { status: 404 })
    }

    if (!selectedVideo.approved) {
      return NextResponse.json(
        { error: videoMessages.videoNotApproved || 'This video version is not approved' },
        { status: 409 }
      )
    }

    const [videoUpdate, projectUpdate] = await prisma.$transaction([
      prisma.video.updateMany({
        where: {
          id: selectedVideoId,
          projectId,
          approved: true,
        },
        data: {
          approved: false,
          approvedAt: null,
        },
      }),
      prisma.project.updateMany({
        where: {
          id: projectId,
          status: 'APPROVED',
        },
        data: {
          status: 'IN_REVIEW',
          approvedAt: null,
          approvedVideoId: null,
        },
      }),
    ])

    logMessage(
      `[VIDEO-APPROVAL] Unapproved selected video ${selectedVideoId}; videoChanged=${videoUpdate.count}; projectStatusChanged=${projectUpdate.count}`
    )

    return NextResponse.json({
      success: true,
      videoId: selectedVideoId,
      approved: false,
      projectStatusChanged: projectUpdate.count > 0,
    })
  } catch (error) {
    logError('[VIDEO-APPROVAL] Failed to unapprove selected video:', error)
    return NextResponse.json(
      { error: videoMessages.failedToUnapproveVideo || 'Failed to unapprove video' },
      { status: 500 }
    )
  }
}
