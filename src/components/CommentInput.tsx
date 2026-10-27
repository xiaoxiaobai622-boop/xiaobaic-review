'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Comment } from '@prisma/client'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'
import { Clock, Send, X, Keyboard, Paperclip, Pencil, ArrowRight, ArrowUpRight, Square, Smile, Globe, Users, ChevronDown, Check, Loader2 } from 'lucide-react'
import { formatTimecodeAs, formatTimeDisplay } from '@/lib/time-format'
import { useTimeFormat } from '@/hooks/useTimeFormat'
import { InitialsAvatar } from '@/components/InitialsAvatar'
import CommentAttachmentButton from './CommentAttachmentButton'
import EmojiPicker from './EmojiPicker'
import { COMMENT_CATEGORIES, type CommentCategory } from '@/lib/comment-categories'
import { cn } from '@/lib/utils'
import type { DrawingTool } from '@/types/annotations'
import ReviewPopup from './ReviewPopup'
import styles from './review-popup.module.css'

interface CommentInputProps {
  newComment: string
  onCommentChange: (value: string) => void
  onSubmit: () => void
  loading: boolean

  selectedCategory?: CommentCategory | null
  onCategoryChange?: (category: CommentCategory | null) => void
  /** 默认渲染；页内批注栏显式关掉，审片页不受影响。 */
  showCategoryPicker?: boolean
  /** 批注可见范围（对标 frame.io 的 公共/内部）；只在工作室侧渲染，共享端由服务端强制公开。 */
  visibility?: 'PUBLIC' | 'INTERNAL'
  onVisibilityChange?: (visibility: 'PUBLIC' | 'INTERNAL') => void
  showVisibilitySelector?: boolean
  /** 「Enter 发送」提示 + 发送钮搬进输入框内、和左下角画笔同一圈；页内批注栏传 true，审片页保持原样。 */
  sendInsideComposer?: boolean

  // Timestamp
  selectedTimestamp: number | null
  selectedVideoFps: number // FPS of the currently selected video
  selectedVideoDurationSeconds?: number | null

  // Timecode range (in/out)
  selectedTimecodeEnd?: string | null
  isSelectingTimecodeEnd?: boolean
  onSetTimecodeEnd?: () => void

  // Reply state
  replyingToComment: Comment | null
  onCancelReply: () => void
  focusRequest?: number

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
  onStartDrawing?: (tool: DrawingTool) => void

  // Optional shortcuts UI (share pages)
  showShortcutsButton?: boolean
  onShowShortcuts?: () => void
}

export default function CommentInput({
  newComment,
  onCommentChange,
  onSubmit,
  loading,
  selectedCategory = null,
  onCategoryChange,
  showCategoryPicker = true,
  visibility = 'PUBLIC',
  onVisibilityChange,
  showVisibilitySelector = true,
  sendInsideComposer = false,
  selectedTimestamp,
  selectedVideoFps,
  selectedVideoDurationSeconds = null,
  selectedTimecodeEnd = null,
  onSetTimecodeEnd,
  replyingToComment,
  onCancelReply,
  focusRequest,
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
  showShortcutsButton = false,
  onShowShortcuts,
}: CommentInputProps) {
  const t = useTranslations('comments')
  const tCommon = useTranslations('common')
  const format = useTimeFormat()
  const [activeDrawingTool, setActiveDrawingTool] = useState<DrawingTool | null>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [visOpen, setVisOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const emojiBtnRef = useRef<HTMLButtonElement | null>(null)
  const visBtnRef = useRef<HTMLButtonElement | null>(null)
  const emojiId = useId()
  const visId = useId()

  function toggleEmojiPicker() {
    setEmojiOpen(open => !open)
    setVisOpen(false)
  }

  function toggleVisibilityDropdown() {
    setVisOpen(open => !open)
    setEmojiOpen(false)
  }

  useEffect(() => {
    if (!focusRequest) return
    const el = textareaRef.current
    if (!el) return
    el.focus({ preventScroll: true })
    const end = el.value.length
    el.setSelectionRange(end, end)
  }, [focusRequest])

  function insertEmoji(emoji: string) {
    const el = textareaRef.current
    if (!el) {
      onCommentChange(newComment + emoji)
      return
    }
    // 在光标处插入；没有选区就落在光标后。
    const start = el.selectionStart ?? newComment.length
    const end = el.selectionEnd ?? start
    const next = newComment.slice(0, start) + emoji + newComment.slice(end)
    onCommentChange(next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + emoji.length
      el.setSelectionRange(pos, pos)
    })
  }

  useEffect(() => {
    const clearActiveTool = () => setActiveDrawingTool(null)
    window.addEventListener('annotationCleared', clearActiveTool)
    window.addEventListener('annotationSubmitted', clearActiveTool)
    return () => {
      window.removeEventListener('annotationCleared', clearActiveTool)
      window.removeEventListener('annotationSubmitted', clearActiveTool)
    }
  }, [])

  if (commentsDisabled) {
    return (
      <div className="flex-shrink-0 border-t border-border/70 bg-card p-2">
        <textarea
          disabled
          aria-label="批注输入框"
          placeholder="该版本已通过，暂不能新增批注"
          className="flex min-h-16 w-full resize-none rounded-md border border-input bg-muted/30 px-3 py-2 text-sm text-muted-foreground opacity-80"
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
      ? formatTimeDisplay(selectedTimestamp, selectedVideoFps, selectedVideoDurationSeconds, format)
      : null

  const timecodeEndLabel = selectedTimecodeEnd
    ? formatTimecodeAs(selectedTimecodeEnd, selectedVideoFps, selectedVideoDurationSeconds, format)
    : null

  // 只有真打了字才出现：空框上挂一枚可点的 00:00 会让人以为已经定了点。
  // compact 档住进框内那条工具栏，要和同排的 h-6 图标按钮同高同字号。
  const showTimecodePill = Boolean(timestampLabel) && !currentVideoRestricted && newComment.trim().length > 0
  const renderTimecodePill = (compact: boolean) => (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-border/70 bg-muted/40 font-medium text-foreground',
        compact ? 'h-6 shrink-0 px-1.5 text-[10px]' : 'px-2 py-1 text-xs'
      )}
    >
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
    </div>
  )

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
    <div className="flex-shrink-0 border-t border-border/70 bg-card px-2 pb-1 pt-[6.5px]">
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

          <div className="relative flex flex-col gap-1">
            <div className="relative">
              <Textarea
                ref={textareaRef}
                placeholder={t('typeMessage')}
                aria-label={t('typeMessage')}
                value={newComment}
                onChange={(e) => onCommentChange(e.target.value)}
                onKeyDown={handleKeyDown}
                className={cn(
                  'h-[75px] min-h-[75px] resize-none rounded-md text-sm',
                  // 内嵌工具栏压在输入框底部：留白要盖过它，否则长文本最后一行会被图标挡住。
                  sendInsideComposer || onStartDrawing ? 'pb-9' : 'pb-2'
                )}
                rows={2}
              />
              {onStartDrawing && (
                <div
                  className="absolute bottom-1 left-2 flex h-7 items-center gap-0.5 bg-transparent"
                  role="toolbar"
                  aria-label="画面批注工具"
                >
                  {([
                    ['freehand', Pencil, '画笔'],
                    ['arrow', ArrowUpRight, '箭头'],
                    ['rectangle', Square, '矩形'],
                  ] as const).map(([tool, Icon, label]) => (
                    <button
                      key={tool}
                      type="button"
                      onClick={() => {
                        setActiveDrawingTool(tool)
                        onStartDrawing(tool)
                      }}
                      disabled={loading}
                      className={cn(
                        'inline-flex h-6 w-6 items-center justify-center rounded-md bg-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40',
                        activeDrawingTool === tool && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground'
                      )}
                      title={label}
                      aria-label={label}
                      aria-pressed={activeDrawingTool === tool}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </button>
                  ))}
                </div>
              )}
              {sendInsideComposer && (
                // 和左边那排画笔同一条内嵌工具栏；整条 pointer-events-none，
                // 只有按钮自己接指针，压在文字区上也不会挡住点字定位光标。
                <div className="pointer-events-none absolute bottom-1 left-[84px] right-2 flex h-7 items-center justify-end gap-1.5">
                  {/* 表情和时间码钉在工具栏左端（紧跟画笔那三枚），右边那组仍靠右对齐 */}
                  <div className="mr-auto flex min-w-0 items-center gap-1.5">
                    {onVisibilityChange && !commentsDisabled && (
                      <button
                        ref={emojiBtnRef}
                        type="button"
                        onClick={toggleEmojiPicker}
                        className={cn(styles.trigger, 'pointer-events-auto inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground')}
                        aria-label="添加表情符号"
                        aria-expanded={emojiOpen}
                        aria-haspopup="dialog"
                        aria-controls={emojiOpen ? emojiId : undefined}
                        data-review-popup-trigger
                        title="添加表情符号"
                      >
                        <Smile className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {sendInsideComposer && showTimecodePill && renderTimecodePill(true)}
                  </div>
                  {showVisibilitySelector && onVisibilityChange && (
                    <button
                      ref={visBtnRef}
                      type="button"
                      onClick={toggleVisibilityDropdown}
                      className={cn(styles.trigger, 'pointer-events-auto inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-border/70 bg-background px-1.5 text-[10px] font-medium text-foreground/80 transition-colors hover:bg-accent')}
                      aria-label={`评论可见性：${visibility === 'INTERNAL' ? '内部' : '公共'}`}
                      aria-expanded={visOpen}
                      aria-haspopup="menu"
                      aria-controls={visOpen ? visId : undefined}
                      data-review-popup-trigger
                      title={`评论可见性：${visibility === 'INTERNAL' ? '仅限拥有权限的成员查看' : '所有成员及共享链接查看者均可见'}`}
                    >
                      {visibility === 'INTERNAL' ? <Users className="h-3.5 w-3.5" /> : <Globe className="h-3.5 w-3.5" />}
                      <span>{visibility === 'INTERNAL' ? '内部' : '公共'}</span>
                      <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    </button>
                  )}
                  <p
                    title={t('enterToSend')}
                    className="hidden min-w-0 truncate text-right text-[10px] text-muted-foreground lg:block"
                  >
                    {t('enterToSend')}
                  </p>
                  {showShortcutsButton && onShowShortcuts && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={onShowShortcuts}
                      className="pointer-events-auto hidden h-6 px-1.5 text-[10px] lg:inline-flex"
                    >
                      <Keyboard className="h-3.5 w-3.5 lg:mr-1" />
                      <span>{t('shortcuts')}</span>
                    </Button>
                  )}
                  <Button
                    onClick={onSubmit}
                    variant="default"
                    disabled={!canSubmit}
                    size="icon"
                    className="pointer-events-auto h-6 w-6 shrink-0"
                    aria-label={loading ? tCommon('sending') : tCommon('send')}
                    aria-busy={loading}
                  >
                    {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              )}
            </div>
            <div className={sendInsideComposer
              ? 'flex min-w-0 items-center justify-between gap-2'
              : 'flex h-8 min-w-0 items-center justify-between gap-2'}>
              <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
                {showCategoryPicker && onCategoryChange && !replyingToComment && (
                  <div className="flex items-center gap-1">
                    {COMMENT_CATEGORIES.map((category) => {
                      const selected = selectedCategory === category.value
                      return (
                        <button
                          key={category.value}
                          type="button"
                          onClick={() => onCategoryChange(selected ? null : category.value)}
                          aria-pressed={selected}
                          className={`inline-flex h-7 min-w-[54px] items-center justify-center whitespace-nowrap rounded-full border px-2 text-center text-xs font-medium transition-[border-color,background-color,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
                            selected
                              ? `${category.selectedControlClass} font-semibold`
                              : 'border-border/70 bg-background/70 text-muted-foreground hover:border-primary/40 hover:bg-accent hover:text-foreground'
                          }`}
                        >
                          {category.label}
                        </button>
                      )
                    })}
                  </div>
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
                {!sendInsideComposer && onVisibilityChange && !commentsDisabled && (
                  <button
                    ref={emojiBtnRef}
                    type="button"
                    onClick={toggleEmojiPicker}
                    className={cn(styles.trigger, 'inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground')}
                    aria-label="添加表情符号"
                    aria-expanded={emojiOpen}
                    aria-haspopup="dialog"
                    aria-controls={emojiOpen ? emojiId : undefined}
                    data-review-popup-trigger
                    title="添加表情符号"
                  >
                    <Smile className="h-4 w-4" />
                  </button>
                )}
                {!sendInsideComposer && showTimecodePill && renderTimecodePill(false)}
              </div>
              <div
                id="review-annotation-properties"
                className={sendInsideComposer
                  ? 'flex min-w-0 flex-1 items-center justify-center overflow-x-auto'
                  : 'flex h-7 min-w-0 flex-1 items-center justify-center overflow-x-auto px-1'}
              />
              <div className="flex shrink-0 items-center gap-1.5">
                {!sendInsideComposer && showVisibilitySelector && onVisibilityChange && (
                  <button
                    ref={visBtnRef}
                    type="button"
                    onClick={toggleVisibilityDropdown}
                    className={cn(styles.trigger, 'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border/70 bg-background px-2 text-xs font-medium text-foreground/80 transition-colors hover:bg-accent')}
                    aria-label={`评论可见性：${visibility === 'INTERNAL' ? '内部' : '公共'}`}
                    aria-expanded={visOpen}
                    aria-haspopup="menu"
                    aria-controls={visOpen ? visId : undefined}
                    data-review-popup-trigger
                    title={`评论可见性：${visibility === 'INTERNAL' ? '仅限拥有权限的成员查看' : '所有成员及共享链接查看者均可见'}`}
                  >
                    {visibility === 'INTERNAL' ? <Users className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
                    <span>{visibility === 'INTERNAL' ? '内部' : '公共'}</span>
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                )}
                {!sendInsideComposer && (
                  <p className="hidden whitespace-nowrap text-xs text-muted-foreground sm:block">{t('enterToSend')}</p>
                )}
                {!sendInsideComposer && showShortcutsButton && onShowShortcuts && (
                  <Button type="button" variant="outline" size="sm" onClick={onShowShortcuts} className="hidden h-8 lg:inline-flex">
                    <Keyboard className="h-4 w-4 lg:mr-2" />
                    <span className="hidden lg:inline">{t('shortcuts')}</span>
                  </Button>
                )}
                {!sendInsideComposer && (
                  <Button
                    onClick={onSubmit}
                    variant="default"
                    disabled={!canSubmit}
                    size="icon"
                    className="h-8 w-8 shrink-0"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                )}
              </div>

              <ReviewPopup id={emojiId} open={emojiOpen} onOpenChange={setEmojiOpen} anchor={emojiBtnRef} returnFocus={textareaRef} label="选择表情符号" align="center" width={298}>
                <EmojiPicker onSelect={insertEmoji} onClose={() => setEmojiOpen(false)} />
              </ReviewPopup>
              <ReviewPopup id={visId} open={visOpen} onOpenChange={setVisOpen} anchor={visBtnRef} label="批注可见范围" role="menu" align="end" width={268}>
                {([
                  ['PUBLIC', Globe, '公开评论', '所有成员及共享链接查看者均可见'],
                  ['INTERNAL', Users, '内部评论', '仅限拥有权限的成员查看'],
                ] as const).map(([value, Icon, label, description]) => (
                  <button key={value} type="button" role="menuitemradio" aria-checked={visibility === value}
                    onClick={() => { onVisibilityChange?.(value); setVisOpen(false) }}
                    className={`${styles.item} ${styles.visibilityItem}`}>
                    <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2 font-medium">
                        {label}
                        {visibility === value && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                      </span>
                      <span className={styles.description}>{description}</span>
                    </span>
                  </button>
                ))}
              </ReviewPopup>
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
