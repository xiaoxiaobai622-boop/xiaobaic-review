'use client'

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'
import { Clock, X, Paperclip, Pencil, ArrowRight, ArrowUpRight, Square, Globe, Users, ChevronDown, Check, Loader2 } from 'lucide-react'
import { CommentEmojiIcon, DrawAnnotationIcon, SendPlaneIcon } from './comment-composer-icons'
import { formatTimecodeAs, formatTimeDisplay } from '@/lib/time-format'
import { useTimeFormat } from '@/hooks/useTimeFormat'
import { InitialsAvatar } from '@/components/InitialsAvatar'
import CommentAttachmentButton, { type CommentAttachmentHandle } from './CommentAttachmentButton'
import EmojiPicker from './EmojiPicker'
import { cn } from '@/lib/utils'
import type { DrawingTool } from '@/types/annotations'
import ReviewPopup from './ReviewPopup'
import styles from './review-popup.module.css'

interface CommentInputProps {
  newComment: string
  onCommentChange: (value: string) => void
  onSubmit: () => void
  loading: boolean

  /** 批注可见范围（对标 frame.io 的 公共/内部）；共享端访客固定公开。 */
  visibility?: 'PUBLIC' | 'INTERNAL'
  onVisibilityChange?: (visibility: 'PUBLIC' | 'INTERNAL') => void
  showVisibilitySelector?: boolean
  /** 不能改可见范围时仍保留选择器，置灰不可点。 */
  visibilitySelectorDisabled?: boolean
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
  onCancelReply?: () => void
  focusRequest?: number
  /** `inlineReply` renders inside a comment card: no visibility/timecode/draw/shortcuts/@. */
  variant?: 'default' | 'inlineReply'

  /** Project viewers that can be @-mentioned. Studio side only. */
  mentionCandidates?: Array<{ id: string; name: string; avatarUrl?: string | null }>
  mentionedUserIds?: string[]
  onMentionedUserIdsChange?: (ids: string[]) => void

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
  shareSlug?: string | null
  maxCommentAttachments?: number

  // Annotation drawing
  pendingAnnotation?: boolean
  onStartDrawing?: (tool: DrawingTool) => void
}

function findMentionToken(value: string, cursor: number): { start: number; query: string } | null {
  const before = value.slice(0, cursor)
  const match = before.match(/(^|\s)@([^\s@]*)$/)
  if (!match) return null
  const query = match[2] ?? ''
  return { start: cursor - query.length - 1, query }
}

export default function CommentInput({
  newComment,
  onCommentChange,
  onSubmit,
  loading,
  visibility = 'PUBLIC',
  onVisibilityChange,
  showVisibilitySelector = true,
  visibilitySelectorDisabled = false,
  sendInsideComposer = false,
  selectedTimestamp,
  selectedVideoFps,
  selectedVideoDurationSeconds = null,
  selectedTimecodeEnd = null,
  onSetTimecodeEnd,
  onCancelReply,
  focusRequest,
  variant = 'default',
  mentionCandidates = [],
  mentionedUserIds = [],
  onMentionedUserIdsChange,
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
  shareSlug = null,
  maxCommentAttachments,
  pendingAnnotation = false,
  onStartDrawing,
}: CommentInputProps) {
  const t = useTranslations('comments')
  const tCommon = useTranslations('common')
  const format = useTimeFormat()
  const isInlineReply = variant === 'inlineReply'
  const visibilityLocked = !showVisibilitySelector || visibilitySelectorDisabled
  const visibilityPillVisible = Boolean(onVisibilityChange) && (showVisibilitySelector || visibilitySelectorDisabled)
  const visibilityTitle = visibilityLocked
    ? '评论可见性：当前身份发布的批注固定公开'
    : `评论可见性：${visibility === 'INTERNAL' ? '仅限拥有权限的成员查看' : '所有成员及共享链接查看者均可见'}`
  const [activeDrawingTool, setActiveDrawingTool] = useState<DrawingTool | null>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [visOpen, setVisOpen] = useState(false)
  const [drawOpen, setDrawOpen] = useState(false)
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionIndex, setMentionIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const editorRef = useRef<HTMLDivElement | null>(null)
  const emojiBtnRef = useRef<HTMLButtonElement | null>(null)
  const visBtnRef = useRef<HTMLButtonElement | null>(null)
  const drawBtnRef = useRef<HTMLButtonElement | null>(null)
  const [isWideComposer, setIsWideComposer] = useState(false)
  const [simulatedText, setSimulatedText] = useState('')
  const [simulationSentence, setSimulationSentence] = useState('')
  const [simulationVisible, setSimulationVisible] = useState(false)
  const [isSimulating, setIsSimulating] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [attachmentUploading, setAttachmentUploading] = useState(false)
  const [isDraggingAttachment, setIsDraggingAttachment] = useState(false)
  const attachmentRef = useRef<CommentAttachmentHandle | null>(null)
  const simulationTimeoutRef = useRef<number | null>(null)
  const simulationFadeTimeoutRef = useRef<number | null>(null)
  const simulationRevealTimeoutRef = useRef<number | null>(null)
  const hasSimulatedRef = useRef(false)
  const emojiId = useId()
  const visId = useId()
  const drawId = useId()

  function toggleEmojiPicker() {
    setEmojiOpen(open => !open)
    setVisOpen(false)
  }

  function toggleVisibilityDropdown() {
    setVisOpen(open => !open)
    setEmojiOpen(false)
  }

  function stopSimulation() {
    if (simulationTimeoutRef.current !== null) {
      window.clearTimeout(simulationTimeoutRef.current)
      simulationTimeoutRef.current = null
    }
    if (simulationRevealTimeoutRef.current !== null) {
      window.clearTimeout(simulationRevealTimeoutRef.current)
      simulationRevealTimeoutRef.current = null
    }
    setSimulationVisible(false)
    if (simulationFadeTimeoutRef.current !== null) {
      window.clearTimeout(simulationFadeTimeoutRef.current)
    }
    simulationFadeTimeoutRef.current = window.setTimeout(() => {
      setIsSimulating(false)
      setSimulatedText('')
      setSimulationSentence('')
      simulationFadeTimeoutRef.current = null
    }, 220)
  }

  function startSimulation() {
    if (
      isInlineReply ||
      hasSimulatedRef.current ||
      newComment.length > 0 ||
      pendingAttachments.length > 0 ||
      pendingAnnotation ||
      commentsDisabled ||
      currentVideoRestricted ||
      loading ||
      document.activeElement === textareaRef.current
    ) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const sentence = t('demoComment')
    if (!sentence) return

    hasSimulatedRef.current = true
    setSimulationSentence(sentence)
    setIsSimulating(true)
    setSimulatedText('')
    setSimulationVisible(false)

    if (simulationRevealTimeoutRef.current !== null) window.clearTimeout(simulationRevealTimeoutRef.current)
    simulationRevealTimeoutRef.current = window.setTimeout(() => {
      setSimulationVisible(true)
      simulationRevealTimeoutRef.current = null
    }, 120)

    let index = 0
    const typeNext = () => {
      index += 1
      setSimulatedText(sentence.slice(0, index))
      if (index >= sentence.length) {
        simulationTimeoutRef.current = window.setTimeout(() => {
          simulationTimeoutRef.current = null
          stopSimulation()
        }, 800)
        return
      }
      const char = sentence[index - 1]
      const delay = /[，。！？,.!?]/.test(char) ? 360 : 140 + Math.random() * 100
      simulationTimeoutRef.current = window.setTimeout(typeNext, delay)
    }

    // First character lands with the click; the layer fades in around it.
    typeNext()
  }

  const startSimulationRef = useRef(startSimulation)

  useEffect(() => {
    startSimulationRef.current = startSimulation
  })

  useEffect(() => {
    if (!focusRequest) return
    const el = textareaRef.current
    if (!el) return
    el.focus({ preventScroll: true })
    const end = el.value.length
    el.setSelectionRange(end, end)
  }, [focusRequest])

  useLayoutEffect(() => {
    const el = editorRef.current
    if (!el) return
    const update = () => setIsWideComposer(el.clientWidth >= 1040)
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    return () => {
      if (simulationTimeoutRef.current !== null) window.clearTimeout(simulationTimeoutRef.current)
      if (simulationFadeTimeoutRef.current !== null) window.clearTimeout(simulationFadeTimeoutRef.current)
      if (simulationRevealTimeoutRef.current !== null) window.clearTimeout(simulationRevealTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    if (!newComment) return
    if (simulationTimeoutRef.current !== null) {
      window.clearTimeout(simulationTimeoutRef.current)
      simulationTimeoutRef.current = null
    }
    if (simulationFadeTimeoutRef.current !== null) {
      window.clearTimeout(simulationFadeTimeoutRef.current)
      simulationFadeTimeoutRef.current = null
    }
    if (simulationRevealTimeoutRef.current !== null) {
      window.clearTimeout(simulationRevealTimeoutRef.current)
      simulationRevealTimeoutRef.current = null
    }
    setSimulationVisible(false)
    setIsSimulating(false)
    setSimulatedText('')
    setSimulationSentence('')
  }, [newComment])

  useEffect(() => {
    if (isInlineReply) return
    const timer = window.setTimeout(() => startSimulationRef.current(), 400)
    return () => window.clearTimeout(timer)
  }, [isInlineReply])

  const mentionNameById = useMemo(
    () => new Map(mentionCandidates.map((candidate) => [candidate.id, candidate.name])),
    [mentionCandidates],
  )

  const filteredMentionCandidates = useMemo(() => {
    if (!mentionOpen) return []
    const query = mentionQuery.trim().toLowerCase()
    return mentionCandidates
      .filter((candidate) => !query || candidate.name.toLowerCase().includes(query))
      .slice(0, 8)
  }, [mentionCandidates, mentionOpen, mentionQuery])

  useEffect(() => {
    if (!newComment) {
      setMentionOpen(false)
      setMentionQuery('')
    }
  }, [newComment])

  function handleCommentChangeWithMentions(value: string, cursor: number) {
    onCommentChange(value)
    const token = findMentionToken(value, cursor)
    if (token && mentionCandidates.length > 0) {
      setMentionQuery(token.query)
      setMentionOpen(true)
      setMentionIndex(0)
    } else {
      setMentionOpen(false)
      setMentionQuery('')
    }

    if (onMentionedUserIdsChange && mentionedUserIds.length > 0) {
      const kept = mentionedUserIds.filter((id) => {
        const name = mentionNameById.get(id)
        return name ? value.includes(`@${name}`) : false
      })
      if (kept.length !== mentionedUserIds.length) {
        onMentionedUserIdsChange(kept)
      }
    }
  }

  function selectMention(candidate: { id: string; name: string }) {
    const el = textareaRef.current
    const cursor = el?.selectionStart ?? newComment.length
    const token = findMentionToken(newComment, cursor)
    const insertion = `@${candidate.name} `
    const next = token
      ? newComment.slice(0, token.start) + insertion + newComment.slice(cursor)
      : `${newComment}${insertion}`

    onCommentChange(next)
    if (onMentionedUserIdsChange && !mentionedUserIds.includes(candidate.id)) {
      onMentionedUserIdsChange([...mentionedUserIds, candidate.id])
    }
    setMentionOpen(false)
    setMentionQuery('')
    requestAnimationFrame(() => {
      el?.focus()
      const position = (token?.start ?? newComment.length) + insertion.length
      el?.setSelectionRange(position, position)
    })
  }

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
    if (isInlineReply) return null
    return (
      <div className={cn('flex-shrink-0 rounded-[8px] bg-card p-2', !sendInsideComposer && 'border-t border-border/70')}>
        <textarea
          disabled
          aria-label="批注输入框"
          placeholder="该版本已通过，暂不能新增批注"
          className="flex min-h-16 w-full resize-none rounded-md border border-input bg-muted/30 px-3 py-2 text-sm text-muted-foreground opacity-80"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">该版本已通过，批注功能已锁定</p>
        </div>
      </div>
    )
  }

  const hasAttachments = pendingAttachments.length > 0
  const canSubmit = !loading && !attachmentUploading && Boolean(newComment.trim() || hasAttachments || pendingAnnotation)
  const canAttachFiles = Boolean(allowClientAssetUpload && selectedVideoIdProp && onAttachmentAdded)
  const attachmentButton = (
    <CommentAttachmentButton
      ref={attachmentRef}
      videoId={selectedVideoIdProp ?? ''}
      shareToken={shareToken}
      shareSlug={shareSlug}
      onAttachmentAdded={(attachment) => onAttachmentAdded?.(attachment)}
      onUploadError={onAttachmentErrorChange}
      onUploadingChange={setAttachmentUploading}
      disabled={loading || !canAttachFiles}
      maxFiles={maxCommentAttachments}
    />
  )
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
        compact ? 'h-[28px] shrink-0 px-2 text-[11px]' : 'px-2 py-1 text-xs'
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

  const drawingMenuItems = ([
    ['freehand', Pencil, '画笔'],
    ['arrow', ArrowUpRight, '箭头'],
    ['rectangle', Square, '矩形'],
  ] as const).map(([tool, Icon, label]) => (
    <button
      key={tool}
      type="button"
      role="menuitemradio"
      aria-checked={activeDrawingTool === tool}
      onClick={() => {
        setActiveDrawingTool(tool)
        onStartDrawing?.(tool)
        setDrawOpen(false)
      }}
      disabled={loading}
      className={cn(
        'flex h-12 w-14 flex-col items-center justify-center gap-1 rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40',
        activeDrawingTool === tool && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
      )}
      title={label}
      aria-label={label}
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
      <span className="text-[10px] leading-none">{label}</span>
    </button>
  ))

  const drawAnnotationTrigger = (
    <button
      ref={drawBtnRef}
      type="button"
      data-review-popup-trigger
      aria-label="绘制批注"
      title="绘制批注"
      aria-haspopup="menu"
      aria-expanded={drawOpen}
      aria-controls={drawOpen ? drawId : undefined}
      onClick={() => setDrawOpen(open => !open)}
      disabled={loading}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg bg-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40',
        activeDrawingTool && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
      )}
    >
      <DrawAnnotationIcon className="h-[24px] w-[24px]" />
    </button>
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Allow Ctrl+Space and other Ctrl shortcuts to pass through to VideoPlayer
    if (e.ctrlKey) {
      // Don't handle Ctrl shortcuts here - let them bubble to VideoPlayer
      return
    }

    if (mentionOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (filteredMentionCandidates.length > 0) {
          setMentionIndex((index) => (index + 1) % filteredMentionCandidates.length)
        }
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (filteredMentionCandidates.length > 0) {
          setMentionIndex((index) => (index - 1 + filteredMentionCandidates.length) % filteredMentionCandidates.length)
        }
        return
      }
      if (e.key === 'Enter') {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return
        if (filteredMentionCandidates.length > 0) {
          e.preventDefault()
          selectMention(filteredMentionCandidates[mentionIndex] || filteredMentionCandidates[0])
          return
        }
        setMentionOpen(false)
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMentionOpen(false)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      if (e.nativeEvent.isComposing || e.keyCode === 229) return
      e.preventDefault()
      // Prevent multiple submissions while loading
      if (canSubmit) {
        onSubmit()
      }
    }
  }

  const hasDraggedFiles = (event: React.DragEvent<HTMLDivElement>) =>
    Array.from(event.dataTransfer.types).includes('Files')

  const handleAttachmentDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = canAttachFiles ? 'copy' : 'none'
    if (canAttachFiles) setIsDraggingAttachment(true)
  }

  const handleAttachmentDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setIsDraggingAttachment(false)
  }

  const handleAttachmentDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    setIsDraggingAttachment(false)
    if (!canAttachFiles) return
    const files = Array.from(event.dataTransfer.files)
    if (files.length > 0) attachmentRef.current?.addFiles(files)
  }

  const handleAttachmentPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (!canAttachFiles) return
    const files = Array.from(event.clipboardData.files)
    if (files.length === 0) {
      for (const item of Array.from(event.clipboardData.items)) {
        if (item.kind !== 'file') continue
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }
    if (files.length === 0) return
    event.preventDefault()
    attachmentRef.current?.addFiles(files)
  }

  return (
    <div className={cn(
      'relative flex-shrink-0',
      isInlineReply
        ? 'bg-transparent'
        : 'rounded-[8px] bg-card px-2 pb-1 pt-[6.5px] transition-shadow duration-150 hover:shadow-[inset_0_0_0_9999px_hsl(var(--foreground)/0.05)] focus-within:shadow-none focus-within:hover:shadow-none',
      !sendInsideComposer && !isInlineReply && 'border-t border-border/70',
    )}
      onDragOver={handleAttachmentDragOver}
      onDragLeave={handleAttachmentDragLeave}
      onDrop={handleAttachmentDrop}
      onPaste={handleAttachmentPaste}
    >
      {isDraggingAttachment && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-[8px] border-2 border-dashed border-primary bg-primary/5 text-xs font-medium text-primary">
          松开添加附件
        </div>
      )}
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

      {/* Message Input */}
      {!currentVideoRestricted && (
        <>
          {/* Pending attachment chips */}
          {pendingAttachments.length > 0 && (
            <div className={cn('mb-2 flex flex-wrap gap-1.5', !isInlineReply && 'justify-center')}>
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
            <div className="relative" ref={editorRef}>
              <Textarea
                ref={textareaRef}
                aria-label={isInlineReply ? t('replyPlaceholder') : t('typeMessage')}
                value={newComment}
                onChange={(e) => {
                  if (isSimulating) stopSimulation()
                  handleCommentChangeWithMentions(e.target.value, e.target.selectionStart ?? e.target.value.length)
                }}
                onFocus={() => {
                  setIsFocused(true)
                  if (isSimulating) stopSimulation()
                }}
                onBlur={() => {
                  setIsFocused(false)
                  if (isSimulating) stopSimulation()
                }}
                onKeyDown={handleKeyDown}
                aria-autocomplete="list"
                aria-expanded={mentionOpen}
                aria-haspopup="listbox"
                className={cn(
                  'resize-none rounded-md text-sm',
                  isInlineReply
                    ? 'h-[64px] min-h-[64px] pb-2'
                    : cn(
                        'h-[75px] min-h-[75px] border-0 bg-transparent text-center shadow-none focus-visible:ring-0 focus-visible:ring-offset-0',
                        sendInsideComposer || onStartDrawing ? 'pb-9' : 'pb-2',
                      ),
                  !isInlineReply && isSimulating && !isFocused && 'caret-transparent',
                )}
                rows={2}
              />
              {mentionOpen && (
                <div
                  role="listbox"
                  aria-label="提及成员"
                  className="absolute bottom-full left-0 z-30 mb-1 w-64 overflow-hidden rounded-md border border-border bg-popover p-1 shadow-lg"
                >
                  <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground">提及成员</p>
                  {filteredMentionCandidates.length === 0 ? (
                    <p className="px-2 py-2 text-xs text-muted-foreground">没有匹配的成员</p>
                  ) : filteredMentionCandidates.map((candidate, index) => (
                    <button
                      key={candidate.id}
                      type="button"
                      role="option"
                      aria-selected={index === mentionIndex}
                      onMouseDown={(event) => {
                        event.preventDefault()
                        selectMention(candidate)
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors',
                        index === mentionIndex ? 'bg-accent text-foreground' : 'text-foreground hover:bg-accent',
                      )}
                    >
                      <InitialsAvatar name={candidate.name} src={candidate.avatarUrl} size="sm" />
                      <span className="truncate">{candidate.name}</span>
                    </button>
                  ))}
                </div>
              )}
              {newComment.length === 0 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'pointer-events-none absolute top-2 select-none transition-opacity duration-150 ease-[var(--ease-standard)]',
                    isInlineReply ? 'left-3' : 'inset-x-0 flex justify-center',
                    isSimulating || isFocused ? 'opacity-0' : 'opacity-100',
                  )}
                >
                  <span className="comment-placeholder-shimmer select-none text-sm">
                    {isInlineReply ? t('replyPlaceholder') : t('typeMessage')}
                  </span>
                </span>
              )}
              {isSimulating && !isInlineReply && newComment.length === 0 && (
                <span
                  aria-hidden="true"
                  data-simulated-typing
                  className={cn(
                    'pointer-events-none absolute inset-x-0 top-2 flex select-none justify-center text-sm text-foreground transition-opacity duration-200 ease-[var(--ease-standard)]',
                    simulationVisible ? 'opacity-60' : 'opacity-0',
                  )}
                >
                  <span className="relative inline-block max-w-full text-left">
                    <span className="invisible whitespace-pre">{simulationSentence}</span>
                    <span data-simulated-text className="absolute inset-y-0 left-0 whitespace-pre">
                      {simulatedText}
                      <span className="ml-0.5 inline-block animate-pulse">|</span>
                    </span>
                  </span>
                </span>
              )}
              <div
                id="review-annotation-properties"
                className="pointer-events-none absolute inset-x-1 top-1 z-10 flex justify-center overflow-x-auto [&>*]:pointer-events-auto"
              />
              {sendInsideComposer && (
                // 和左边那排画笔同一条内嵌工具栏；整条 pointer-events-none，
                // 只有按钮自己接指针，压在文字区上也不会挡住点字定位光标。
                <div className="pointer-events-none absolute bottom-1 inset-x-2 flex h-8 items-center justify-end gap-1.5">
                  {/* 绘制批注入口 + 表情和时间码算一组：宽输入框里整体居中，窄栏仍靠左。 */}
                  <div
                    className={cn(
                      'pointer-events-auto flex min-w-0 items-center gap-1.5',
                      isWideComposer ? 'absolute left-1/2 top-0 -translate-x-1/2' : 'mr-auto',
                    )}
                  >
                    {attachmentButton}
                    {onVisibilityChange && !commentsDisabled && (
                      <button
                        ref={emojiBtnRef}
                        type="button"
                        onClick={toggleEmojiPicker}
                        className={cn(styles.trigger, 'pointer-events-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground')}
                        aria-label="添加表情符号"
                        aria-expanded={emojiOpen}
                        aria-haspopup="dialog"
                        aria-controls={emojiOpen ? emojiId : undefined}
                        data-review-popup-trigger
                        title="添加表情符号"
                      >
                        <CommentEmojiIcon className="h-[24px] w-[24px]" />
                      </button>
                    )}
                    {onStartDrawing && drawAnnotationTrigger}
                    {sendInsideComposer && showTimecodePill && (
                      <div className={cn('shrink-0', isWideComposer && 'absolute left-full top-0 ml-2')}>
                        {renderTimecodePill(true)}
                      </div>
                    )}
                  </div>
                  {visibilityPillVisible && onVisibilityChange && (
                    <button
                      ref={visBtnRef}
                      type="button"
                      data-review-mint-outline
                      onClick={toggleVisibilityDropdown}
                      disabled={visibilityLocked}
                      aria-disabled={visibilityLocked}
                      className={cn(styles.trigger, 'pointer-events-auto inline-flex h-[28px] shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-border/70 bg-background px-2 text-[11px] font-medium text-foreground/80 transition-colors enabled:hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50')}
                      aria-label={`评论可见性：${visibility === 'INTERNAL' ? '内部' : '公共'}`}
                      aria-expanded={visOpen}
                      aria-haspopup="menu"
                      aria-controls={visOpen ? visId : undefined}
                      data-review-popup-trigger
                      title={visibilityTitle}
                    >
                      {visibility === 'INTERNAL' ? <Users className="h-3.5 w-3.5" /> : <Globe className="h-3.5 w-3.5" />}
                      <span>{visibility === 'INTERNAL' ? '内部' : '公共'}</span>
                      <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    </button>
                  )}
                  <Button
                    data-review-mint-outline
                    onClick={onSubmit}
                    variant="default"
                    disabled={!canSubmit}
                    size="icon"
                    className="pointer-events-auto h-[28px] w-[40px] shrink-0"
                    aria-label={loading ? tCommon('sending') : tCommon('send')}
                    aria-busy={loading}
                  >
                    {loading ? <Loader2 style={{ width: 24, height: 24 }} className="animate-spin" /> : <SendPlaneIcon style={{ width: 24, height: 24 }} />}
                  </Button>
                </div>
              )}
            </div>
            {isInlineReply ? (
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
                  {attachmentButton}
                  {!commentsDisabled && (
                    <button
                      ref={emojiBtnRef}
                      type="button"
                      onClick={toggleEmojiPicker}
                      className={cn(styles.trigger, 'inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground')}
                      aria-label="添加表情符号"
                      aria-expanded={emojiOpen}
                      aria-haspopup="dialog"
                      aria-controls={emojiOpen ? emojiId : undefined}
                      data-review-popup-trigger
                      title="添加表情符号"
                    >
                      <CommentEmojiIcon className="h-[24px] w-[24px]" />
                    </button>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onCancelReply}
                    className="h-[32px] rounded-[6px] px-3 text-xs"
                  >
                    {tCommon('cancel')}
                  </Button>
                  <Button
                    onClick={onSubmit}
                    variant="default"
                    disabled={!canSubmit}
                    size="icon"
                    className="h-[32px] w-[32px] shrink-0 rounded-[6px]"
                    aria-label={loading ? tCommon('sending') : tCommon('send')}
                    aria-busy={loading}
                  >
                    {loading ? <Loader2 style={{ width: 24, height: 24 }} className="animate-spin" /> : <SendPlaneIcon style={{ width: 24, height: 24 }} />}
                  </Button>
                </div>
              </div>
            ) : !sendInsideComposer ? (
            <div className="flex h-8 min-w-0 items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
                {!sendInsideComposer && attachmentButton}
                {!sendInsideComposer && onVisibilityChange && !commentsDisabled && (
                  <button
                    ref={emojiBtnRef}
                    type="button"
                    onClick={toggleEmojiPicker}
                    className={cn(styles.trigger, 'inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground')}
                    aria-label="添加表情符号"
                    aria-expanded={emojiOpen}
                    aria-haspopup="dialog"
                    aria-controls={emojiOpen ? emojiId : undefined}
                    data-review-popup-trigger
                    title="添加表情符号"
                  >
                    <CommentEmojiIcon className="h-[24px] w-[24px]" />
                  </button>
                )}
                {!sendInsideComposer && onStartDrawing && drawAnnotationTrigger}
                {!sendInsideComposer && showTimecodePill && renderTimecodePill(false)}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {!sendInsideComposer && visibilityPillVisible && onVisibilityChange && (
                  <button
                    ref={visBtnRef}
                    type="button"
                    onClick={toggleVisibilityDropdown}
                    disabled={visibilityLocked}
                    aria-disabled={visibilityLocked}
                    className={cn(styles.trigger, 'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border/70 bg-background px-2 text-[11px] font-medium text-foreground/80 transition-colors enabled:hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50')}
                    aria-label={`评论可见性：${visibility === 'INTERNAL' ? '内部' : '公共'}`}
                    aria-expanded={visOpen}
                    aria-haspopup="menu"
                    aria-controls={visOpen ? visId : undefined}
                    data-review-popup-trigger
                    title={visibilityTitle}
                  >
                    {visibility === 'INTERNAL' ? <Users className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
                    <span>{visibility === 'INTERNAL' ? '内部' : '公共'}</span>
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                )}
                {!sendInsideComposer && (
                  <Button
                    onClick={onSubmit}
                    variant="default"
                    disabled={!canSubmit}
                    size="icon"
                    className="h-[28px] w-[40px] shrink-0"
                  >
                    <SendPlaneIcon style={{ width: 24, height: 24 }} />
                  </Button>
                )}
              </div>
            </div>
            ) : null}

            {!isInlineReply && onStartDrawing && (
              <ReviewPopup id={drawId} open={drawOpen} onOpenChange={setDrawOpen} anchor={drawBtnRef} label="绘制批注" role="menu" align="start" width={192}>
                <div className="flex items-center gap-0.5">{drawingMenuItems}</div>
              </ReviewPopup>
            )}
            <ReviewPopup id={emojiId} open={emojiOpen} onOpenChange={setEmojiOpen} anchor={emojiBtnRef} returnFocus={textareaRef} label="选择表情符号" align="center" width={298}>
              <EmojiPicker onSelect={insertEmoji} onClose={() => setEmojiOpen(false)} />
            </ReviewPopup>
            {!isInlineReply && (
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
            )}
          </div>
          {(attachmentError || attachmentNotice) && (
            <p className={`mt-2 text-xs ${attachmentError ? 'text-destructive' : 'text-muted-foreground'}`}>
              {attachmentError || attachmentNotice}
            </p>
          )}

        </>
      )}
    </div>
  )
}
