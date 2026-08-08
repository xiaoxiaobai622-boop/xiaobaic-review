'use client'

import { useTranslations } from 'next-intl'
import { Comment } from '@prisma/client'
import { Clock, Trash2, Brush, Check } from 'lucide-react'
import DOMPurify from 'isomorphic-dompurify'
import { InitialsAvatar } from '@/components/InitialsAvatar'
import CommentAttachments from './CommentAttachments'

type CommentWithReplies = Comment & {
  replies?: Comment[]
}

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
  timestampLabel?: string | null
  timecodeEndLabel?: string | null
  hasAnnotation?: boolean
  shareToken?: string | null
  onToggleResolved?: (resolved: boolean) => void
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

export default function MessageBubble({
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
  timestampLabel,
  timecodeEndLabel,
  hasAnnotation,
  shareToken,
  onToggleResolved,
}: MessageBubbleProps) {
  const t = useTranslations('comments')

  // Get effective author name for color generation
  // For internal comments without authorName, fall back to user.name or user.email
  const effectiveAuthorName = comment.authorName ||
    (comment.isInternal && (comment as any).user ?
      ((comment as any).user.name || (comment as any).user.email) :
      null)

  const handleTimestampClick = () => {
    if (comment.timecode && onSeekToTimecode) {
      onSeekToTimecode(comment.timecode, comment.videoId, comment.videoVersion)
    }
  }

  const handleFeedbackClick = (event: React.MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('a, button')) return
    handleTimestampClick()
  }

  const handleFeedbackKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    handleTimestampClick()
  }

  const threadReplies = !isReply && replies && replies.length > 0 ? replies : []
  const hasReplies = threadReplies.length > 0

  return (
    <div className="w-full" id={`comment-${comment.id}`}>
      <div
        className={`relative border-b border-border/60 px-4 py-3 transition-colors ${
          (comment as any).resolved ? 'bg-success/8 hover:bg-success/12' : 'bg-card hover:bg-muted/30'
        } ${comment.timecode && onSeekToTimecode ? 'cursor-pointer focus-within:bg-muted/30' : ''}`}
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
            <InitialsAvatar name={effectiveAuthorName} size="sm" isInternal={comment.isInternal ?? false} />
          </div>
          <div className="min-w-0">
            <div className="mb-1 flex min-w-0 items-center gap-2 pr-8">
              <span className="truncate text-sm font-semibold text-foreground">
                {effectiveAuthorName || t('anonymous')}
              </span>
            </div>

            {!isReply && onToggleResolved && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onToggleResolved(!(comment as any).resolved)
                }}
                className={`absolute right-4 top-3.5 flex h-5 w-5 items-center justify-center rounded-full border transition-colors ${
                  (comment as any).resolved
                    ? 'border-success bg-success text-success-foreground'
                    : 'border-muted-foreground/50 bg-card text-transparent hover:border-primary'
                }`}
                aria-label={(comment as any).resolved ? '标记为未完成' : '标记为已完成'}
                aria-pressed={(comment as any).resolved === true}
              >
                <Check className="h-3.5 w-3.5" />
              </button>
            )}

            {!isReply && timestampLabel && (
              <div className="flex items-center gap-1.5 mb-1.5">
                <button
                  type="button"
                  onClick={handleTimestampClick}
                  className="inline-flex items-center gap-1 rounded bg-warning-visible px-1.5 py-0.5 text-[11px] font-semibold text-warning transition-opacity hover:opacity-90"
                  title={t('seekToTimecode')}
                >
                  <Clock className="w-3 h-3" />
                  <span className="font-sans tabular-nums">
                    {timestampLabel}{timecodeEndLabel ? ` \u2192 ${timecodeEndLabel}` : ''}
                  </span>
                </button>
                {hasAnnotation && (
                  <span className="inline-flex items-center rounded-md bg-blue-500/10 px-1.5 py-0.5 text-blue-600 dark:text-blue-400" title={t('hasAnnotation')}>
                    <Brush className="w-3.5 h-3.5" />
                  </span>
                )}
              </div>
            )}

            <div
              className={`break-words text-sm leading-relaxed text-foreground whitespace-pre-wrap ${
                comment.timecode && onSeekToTimecode
                  ? 'cursor-pointer rounded-md -mx-2 px-2 py-1 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
                  : ''
              }`}
            >
              <div
                className="[&>p]:m-0"
                dangerouslySetInnerHTML={{ __html: sanitizeContent(comment.content) }}
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
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  {formatMessageTime(comment.createdAt)}
                </span>
                {!isReply && !commentsDisabled && onReply && (
                  <button
                    onClick={onReply}
                    className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {t('reply')}
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={onDelete}
                    className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-destructive"
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
            const replyEffectiveName = reply.authorName ||
              (reply.isInternal && (reply as any).user ?
                ((reply as any).user.name || (reply as any).user.email) :
                null)

            return (
              <div key={reply.id} className="contents">
                <div className="flex justify-center">
                  <InitialsAvatar name={replyEffectiveName} size="sm" isInternal={reply.isInternal ?? false} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-2 min-w-0">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {replyEffectiveName || t('anonymous')}
                    </span>
                    <span className="flex-shrink-0 text-xs text-muted-foreground">
                      {formatMessageTime(reply.createdAt)}
                    </span>
                    {onDeleteReply && (
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
                    dangerouslySetInnerHTML={{ __html: sanitizeContent(reply.content) }}
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
    </div>
  )
}
