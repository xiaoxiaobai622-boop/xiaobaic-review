'use client'

import { useTranslations } from 'next-intl'
import { Comment } from '@prisma/client'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'
import { Clock, Send, X, Keyboard, Paperclip, Pencil, ArrowRight } from 'lucide-react'
import { formatCommentTimestamp, secondsToTimecode } from '@/lib/timecode'
import { InitialsAvatar } from '@/components/InitialsAvatar'
import CommentAttachmentButton from './CommentAttachmentButton'

interface CommentInputProps {
  newComment: string
  onCommentChange: (value: string) => void
  onSubmit: () => void
  loading: boolean

  // Timestamp
  selectedTimestamp: number | null
  onClearTimestamp: () => void
  selectedVideoFps: number // FPS of the currently selected video
  selectedVideoDurationSeconds?: number | null
  timestampDisplayMode?: 'TIMECODE' | 'AUTO'

  // Timecode range (in/out)
  selectedTimecodeEnd?: string | null
  isSelectingTimecodeEnd?: boolean
  onSetTimecodeEnd?: () => void
  onClearTimecodeEnd?: () => void

  // Reply state
  replyingToComment: Comment | null
  onCancelReply: () => void

  // Restrictions
  currentVideoRestricted: boolean
  restrictionMessage?: string
  commentsDisabled: boolean

  // Attachments
  allowClientAssetUpload?: boolean
  selectedVideoId?: string | null
  pendingAttachments?: Array<{ assetId: string; videoId: string; fileName: string; fileSize: string; fileType: string; category: string }>
  onAttachmentAdded?: (attachment: { assetId: string; videoId: string; fileName: string; fileSize: string; fileType: string; category: string }) => void
  onRemoveAttachment?: (assetId: string) => void
  attachmentError?: string | null
  attachmentNotice?: string | null
  onAttachmentErrorChange?: (message: string | null) => void
  shareToken?: string | null
  maxCommentAttachments?: number

  // Annotation drawing
  pendingAnnotation?: boolean
  onStartDrawing?: () => void
  onClearAnnotation?: () => void

  // Optional shortcuts UI (share pages)
  showShortcutsButton?: boolean
  onShowShortcuts?: () => void
}

export default function CommentInput({
  newComment,
  onCommentChange,
  onSubmit,
  loading,
  selectedTimestamp,
  onClearTimestamp,
  selectedVideoFps,
  selectedVideoDurationSeconds = null,
  timestampDisplayMode = 'TIMECODE',
  selectedTimecodeEnd = null,
  onSetTimecodeEnd,
  onClearTimecodeEnd,
  replyingToComment,
  onCancelReply,
  currentVideoRestricted,
  restrictionMessage,
  commentsDisabled,
  allowClientAssetUpload = false,
  selectedVideoId: selectedVideoIdProp = null,
  pendingAttachments = [],
  onAttachmentAdded,
  onRemoveAttachment,
  attachmentError = null,
  attachmentNotice = null,
  onAttachmentErrorChange,
  shareToken = null,
  maxCommentAttachments,
  pendingAnnotation = false,
  onStartDrawing,
  onClearAnnotation,
  showShortcutsButton = false,
  onShowShortcuts,
}: CommentInputProps) {
  const t = useTranslations('comments')
  const tCommon = useTranslations('common')

  if (commentsDisabled) {
    return (
      <div className="flex-shrink-0 border-t border-border/70 bg-card p-3">
        <textarea
          disabled
          aria-label="批注输入框"
          placeholder="该版本已通过，暂不能新增批注"
          className="flex min-h-[72px] w-full resize-none rounded-md border border-input bg-muted/30 px-3 py-2 text-sm text-muted-foreground opacity-80"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">该版本已通过，批注功能已锁定</p>
          {showShortcutsButton && onShowShortcuts && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onShowShortcuts}
              className="hidden lg:inline-flex"
            >
              <Keyboard className="w-4 h-4 lg:mr-2" />
              <span className="hidden lg:inline">{t('shortcuts')}</span>
            </Button>
          )}
        </div>
      </div>
    )
  }

  const hasAttachments = pendingAttachments.length > 0
  const canSubmit = !loading && Boolean(newComment.trim() || hasAttachments || pendingAnnotation)
  const timestampLabel =
    selectedTimestamp !== null && selectedTimestamp !== undefined
      ? formatCommentTimestamp({
          timecode: secondsToTimecode(selectedTimestamp, selectedVideoFps),
          fps: selectedVideoFps,
          videoDurationSeconds: selectedVideoDurationSeconds,
          mode: timestampDisplayMode,
        })
      : null

  const timecodeEndLabel = selectedTimecodeEnd
    ? formatCommentTimestamp({
        timecode: selectedTimecodeEnd,
        fps: selectedVideoFps,
        videoDurationSeconds: selectedVideoDurationSeconds,
        mode: timestampDisplayMode,
      })
    : null

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Allow Ctrl+Space and other Ctrl shortcuts to pass through to VideoPlayer
    if (e.ctrlKey) {
      // Don't handle Ctrl shortcuts here - let them bubble to VideoPlayer
      return
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      // Prevent multiple submissions while loading
      if (canSubmit) {
        onSubmit()
      }
    }
  }

  return (
    <div className="flex-shrink-0 border-t border-border/70 bg-card p-3">
      {/* Restriction Warning */}
      {currentVideoRestricted && restrictionMessage && (
        <div className="mb-3 p-3 bg-warning-visible border-2 border-warning-visible rounded-lg">
          <p className="text-sm text-warning font-medium flex items-center gap-2">
            <span className="font-semibold">{t('commentsRestricted')}</span>
          </p>
          <p className="text-xs text-warning font-medium mt-1">
            {restrictionMessage}
          </p>
        </div>
      )}

      {/* Replying To Indicator */}
      {replyingToComment && (
        <div className="mb-3 p-3 bg-muted/30 border border-border rounded-lg flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <InitialsAvatar name={replyingToComment.authorName || t('anonymous')} size="sm" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-foreground font-semibold mb-1 truncate">
                {t('replyingTo')} {replyingToComment.authorName || t('anonymous')}
              </p>
              <p className="text-xs text-muted-foreground line-clamp-2 leading-snug">
                {replyingToComment.content}
              </p>
            </div>
          </div>
          <button
            onClick={onCancelReply}
            className="text-xs text-muted-foreground hover:text-foreground font-medium flex-shrink-0 px-2 py-1 rounded hover:bg-muted transition-colors"
          >
            {tCommon('cancel')}
          </button>
        </div>
      )}

      {/* Message Input */}
      {!currentVideoRestricted && (
        <>
          {/* Pending annotation indicator */}
          {pendingAnnotation && (
            <div className="mb-2">
              <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-blue-500/10 border border-blue-500/20 rounded-md text-xs text-blue-600 dark:text-blue-400">
                <Pencil className="w-3 h-3" />
                {t('drawingAttached')}
                {onClearAnnotation && (
                  <button
                    type="button"
                    onClick={onClearAnnotation}
                    className="ml-0.5 hover:opacity-70 transition-opacity"
                    title={t('removeDrawing')}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </span>
            </div>
          )}

          {/* Pending attachment chips */}
          {pendingAttachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {pendingAttachments.map((att) => (
                <span
                  key={att.assetId}
                  className="inline-flex items-center gap-1.5 px-2 py-1 bg-muted/40 border border-border/50 rounded-md text-xs text-foreground"
                >
                  <Paperclip className="w-3 h-3 text-muted-foreground" />
                  <span className="truncate max-w-[120px]">{att.fileName}</span>
                  {onRemoveAttachment && (
                    <button
                      type="button"
                      onClick={() => onRemoveAttachment(att.assetId)}
                      className="text-muted-foreground hover:text-foreground ml-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Textarea
              placeholder={t('typeMessage')}
              value={newComment}
              onChange={(e) => onCommentChange(e.target.value)}
              onKeyDown={handleKeyDown}
              className="min-h-[72px] resize-none rounded-md text-sm"
              rows={2}
            />
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
                {timestampLabel && !currentVideoRestricted && (
                  <div className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-muted/40 px-2 py-1 text-xs font-medium text-foreground">
                    <button
                      type="button"
                      onClick={timecodeEndLabel ? undefined : onSetTimecodeEnd}
                      className={`inline-flex items-center gap-1 tabular-nums ${
                        timecodeEndLabel || !onSetTimecodeEnd ? 'cursor-default' : 'cursor-pointer hover:text-primary'
                      }`}
                      title={timecodeEndLabel ? t('clearEndTimecode') : t('setOutPoint')}
                    >
                      <Clock className="h-3 w-3" />
                      <span>{timestampLabel}</span>
                      {timecodeEndLabel && (
                        <>
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          <span>{timecodeEndLabel}</span>
                        </>
                      )}
                    </button>
                    {timecodeEndLabel && onClearTimecodeEnd && (
                      <button
                        type="button"
                        onClick={onClearTimecodeEnd}
                        className="text-muted-foreground transition-colors hover:text-foreground"
                        title={t('clearEndTimecode')}
                        aria-label={t('clearEndTimecode')}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                    {!timecodeEndLabel && (
                      <button
                        type="button"
                        onClick={onClearTimestamp}
                        className="text-muted-foreground transition-colors hover:text-foreground"
                        title={t('clearTimestamp')}
                        aria-label={t('clearTimestamp')}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                )}
                {onStartDrawing && (
                  <Button
                    type="button"
                    onClick={onStartDrawing}
                    variant={pendingAnnotation ? 'default' : 'outline'}
                    size="icon"
                    className="h-8 w-8 flex-shrink-0"
                    title={t('drawOnVideo')}
                    disabled={loading}
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                )}
                {allowClientAssetUpload && selectedVideoIdProp && onAttachmentAdded && (
                  <CommentAttachmentButton
                    videoId={selectedVideoIdProp}
                    shareToken={shareToken}
                    onAttachmentAdded={onAttachmentAdded}
                    onUploadError={onAttachmentErrorChange}
                    disabled={loading}
                    maxFiles={maxCommentAttachments}
                  />
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <p className="hidden whitespace-nowrap text-xs text-muted-foreground sm:block">{t('enterToSend')}</p>
                {showShortcutsButton && onShowShortcuts && (
                  <Button type="button" variant="outline" size="sm" onClick={onShowShortcuts} className="hidden h-8 lg:inline-flex">
                    <Keyboard className="h-4 w-4 lg:mr-2" />
                    <span className="hidden lg:inline">{t('shortcuts')}</span>
                  </Button>
                )}
                <Button
                  onClick={onSubmit}
                  variant="default"
                  disabled={!canSubmit}
                  size="icon"
                  className="h-8 w-8 shrink-0"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
          {(attachmentError || attachmentNotice) && (
            <p className={`mt-2 text-xs ${attachmentError ? 'text-destructive' : 'text-muted-foreground'}`}>
              {attachmentError || attachmentNotice}
            </p>
          )}

          <div className="mt-1 sm:hidden">
            <p className="text-xs text-muted-foreground">
              {t('enterToSend')}
            </p>
          </div>
        </>
      )}
    </div>
  )
}
