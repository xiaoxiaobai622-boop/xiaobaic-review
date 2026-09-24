import { NextRequest, NextResponse } from 'next/server'
import { prisma, LIVE_COMMENT } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { verifyProjectAccess } from '@/lib/project-access'
import { cancelCommentNotification } from '@/lib/comment-helpers'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
export const runtime = 'nodejs'

// Prevent static generation for this route
export const dynamic = 'force-dynamic'

async function loadCommentProject(projectId: string) {
  return prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, teamId: true, sharePassword: true, authMode: true },
  })
}

/**
 * A share token with `comment` permission only proves the holder may take part
 * in the discussion, not that they own the row, so every mutation has to be
 * traced back to an account: the author or somebody on the owning team.
 */
async function getCommentActor(
  request: NextRequest,
  teamId: string,
  authorUserId: string | null,
): Promise<{ isAuthor: boolean; teamRole: string | null }> {
  const viewer = await getCurrentUserFromRequest(request)
  if (!viewer) return { isAuthor: false, teamRole: null }

  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: viewer.id } },
    select: { role: true, status: true, team: { select: { status: true } } },
  })
  const teamRole =
    membership?.status === 'ACTIVE' && membership.team.status === 'ACTIVE'
      ? membership.role
      : null

  return { isAuthor: Boolean(authorUserId && viewer.id === authorUserId), teamRole }
}

// PATCH /api/comments/[id] - Mark a comment complete/incomplete.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const commentsMessages = messages?.comments || {}
  const shareMessages = messages?.share || {}

  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 60,
    message: shareMessages.tooManyRequestsGeneric || 'Too many requests. Please slow down.',
  }, 'comments-resolve')
  if (rateLimitResult) return rateLimitResult

  // A comment that exists but may not be touched, and one that does not exist,
  // answer identically so the endpoint cannot be used to enumerate comment ids.
  const notAvailable = () => NextResponse.json(
    { error: commentsMessages.commentNotFound || 'Comment not found' },
    { status: 404 },
  )

  try {
    const { id } = await params
    const body = await request.json().catch(() => null)
    if (!body || typeof body.resolved !== 'boolean') {
      return NextResponse.json(
        { error: commentsMessages.resolvedMustBeBoolean || 'resolved must be a boolean' },
        { status: 400 },
      )
    }

    const comment = await prisma.comment.findUnique({
      where: { id, ...LIVE_COMMENT },
      select: { projectId: true, userId: true },
    })
    if (!comment) return notAvailable()

    const project = await loadCommentProject(comment.projectId)
    if (!project) return notAvailable()

    const access = await verifyProjectAccess(
      request,
      project.id,
      project.sharePassword,
      project.authMode,
      { allowGuest: false, requiredPermission: 'comment' }
    )
    if (!access.authorized) return notAvailable()

    const actor = await getCommentActor(request, project.teamId, comment.userId)
    // Resolving is a workflow status, so any member of the owning team may flip
    // it; deleting stays limited to the author and the team admins.
    if (!actor.isAuthor && !actor.teamRole) {
      return NextResponse.json(
        { error: commentsMessages.onlyTeamMemberCanResolve || 'Only the author or a team member can change the status of this comment' },
        { status: 403 },
      )
    }

    const updated = await prisma.comment.update({
      where: { id },
      data: { resolved: body.resolved },
      select: { id: true, resolved: true },
    })
    return NextResponse.json(updated)
  } catch {
    return NextResponse.json(
      { error: commentsMessages.failedToUpdateComment || 'Failed to update comment' },
      { status: 500 },
    )
  }
}

// DELETE /api/comments/[id] - Delete a comment by its author or a team admin.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const commentsMessages = messages?.comments || {}
  const shareMessages = messages?.share || {}

  // Rate limiting to prevent abuse
  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 20,
    message: shareMessages.tooManyRequestsGeneric || 'Too many requests. Please slow down.'
  }, 'comments-delete')

  if (rateLimitResult) {
    return rateLimitResult
  }

  // Uniform denial, exactly as PATCH does, so ids cannot be enumerated.
  const notAvailable = () => NextResponse.json(
    { error: commentsMessages.commentNotFound || 'Comment not found' },
    { status: 404 },
  )

  try {
    const { id } = await params

    // Get the comment to find its project
    const existingComment = await prisma.comment.findUnique({
      where: { id, ...LIVE_COMMENT },
      select: {
        projectId: true,
        userId: true,
        project: {
          select: {
            id: true,
            teamId: true,
            sharePassword: true,
            authMode: true,
          }
        }
      }
    })

    if (!existingComment) {
      return notAvailable()
    }

    const access = await verifyProjectAccess(
      request,
      existingComment.projectId,
      existingComment.project.sharePassword,
      existingComment.project.authMode,
      { allowGuest: false, requiredPermission: 'comment' },
    )
    if (!access.authorized) {
      return notAvailable()
    }

    const actor = await getCommentActor(request, existingComment.project.teamId, existingComment.userId)
    if (!actor.isAuthor && !['OWNER', 'ADMIN'].includes(actor.teamRole ?? '')) {
      return NextResponse.json(
        { error: commentsMessages.onlyAuthorOrAdminCanDelete || 'Only the author or a team admin can delete this comment' },
        { status: 403 },
      )
    }

    // Cancel any pending notifications for this comment
    await cancelCommentNotification(id)

    // Delete the comment and its replies (cascade)
    await prisma.comment.delete({
      where: { id },
    })

    // Return success - client will refresh to get updated comments
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: commentsMessages.failedToDeleteComment || 'Failed to delete comment' }, { status: 500 })
  }
}
