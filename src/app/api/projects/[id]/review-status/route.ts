import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import { logError, logMessage } from '@/lib/logging'
import { canManageProjectApproval } from '@/lib/project-access'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

const reviewStatusSchema = z.object({
  selectedVideoId: z.string().min(1, 'Selected video is required'),
  reviewStatus: z.enum(['PENDING_REVIEW', 'IN_REVIEW', 'FEEDBACK_COMPLETE']).nullable(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const projectMessages = messages?.projects || {}
  const videoMessages = messages?.videos || {}

  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 30,
    message: projectMessages.tooManyApprovalRequests || 'Too many review status requests. Please slow down.',
  }, 'project-review-status')
  if (rateLimitResult) return rateLimitResult

  try {
    const { id: projectId } = await params
    const body = await request.json().catch(() => ({}))
    const parsed = reviewStatusSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 })
    }

    const currentUser = await getCurrentUserFromRequest(request)
    if (!currentUser) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    if (!(await canManageProjectApproval(prisma, currentUser, projectId))) {
      return NextResponse.json({
        error: projectMessages.onlyAdminsCanApproveProject || 'Only project managers or the project creator can change review status',
      }, { status: 403 })
    }

    const { selectedVideoId, reviewStatus } = parsed.data
    const selectedVideo = await prisma.video.findFirst({
      where: { id: selectedVideoId, projectId, status: { not: 'ROLLED_BACK' } },
      select: { id: true, approved: true },
    })

    if (!selectedVideo) {
      return NextResponse.json({ error: projectMessages.selectedVideoNotFound || 'Selected video not found' }, { status: 404 })
    }

    const result = await prisma.$transaction(async (tx) => {
      const video = await tx.video.update({
        where: { id: selectedVideoId },
        data: {
          reviewStatus,
          approved: false,
          approvedAt: null,
        },
        select: { id: true, reviewStatus: true, approved: true },
      })

      const projectUpdate = selectedVideo.approved
        ? await tx.project.updateMany({
            where: { id: projectId, status: 'APPROVED' },
            data: {
              status: 'IN_REVIEW',
              approvedAt: null,
              approvedVideoId: null,
            },
          })
        : { count: 0 }

      return { video, projectStatusChanged: projectUpdate.count > 0 }
    })

    logMessage(`[VIDEO-REVIEW] Set video ${selectedVideoId} status to ${reviewStatus || 'NONE'}`)

    return NextResponse.json({
      success: true,
      video: result.video,
      projectStatusChanged: result.projectStatusChanged,
    })
  } catch (error) {
    logError('[VIDEO-REVIEW] Failed to update review status:', error)
    return NextResponse.json(
      { error: videoMessages.failedToUpdateReviewStatus || 'Failed to update review status' },
      { status: 500 }
    )
  }
}
