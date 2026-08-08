import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { requireApiAdmin } from '@/lib/auth'
import { verifyProjectAccess } from '@/lib/project-access'
import { cancelCommentNotification } from '@/lib/comment-helpers'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
export const runtime = 'nodejs'

// Prevent static generation for this route
export const dynamic = 'force-dynamic'

// PATCH /api/comments/[id] - Mark a comment complete/incomplete.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 60,
    message: '操作过于频繁，请稍后再试。',
  }, 'comments-resolve')
  if (rateLimitResult) return rateLimitResult

  try {
    const { id } = await params
    const body = await request.json().catch(() => null)
    if (!body || typeof body.resolved !== 'boolean') {
      return NextResponse.json({ error: 'resolved 必须是布尔值' }, { status: 400 })
    }

    const comment = await prisma.comment.findUnique({
      where: { id },
      select: {
        projectId: true,
        project: { select: { sharePassword: true, authMode: true } },
      },
    })
    if (!comment) return NextResponse.json({ error: '批注不存在' }, { status: 404 })

    const access = await verifyProjectAccess(
      request,
      comment.projectId,
      comment.project.sharePassword,
      comment.project.authMode,
      { allowGuest: false, requiredPermission: 'comment' }
    )
    if (!access.authorized) return access.errorResponse!

    const updated = await prisma.comment.update({
      where: { id },
      data: { resolved: body.resolved },
      select: { id: true, resolved: true },
    })
    return NextResponse.json(updated)
  } catch {
    return NextResponse.json({ error: '批注状态更新失败' }, { status: 500 })
  }
}

// DELETE /api/comments/[id] - Delete a comment (admin only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const commentsMessages = messages?.comments || {}
  const shareMessages = messages?.share || {}

  // Authentication - admin only
  const authResult = await requireApiAdmin(request)
  if (authResult instanceof Response) {
    return authResult
  }

  // Rate limiting to prevent abuse
  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 20,
    message: shareMessages.tooManyRequestsGeneric || 'Too many requests. Please slow down.'
  }, 'comments-delete')

  if (rateLimitResult) {
    return rateLimitResult
  }

  try {
    const { id } = await params

    // Get the comment to find its project
    const existingComment = await prisma.comment.findUnique({
      where: { id },
      select: {
        projectId: true,
        project: {
          select: {
            id: true,
            recipients: {
              where: { isPrimary: true },
              take: 1,
              select: {
                name: true,
              }
            }
          }
        }
      }
    })

    if (!existingComment) {
      return NextResponse.json(
        { error: commentsMessages.commentNotFound || 'Comment not found' },
        { status: 404 }
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
  } catch (error) {
    return NextResponse.json({ error: commentsMessages.failedToDeleteComment || 'Failed to delete comment' }, { status: 500 })
  }
}
