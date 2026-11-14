'use client'

import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Comment } from '@prisma/client'
import { Trash2, Brush, Check, Users } from 'lucide-react'
import DOMPurify from 'isomorphic-dompurify'
import { InitialsAvatar } from '@/components/InitialsAvatar'
import { cn } from '@/lib/utils'
import CommentAttachments from './CommentAttachments'

type CommentWithReplies = Comment & {
  replies?: Comment[]
}

const EMPTY_REPLIES: Comment[] = []

interface MessageBubbleProps {
  comment: CommentWithReplies
  isReply: boolean
  onReply?: () => void
  onSeekToTimecode?: (timecode: string, videoId: string, videoVersion: number | null) => void
  onDelete?: () => void
  formatMessageTime: (date: Date) => string
  commentsDisabled: boolean
  sequenceNumber?: number
  replies?: Comment[]
  onDeleteReply?: (replyId: string) => void
  canDeleteReply?: (reply: Comment) => boolean
  timestampLabel?: string | null
  timecodeEndLabel?: string | null
  hasAnnotation?: boolean
  shareToken?: string | null
  onToggleResolved?: (resolved: boolean) => void
  /** Rendered after the reply list, outside the seek-to-timecode hit area. */
  inlineReply?: ReactNode
  /** Keeps the composer mounted for its collapse transition. */
  inlineReplyClosing?: boolean
}

/**
 * Sanitize HTML content for display
 * Defense in depth: Even though content is sanitized on backend,
 * we sanitize again on frontend for extra security
 */
function sanitizeContent(content: string): string {
  return DOMPurify.sanitize(content, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li'],
    ALLOWED_ATTR: ['href', 'target', 'rel'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):)/i, // Only allow https://, http://, mailto: URLs
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['rel'], // Add rel="noopener noreferrer" to all links for security
    FORCE_BODY: true, // Parse content as body to prevent context-breaking attacks
  })
}

function ReplyReveal({ open, children }: { open: boolean; children: ReactNode }) {
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  const expanded = open && entered

  return (
    <div
      data-reply-reveal
      className={cn(
        'grid transition-[grid-template-rows,opacity] motion-reduce:transition-none',
        expanded
          ? 'grid-rows-[1fr] opacity-100 duration-200 ease-[var(--ease-emphasis)]'
          : 'grid-rows-[0fr] opacity-0 duration-150 ease-[var(--ease-standard)]',
      )}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          className={cn(
            'transition-transform motion-reduce:transition-none',
            expanded
              ? 'translate-y-0 duration-200 ease-[var(--ease-emphasis)]'
              : '-translate-y-1 duration-150 ease-[var(--ease-standard)]',
          )}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

function MessageBubble({
  comment,
  isReply,
  onReply,
  onSeekToTimecode,
  onDelete,
  formatMessageTime,
  commentsDisabled,
  sequenceNumber,
  replies,
  onDeleteReply,
  canDeleteReply,
  timestampLabel,
  timecodeEndLabel,
  hasAnnotation,
  shareToken,
  onToggleResolved,
  inlineReply,
  inlineReplyClosing = false,
}: MessageBubbleProps) {
  const t = useTranslations('comments')
  const [seekPulse, setSeekPulse] = useState(false)
  const seekPulseTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (seekPulseTimerRef.current !== null) {
        window.clearTimeout(seekPulseTimerRef.current)
      }
    }
  }, [])

  // Get effective author name for color generation
  // For internal comments without authorName, fall back to user.name or user.email
  const authorUser = (comment as any).user
  const authorProfile = authorUser?.teamNickname || authorUser?.teamProfession || authorUser?.department
    ? authorUser
    : null
  const effectiveAuthorName = authorProfile?.teamNickname || comment.authorName ||
    (comment.isInternal && authorUser ? (authorUser.name || authorUser.email) : null)
  const authorDetails = [authorProfile?.teamProfession, authorProfile?.department].filter(Boolean).join(' · ')
  const teamLabel = (comment as any).teamName as string | null | undefined

  const handleTimestampClick = () => {
    if (comment.timecode && onSeekToTimecode) {
      onSeekToTimecode(comment.timecode, comment.videoId, comment.videoVersion)
    }
  }

  const handleSeek = () => {
    setSeekPulse(true)
    if (seekPulseTimerRef.current !== null) window.clearTimeout(seekPulseTimerRef.current)
    seekPulseTimerRef.current = window.setTimeout(() => {
      setSeekPulse(false)
      seekPulseTimerRef.current = null
    }, 320)
    handleTimestampClick()
  }

  const handleFeedbackClick = (event: React.MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('a, button, textarea, input, [contenteditable="true"], [data-no-seek]')) return
    handleSeek()
  }

  const handleFeedbackKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const target = event.target as HTMLElement
    if (target !== event.currentTarget && target.closest('button, a, textarea, input, [contenteditable="true"], [data-no-seek]')) return
    event.preventDefault()
    handleSeek()
  }

  const threadReplies = !isReply && replies && replies.length > 0 ? replies : EMPTY_REPLIES
  const hasReplies = threadReplies.length > 0
  const isReplyOpen = Boolean(inlineReply) && !inlineReplyClosing
  const sanitizedCommentContent = useMemo(() => sanitizeContent(comment.content), [comment.content])
  const sanitizedReplyContent = useMemo(() => (
    new Map(threadReplies.map((reply) => [reply.id, sanitizeContent(reply.content)]))
  ), [threadReplies])

  return (
    <div className="relative z-10 w-full">
      <div
        className={cn(
          'relative rounded-[8px] px-[12px] py-[12px] transition-[transform,box-shadow,background-color] duration-150 ease-[var(--ease-standard)] motion-reduce:transition-none',
          comment.timecode && onSeekToTimecode && 'cursor-pointer active:scale-[0.997] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 motion-reduce:active:scale-100',
          seekPulse && 'ring-2 ring-inset ring-primary/30',
        )}
        data-seeking={seekPulse || undefined}
        onClick={comment.timecode && onSeekToTimecode ? handleFeedbackClick : undefined}
        onKeyDown={comment.timecode && onSeekToTimecode ? handleFeedbackKeyDown : undefined}
        role={comment.timecode && onSeekToTimecode ? 'button' : undefined}
        tabIndex={comment.timecode && onSeekToTimecode ? 0 : undefined}
        title={comment.timecode && onSeekToTimecode ? t('seekToTimecode') : undefined}
      >
        {hasReplies && (
          <div className="absolute bottom-8 left-8 top-10 w-px bg-border/60" aria-hidden="true" />
        )}

        <div className="grid grid-cols-[32px_1fr] items-start gap-x-2.5 gap-y-4">
          <div className="flex justify-center">
            <div className="group relative">
              <InitialsAvatar
                name={effectiveAuthorName}
                src={authorUser?.avatarUrl}
                size="sm"
                isInternal={comment.isInternal ?? false}
                title={effectiveAuthorName || undefined}
                variant="comment"
                className={authorDetails ? 'cursor-help' : undefined}
              />
              {authorDetails && (
                <span
                  role="tooltip"
                  className="pointer-events-none absolute left-full top-1/2 z-20 ml-2 w-max max-w-48 -translate-y-1/2 rounded-md bg-popover px-2 py-1 text-[11px] font-medium text-popover-foreground opacity-0 shadow-md ring-1 ring-border/70 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                >
                  {authorDetails}
                </span>
              )}
            </div>
          </div>
          <div className="min-w-0">
            <div className="mb-1 flex min-w-0 items-center gap-2 pr-8">
              <span className="truncate text-sm font-semibold text-foreground">
                {effectiveAuthorName || t('anonymous')}
              </span>
              {teamLabel && comment.isInternal && (
                <span className="shrink-0 text-sm font-semibold text-amber-500 dark:text-amber-400">
                  @{teamLabel}
                </span>
              )}
            </div>
            {!isReply && onToggleResolved && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onToggleResolved(!(comment as any).resolved)
                }}
                onPointerDown={(event) => event.stopPropagation()}
                className="group absolute right-[13px] top-[11px] flex h-[28px] w-[28px] items-center justify-center rounded-full outline-none transition-transform duration-150 active:scale-90 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none motion-reduce:active:scale-100"
                aria-label={(comment as any).resolved ? '标记为未完成' : '标记为已完成'}
                aria-pressed={(comment as any).resolved === true}
              >
                <span
                  className={cn(
                    'flex h-[22px] w-[22px] items-center justify-center rounded-full border transition-[border-color,background-color,color,opacity] duration-150 motion-reduce:transition-none',
                    (comment as any).resolved
                      ? 'border-success bg-success text-success-foreground group-hover:opacity-90'
                      : 'border-muted-foreground/50 bg-card text-transparent group-hover:border-primary group-hover:bg-primary/5',
                  )}
                >
                  <Check className="h-3.5 w-3.5" />
                </span>
              </button>
            )}

            {!isReply && timestampLabel && (
              <div className="flex items-center gap-1.5 mb-1.5">
                <button
                  type="button"
                  onClick={handleSeek}
                  className="inline-flex h-[22px] items-center rounded bg-warning px-2 text-[11px] font-semibold text-warning-foreground transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none motion-reduce:active:scale-100"
                  title={t('seekToTimecode')}
                >
                  <span className="font-sans tabular-nums">
                    {timestampLabel}{timecodeEndLabel ? ` \u2192 ${timecodeEndLabel}` : ''}
                  </span>
                </button>
                {hasAnnotation && (
                  <span className="inline-flex h-[22px] items-center rounded-md bg-blue-500/10 px-2 text-blue-600 dark:text-blue-400" title={t('hasAnnotation')}>
                    <Brush className="w-3.5 h-3.5" />
                  </span>
                )}
              </div>
            )}

            <div
              className={`break-words text-sm leading-relaxed text-foreground whitespace-pre-wrap ${
                comment.timecode && onSeekToTimecode
                  ? 'cursor-pointer rounded-md -mx-2 px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
                  : ''
              }`}
            >
              <div
                className="[&>p]:m-0"
                dangerouslySetInnerHTML={{ __html: sanitizedCommentContent }}
              />
            </div>

            {(comment as any).assets && (comment as any).assets.length > 0 && (
              <CommentAttachments
                assets={(comment as any).assets}
                videoId={comment.videoId}
                shareToken={shareToken}
              />
            )}

            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {(comment as any).visibility === 'INTERNAL' && (
                  <span
                    className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                    title="仅限拥有权限的成员查看"
                  >
                    <Users className="h-3 w-3" />
                    内部
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {formatMessageTime(comment.createdAt)}
                </span>
                {!isReply && !commentsDisabled && onReply && (
                  <button
                    type="button"
                    onClick={onReply}
                    aria-expanded={isReplyOpen}
                    aria-controls={isReplyOpen ? `inline-reply-${comment.id}` : undefined}
                    data-reply-open={isReplyOpen || undefined}
                    className={cn(
                      '-mx-1.5 inline-flex h-[20px] items-center rounded-md px-1.5 text-xs font-medium transition-[color,background-color,transform] duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none motion-reduce:active:scale-100',
                      isReplyOpen
                        ? 'bg-primary/10 text-foreground'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                    )}
                  >
                    {t('reply')}
                  </button>
                )}
                {onDelete && (
                  <button
                    type="button"
                    onClick={onDelete}
                    className="-mx-1.5 flex min-h-[20px] items-center gap-1 rounded-md px-1.5 text-xs font-medium text-muted-foreground transition-[color,background-color,transform] duration-150 hover:bg-destructive/10 hover:text-destructive active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none motion-reduce:active:scale-100"
                    title={t('deleteComment')}
                  >
                    <Trash2 className="w-4 h-4" />
                    {t('deleteComment')}
                  </button>
                )}
              </div>
              {typeof sequenceNumber === 'number' && sequenceNumber > 0 && (
                <span className="text-xs text-muted-foreground">
                  #{sequenceNumber}
                </span>
              )}
            </div>
          </div>

          {threadReplies.map((reply) => {
            const replyUser = (reply as any).user
            const replyProfile = replyUser?.teamNickname || replyUser?.teamProfession || replyUser?.department ? replyUser : null
            const replyEffectiveName = replyProfile?.teamNickname || reply.authorName ||
              (reply.isInternal && replyUser ? (replyUser.name || replyUser.email) : null)
            const replyDetails = [replyProfile?.teamProfession, replyProfile?.department].filter(Boolean).join(' · ')
            const replyTeamLabel = (reply as any).teamName as string | null | undefined

            return (
              <div key={reply.id} className="contents">
                <div className="flex justify-center">
                    <div className="group relative">
                      <InitialsAvatar name={replyEffectiveName} src={replyUser?.avatarUrl} size="sm" isInternal={reply.isInternal ?? false} title={replyEffectiveName || undefined} variant="comment" className={replyDetails ? 'cursor-help' : undefined} />
                      {replyDetails && (
                        <span role="tooltip" className="pointer-events-none absolute left-full top-1/2 z-20 ml-2 w-max max-w-48 -translate-y-1/2 rounded-md bg-popover px-2 py-1 text-[11px] font-medium text-popover-foreground opacity-0 shadow-md ring-1 ring-border/70 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                          {replyDetails}
                        </span>
                      )}
                    </div>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-2 min-w-0">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {replyEffectiveName || t('anonymous')}
                    </span>
                    {replyTeamLabel && reply.isInternal && (
                      <span className="shrink-0 text-sm font-semibold text-amber-500 dark:text-amber-400">@{replyTeamLabel}</span>
                    )}
                    <span className="flex-shrink-0 text-xs text-muted-foreground">
                      {formatMessageTime(reply.createdAt)}
                    </span>
                    {onDeleteReply && (!canDeleteReply || canDeleteReply(reply)) && (
                      <button
                        onClick={() => onDeleteReply(reply.id)}
                        className="ml-auto text-muted-foreground hover:text-destructive transition-colors"
                        title={t('deleteReply')}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <div
                    className="break-words text-sm leading-relaxed text-foreground whitespace-pre-wrap [&>p]:m-0"
                    dangerouslySetInnerHTML={{ __html: sanitizedReplyContent.get(reply.id) || '' }}
                  />
                  {(reply as any).assets && (reply as any).assets.length > 0 && (
                    <CommentAttachments
                      assets={(reply as any).assets}
                      videoId={reply.videoId}
                      shareToken={shareToken}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {inlineReply && (
        <ReplyReveal open={!inlineReplyClosing}>
          <div
            className={cn(
              'rounded-b-[8px] border-t border-border bg-card px-[12px] py-[12px]',
              inlineReplyClosing && 'pointer-events-none',
            )}
          >
            {inlineReply}
          </div>
        </ReplyReveal>
      )}
    </div>
  )
}

export default memo(MessageBubble)
