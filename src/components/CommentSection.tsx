'use client'

import { useState, useEffect, useRef, useMemo, useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Comment, Video } from '@prisma/client'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'
import { Check, CheckCircle2, MessageSquare, MessageSquareText, MoreHorizontal, ChevronDown, ChevronUp, Filter, Info, Search, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import MessageBubble from './MessageBubble'
import CommentInput from './CommentInput'
import CommentSortMenu, { type CommentSortMode } from './CommentSortMenu'
import ReviewPopup from './ReviewPopup'
import popupStyles from './review-popup.module.css'
import { useCommentManagement } from '@/hooks/useCommentManagement'
import { apiFetch } from '@/lib/api-client'
import { getAccessToken } from '@/lib/token-store'
import { timecodeToSeconds, timecodeToSeekSeconds } from '@/lib/timecode'
import { formatTimecodeAs } from '@/lib/time-format'
import { useTimeFormat } from '@/hooks/useTimeFormat'

type CommentWithReplies = Comment & {
  replies?: Comment[]
}

interface CommentSectionProps {
  projectId: string
  projectSlug?: string | null
  comments: CommentWithReplies[]
  focusCommentId?: string | null
  clientName: string
  clientEmail?: string
  isApproved: boolean
  restrictToLatestVersion?: boolean
  videos?: Video[]
  isAdminView?: boolean
  smtpConfigured?: boolean
  isPasswordProtected?: boolean
  adminUser?: any
  recipients?: Array<{ id: string; name: string | null; email: string | null }>
  shareToken?: string | null
  showShortcutsButton?: boolean
  /**
   * @deprecated 10-19 起屏幕上的时间读数由本机那枚「时间格式」选择决定（`hooks/useTimeFormat`）。
   *   审片页那两份文件在冻结区还在传这一枚，所以接口留着，组件里不再读它。
   */
  timestampDisplayMode?: 'TIMECODE' | 'AUTO'
  mobileCollapsible?: boolean
  initialMobileCollapsed?: boolean
  authenticatedEmail?: string | null
  authenticatedName?: string | null
  allowClientAssetUpload?: boolean
  maxCommentAttachments?: number
  onToggleVisibility?: () => void
  showToggleButton?: boolean
  /** `信息` 按钮靠 ProjectInfo 监听 openReviewInfo，项目工作区没有它。 */
  showInfoButton?: boolean
  /** 审片页右栏切换「讨论 / 信息」用；传入后信息在栏内直接渲染，不再弹窗。 */
  infoContent?: ReactNode
  /** 批注可见范围选择器（公开/内部）：共享链接客户端页传 false——服务端对共享端一律强制公开。 */
  showVisibilitySelector?: boolean
  /** 底部输入框是否展开；审片页收起右侧批注栏时一起折叠，但保留输入状态。 */
  showComposer?: boolean
  /** 「Enter 发送」提示 + 发送钮搬进输入框内、和画笔同一排；页内批注栏传 true，审片页保持原样。 */
  sendInsideComposer?: boolean
  onMobileExpandedChange?: (expanded: boolean) => void
  isReviewAuthenticated?: boolean
  onRequireLogin?: () => void
}

export default function CommentSection({
  projectId,
  projectSlug = null,
  comments: initialComments,
  focusCommentId = null,
  isApproved,
  restrictToLatestVersion = false,
  videos = [],
  isAdminView = false,
  smtpConfigured: _smtpConfigured = false,
  adminUser = null,
  shareToken = null,
  showShortcutsButton = false,
  mobileCollapsible = false,
  initialMobileCollapsed = true,
  authenticatedName = null,
  allowClientAssetUpload = false,
  maxCommentAttachments,
  onToggleVisibility,
  showToggleButton = false,
  showInfoButton = true,
  infoContent,
  showVisibilitySelector = true,
  showComposer = true,
  sendInsideComposer = false,
  onMobileExpandedChange,
  isReviewAuthenticated = false,
  onRequireLogin,
}: CommentSectionProps) {
  const t = useTranslations('comments')
  const tCommon = useTranslations('common')
  const tu = useTranslations('videoUi')
  const format = useTimeFormat()
  const [isMobileCollapsed, setIsMobileCollapsed] = useState(initialMobileCollapsed)
  const [resolvedOverrides, setResolvedOverrides] = useState<Record<string, boolean>>({})
  const [composerTarget, setComposerTarget] = useState<HTMLElement | null>(null)
  const [composerClipped, setComposerClipped] = useState(!showComposer)
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPEN' | 'RESOLVED'>('ALL')
  const [commentQuery, setCommentQuery] = useState('')
  const [commentSort, setCommentSort] = useState<CommentSortMode>('timecode')
  const [panelTab, setPanelTab] = useState<'discussion' | 'info'>('discussion')
  const [filterOpen, setFilterOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const filterButtonRef = useRef<HTMLButtonElement | null>(null)
  const moreButtonRef = useRef<HTMLButtonElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const panelTabId = useId()
  const filterMenuId = useId()
  const moreMenuId = useId()
  const hasReviewTabs = showInfoButton && Boolean(infoContent)
  const searchExpanded = searchOpen || Boolean(commentQuery)

  useEffect(() => {
    if (!hasReviewTabs) return
    const query = window.matchMedia('(max-width: 639px)')
    const resetOnMobile = () => {
      if (query.matches) setPanelTab('discussion')
    }
    resetOnMobile()
    query.addEventListener('change', resetOnMobile)
    return () => query.removeEventListener('change', resetOnMobile)
  }, [hasReviewTabs])

  useEffect(() => {
    if (hasReviewTabs && panelTab === 'discussion' && searchExpanded) {
      searchInputRef.current?.focus()
    } else {
      searchInputRef.current?.blur()
    }
  }, [hasReviewTabs, panelTab, searchExpanded])

  useEffect(() => {
    const resolveComposer = () => {
      const target = document.getElementById('review-comment-composer')
      if (target) setComposerTarget(target)
      return Boolean(target)
    }

    if (resolveComposer()) return

    // The player can mount after the comment panel. Keep the composer attached
    // when that happens instead of dropping the input on the first render.
    const observer = new MutationObserver(resolveComposer)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!showComposer) {
      setComposerClipped(true)
      return
    }
    const timer = window.setTimeout(() => setComposerClipped(false), 320)
    return () => window.clearTimeout(timer)
  }, [showComposer])
  const {
    comments,
    newComment,
    mentionedUserIds,
    setMentionedUserIds,
    selectedTimestamp,
    selectedVideoId,
    selectedVideoFps,
    loading,
    replyingToCommentId,
    pendingAttachments,
    attachmentError,
    attachmentNotice,
    pendingAnnotation,
    selectedTimecodeEnd,
    isSelectingTimecodeEnd,
    handleCommentChange,
    handleSubmitComment,
    handleSubmitReply,
    handleReply,
    handleCancelReply,
    replyDrafts,
    replyAttachments,
    replyErrors,
    replySubmittingId,
    replyClosingId,
    handleReplyDraftChange,
    handleReplyAttachmentAdded,
    handleRemoveReplyAttachment,
    handleReplyAttachmentErrorChange,
    replyFocusRequest,
    handleDeleteComment,
    handleAttachmentAdded,
    handleRemoveAttachment,
    handleAttachmentErrorChange,
    handleStartDrawing,
    handleSetTimecodeEnd,
    commentVisibility,
    setCommentVisibility,
  } = useCommentManagement({
    projectId,
    initialComments,
    videos,
    adminUser,
    restrictToLatestVersion,
    shareToken,
    shareSlug: projectSlug,
    useAdminAuth: isAdminView,
    authenticatedName,
  })

  const [localComments, setLocalComments] = useState<CommentWithReplies[]>(initialComments)
  const [mentionCandidates, setMentionCandidates] = useState<Array<{ id: string; name: string; avatarUrl?: string | null }>>([])

  useEffect(() => {
    if (!showVisibilitySelector) {
      setMentionCandidates([])
      return
    }
    let cancelled = false
    void apiFetch(`/api/projects/${projectId}/members`, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return
        const members = Array.isArray(data?.members) ? data.members : []
        setMentionCandidates(
          members
            .filter((member: any) => member?.id && member.id !== adminUser?.id)
            .map((member: any) => ({
              id: member.id,
              name: member.name || member.email || '成员',
              avatarUrl: member.avatarUrl ?? null,
            })),
        )
      })
      .catch(() => {
        if (!cancelled) setMentionCandidates([])
      })
    return () => {
      cancelled = true
    }
  }, [projectId, showVisibilitySelector, adminUser?.id])

  // The page-level review shell owns comment fetching and passes the current
  // tree down. Keep a local copy only for optimistic comments while a parent
  // update is being committed; this component must not issue a second request
  // for the same global comment event.
  useEffect(() => {
    setLocalComments(initialComments)
  }, [initialComments])

  const lastFocusedCommentRef = useRef<string | null>(null)
  useEffect(() => {
    if (!focusCommentId) return
    if (lastFocusedCommentRef.current === focusCommentId) return

    lastFocusedCommentRef.current = focusCommentId

    let attempts = 0
    const maxAttempts = 6

    const tryScroll = () => {
      attempts += 1
      const element = document.getElementById(`comment-${focusCommentId}`)
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' })
        element.style.transition = 'background-color 0.3s'
        element.style.backgroundColor = 'hsl(var(--primary) / 0.12)'
        setTimeout(() => {
          element.style.backgroundColor = ''
        }, 1000)
        return
      }

      if (attempts < maxAttempts) {
        setTimeout(tryScroll, 200)
      }
    }

    setTimeout(tryScroll, 100)
  }, [focusCommentId, localComments.length])

  // The inline composer grows below the thread; keep it fully visible without
  // pushing the comment above it out of the list. `scrollIntoView` is unreliable
  // here because the pane can still be settling when the composer mounts.
  useEffect(() => {
    if (!replyingToCommentId) return
    let cancelled = false
    let secondFrame = 0

    const reveal = () => {
      if (cancelled) return
      const element = document.getElementById(`inline-reply-${replyingToCommentId}`)
      const container = element?.closest<HTMLElement>('[data-comment-scroll]')
      if (!element || !container) return

      const elementRect = element.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()
      let delta = 0
      if (elementRect.bottom > containerRect.bottom - 4) {
        delta = elementRect.bottom - containerRect.bottom + 8
      } else if (elementRect.top < containerRect.top + 4) {
        delta = elementRect.top - containerRect.top - 8
      }
      if (delta !== 0) {
        container.scrollTop = Math.max(0, container.scrollTop + delta)
      }

      // On phones the page, not the list, is the scroll container once the
      // keyboard shrinks the visual viewport. Only nudge when the composer is
      // actually outside the visible area.
      const viewport = window.visualViewport
      const viewportTop = viewport?.offsetTop ?? 0
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight)
      const updatedRect = element.getBoundingClientRect()
      if (updatedRect.bottom > viewportBottom - 4 || updatedRect.top < viewportTop + 4) {
        element.scrollIntoView({ block: 'nearest' })
      }
    }

    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(reveal)
    })
    const settleTimer = window.setTimeout(reveal, 260)
    const lateTimer = window.setTimeout(reveal, 540)
    window.addEventListener('resize', reveal)
    window.visualViewport?.addEventListener('resize', reveal)
    return () => {
      cancelled = true
      cancelAnimationFrame(firstFrame)
      cancelAnimationFrame(secondFrame)
      window.clearTimeout(settleTimer)
      window.clearTimeout(lateTimer)
      window.removeEventListener('resize', reveal)
      window.visualViewport?.removeEventListener('resize', reveal)
    }
  }, [replyingToCommentId, replyFocusRequest])

  const videoById = useMemo(() => new Map(videos.map((video) => [video.id, video])), [videos])
  const latestVideoVersion = useMemo(() => (
    videos.length > 0 ? Math.max(...videos.map(v => v.version)) : null
  ), [videos])

  const currentVideo = selectedVideoId ? videoById.get(selectedVideoId) : undefined
  const currentVideoDuration = currentVideo?.duration ?? null
  const isCurrentVideoApproved = currentVideo ? (currentVideo as any).approved === true : false
  // Check if ANY video in the group is approved (for admin view with multiple versions)
  const approvedVideo = useMemo(() => videos.find(v => (v as any).approved === true), [videos])
  // Sharing a project is not the same as approving it. Only lock comments for
  // an explicitly approved project or the currently approved version.
  const commentsDisabled = isApproved || isCurrentVideoApproved

  // Always use hook comments (includes optimistic updates)
  // Local comments only used as fallback if hook hasn't loaded
  const mergedComments = useMemo(() => Array.from(
    // The page prop is authoritative. This also prevents a stale local copy
    // from briefly overwriting a freshly fetched tree during the effect that
    // mirrors `initialComments`.
    new Map([...localComments, ...comments].map((comment) => [comment.id, comment])).values(),
  ), [comments, localComments])

  const displayComments = useMemo(() => {
    if (!selectedVideoId) {
      // No video selected - show all or latest version only
      return restrictToLatestVersion && latestVideoVersion
        ? mergedComments.filter(comment => comment.videoVersion === latestVideoVersion)
        : mergedComments
    }

    // Both admin and share page: show comments for specific videoId only
    return mergedComments.filter(comment => comment.videoId === selectedVideoId)
  }, [latestVideoVersion, mergedComments, restrictToLatestVersion, selectedVideoId])

  const filteredByStatus = useMemo(() => displayComments.filter((comment) => {
    const resolved = resolvedOverrides[comment.id] ?? (comment as any).resolved === true
    if (statusFilter === 'OPEN' && resolved) return false
    if (statusFilter === 'RESOLVED' && !resolved) return false
    const query = commentQuery.trim().toLowerCase()
    if (query) {
      const haystack = [
        comment.content,
        (comment as any).authorName,
        (comment as any).user?.name,
        (comment as any).user?.email,
      ].filter(Boolean).join(' ').toLowerCase()
      if (!haystack.includes(query)) return false
    }
    return true
  }), [commentQuery, displayComments, resolvedOverrides, statusFilter])

  const sortedComments = useMemo(() => {
    const getTimelineSeconds = (comment: Comment) => {
      if (!comment.timecode) return Number.POSITIVE_INFINITY

      const fps = videoById.get(comment.videoId)?.fps || 24
      try {
        return timecodeToSeconds(comment.timecode, fps)
      } catch {
        return Number.POSITIVE_INFINITY
      }
    }

    return [...filteredByStatus]
      .sort((a, b) => {
        if (commentSort === 'newest') {
          const newestDifference = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          return newestDifference || a.id.localeCompare(b.id)
        }

        if (commentSort === 'unresolved') {
          const aResolved = resolvedOverrides[a.id] ?? (a as any).resolved === true
          const bResolved = resolvedOverrides[b.id] ?? (b as any).resolved === true
          if (aResolved !== bResolved) return aResolved ? 1 : -1
        }

        const aTimelineSeconds = getTimelineSeconds(a)
        const bTimelineSeconds = getTimelineSeconds(b)
        if (aTimelineSeconds !== bTimelineSeconds) return aTimelineSeconds - bTimelineSeconds

        const createdAtDifference = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        return createdAtDifference || a.id.localeCompare(b.id)
      })
      .map((comment) => comment.replies && comment.replies.length > 0
        ? {
            ...comment,
            replies: [...comment.replies].sort((a: Comment, b: Comment) => (
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            )),
          }
        : comment)
  }, [commentSort, filteredByStatus, resolvedOverrides, videoById])

  const latestComment = useMemo(() => sortedComments.reduce<CommentWithReplies | null>((latest, comment) => {
    if (!latest) return comment
    return new Date(comment.createdAt).getTime() > new Date(latest.createdAt).getTime() ? comment : latest
  }, null), [sortedComments])

  const isCurrentVideoAllowed = () => {
    if (!restrictToLatestVersion) return true
    if (!selectedVideoId) return true
    const selectedVideo = videoById.get(selectedVideoId)
    if (!selectedVideo) return true
    return selectedVideo.version === latestVideoVersion
  }

  const currentVideoRestricted = Boolean(restrictToLatestVersion && selectedVideoId && !isCurrentVideoAllowed())
  const restrictionMessage = currentVideoRestricted
    ? `You can only leave feedback on the latest version. Please switch to version ${latestVideoVersion} to comment.`
    : undefined

  const handleSubmitWithAuth = () => {
    if (!isAdminView && !isReviewAuthenticated) {
      onRequireLogin?.()
      return
    }
    void handleSubmitComment()
  }

  const handleSubmitReplyWithAuth = (commentId: string) => {
    if (!isAdminView && !isReviewAuthenticated) {
      onRequireLogin?.()
      return
    }
    void handleSubmitReply(commentId)
  }

  const formatMessageTime = (date: Date) => {
    const value = new Date(date)
    const now = new Date()
    const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    const pad = (n: number) => String(n).padStart(2, '0')
    const time = `${pad(value.getHours())}:${pad(value.getMinutes())}`

    if (dayKey(value) === dayKey(now)) return `今天 ${time}`
    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)
    if (dayKey(value) === dayKey(yesterday)) return `昨天 ${time}`
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${time}`
  }

  const handleSeekToTimestamp = (timestamp: number, videoId: string, videoVersion: number | null) => {
    const hasVideoPlayer = typeof window !== 'undefined' && document.querySelector('video')

    if (hasVideoPlayer) {
      window.dispatchEvent(new CustomEvent('seekToTime', {
        detail: { timestamp, videoId, videoVersion }
      }))
    } else if (isAdminView) {
      // If in admin view without video player, navigate to admin share page with timestamp
      const video = videoById.get(videoId)
      if (!video) return

      const adminShareUrl = `/studio/projects/${projectId}/share?video=${encodeURIComponent(video.name)}&version=${videoVersion || video.version}&t=${encodeURIComponent(timestamp.toFixed(6))}`
      window.location.href = adminShareUrl
    }
  }

  const handleSeekToTimecode = (timecode: string, videoId: string, videoVersion: number | null) => {
    const fps = videoById.get(videoId)?.fps || 24
    const seconds = timecodeToSeekSeconds(timecode, fps)
    handleSeekToTimestamp(seconds, videoId, videoVersion)
  }

  const handleOpenShortcuts = () => {
    window.dispatchEvent(new CustomEvent('openShortcutsDialog'))
  }

  const selectPanelTab = (tab: 'discussion' | 'info') => {
    setPanelTab(tab)
    setFilterOpen(false)
    setMoreOpen(false)
  }

  const clearCommentFilters = () => {
    setStatusFilter('ALL')
    setCommentQuery('')
    setSearchOpen(false)
  }

  const toolbarIconClass = (active = false) => cn(
    'relative inline-flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[6px] text-muted-foreground outline-none transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
    active && 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
  )

  const handleToggleResolved = async (commentId: string, resolved: boolean) => {
    setResolvedOverrides((current) => ({ ...current, [commentId]: resolved }))
    try {
      const accountToken = getAccessToken()
      const response = isAdminView
        ? await apiFetch(`/api/comments/${commentId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ resolved }),
          })
        : await fetch(`/api/comments/${commentId}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              // 分享页的管理员与评论读取一样需要双凭证：分享链接证明链接权限，
              // 账号 token 让服务端识别团队成员/作者，否则 PATCH 会 403 后回滚。
              ...(shareToken ? { 'X-Share-Token': `Bearer ${shareToken}` } : {}),
              ...(accountToken ? { Authorization: `Bearer ${accountToken}` } : {}),
            },
            body: JSON.stringify({ resolved }),
          })
      if (!response.ok) throw new Error('批注状态更新失败')
    } catch {
      setResolvedOverrides((current) => ({ ...current, [commentId]: !resolved }))
    }
  }

  return (
    <Card
      className="flex h-full flex-col overflow-hidden rounded-none border-0 lg:max-h-full"
      style={{ backgroundColor: 'hsl(var(--review-chrome, var(--card)))' }}
      data-comment-section
    >
      {/* Desktop: Show header at top, Mobile: Hide header (will show below input) */}
      <CardHeader className={cn(
        'flex-shrink-0 px-4 py-3',
        mobileCollapsible && 'hidden sm:block',
        hasReviewTabs ? 'border-b-0 px-3 pb-2.5 pt-2.5' : 'border-b border-border/70',
      )}>
        {hasReviewTabs ? (
          <>
            <div
              role="tablist"
              aria-label={`${t('discussion')} / ${t('info')}`}
              className="relative grid h-[36px] grid-cols-2 items-center rounded-[8px] bg-secondary p-[3px]"
            >
              <span
                aria-hidden="true"
                data-panel-tab-thumb
                className={cn(
                  'pointer-events-none absolute inset-y-[3px] left-[3px] w-[calc(50%-3px)] rounded-[6px] bg-popover shadow-sm ring-1 ring-border/50',
                  panelTab === 'info' && 'translate-x-full',
                )}
              />
              <button
                type="button"
                role="tab"
                id={`${panelTabId}-discussion`}
                aria-selected={panelTab === 'discussion'}
                aria-controls={`${panelTabId}-panel`}
                onClick={() => selectPanelTab('discussion')}
                className={cn(
                  'relative z-10 inline-flex h-[30px] items-center justify-center rounded-[6px] text-[13px] font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring',
                  panelTab === 'discussion' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t('discussion')}
              </button>
              <button
                type="button"
                role="tab"
                id={`${panelTabId}-info`}
                aria-selected={panelTab === 'info'}
                aria-controls={`${panelTabId}-panel`}
                onClick={() => selectPanelTab('info')}
                className={cn(
                  'relative z-10 inline-flex h-[30px] items-center justify-center rounded-[6px] text-[13px] font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring',
                  panelTab === 'info' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t('info')}
              </button>
            </div>

            {panelTab === 'discussion' && (
              <>
                <div className="mt-3 flex min-w-0 items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium text-foreground">{t('allComments')}</span>
                    <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground">
                      {sortedComments.length}
                    </span>
                    {selectedVideoId && currentVideo && !isAdminView && (
                      <span
                        title={commentsDisabled
                          ? t('watchingApprovedVersion')
                          : `${t('currentlyViewing')} ${currentVideo.versionLabel}`}
                        className="inline-flex max-w-[80px] items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                      >
                        {commentsDisabled && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />}
                        <span className="truncate">{currentVideo.versionLabel}</span>
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <div className="relative">
                      <button
                        ref={filterButtonRef}
                        type="button"
                        data-review-popup-trigger
                        onClick={() => setFilterOpen((open) => !open)}
                        aria-haspopup="menu"
                        aria-expanded={filterOpen}
                        aria-controls={filterOpen ? filterMenuId : undefined}
                        aria-label={t('filter')}
                        title={t('filter')}
                        className={toolbarIconClass(statusFilter !== 'ALL')}
                      >
                        <MessageSquareText className="h-4 w-4" aria-hidden="true" />
                        {statusFilter !== 'ALL' && (
                          <span aria-hidden="true" className="absolute right-[5px] top-[5px] h-1.5 w-1.5 rounded-full bg-primary" />
                        )}
                      </button>
                      <ReviewPopup
                        id={filterMenuId}
                        open={filterOpen}
                        onOpenChange={setFilterOpen}
                        anchor={filterButtonRef}
                        label={t('filter')}
                        role="menu"
                        side="bottom"
                        align="end"
                        width={176}
                      >
                        <p className={popupStyles.heading}>{t('filter')}</p>
                        {([
                          ['ALL', t('filterAll')],
                          ['OPEN', t('filterUnresolved')],
                          ['RESOLVED', t('filterResolved')],
                        ] as const).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            role="menuitemradio"
                            aria-checked={statusFilter === value}
                            onClick={() => {
                              setStatusFilter(value)
                              setFilterOpen(false)
                            }}
                            className={popupStyles.item}
                          >
                            <span className="min-w-0 flex-1 truncate">{label}</span>
                            {statusFilter === value && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                          </button>
                        ))}
                        {(statusFilter !== 'ALL' || commentQuery) && (
                          <button
                            type="button"
                            onClick={() => {
                              clearCommentFilters()
                              setFilterOpen(false)
                            }}
                            className={popupStyles.item}
                          >
                            <span className="min-w-0 flex-1 truncate">{tu('clearFilters')}</span>
                          </button>
                        )}
                      </ReviewPopup>
                    </div>

                    <CommentSortMenu value={commentSort} onChange={setCommentSort} variant="icon" />

                    <button
                      type="button"
                      onClick={() => {
                        if (searchOpen || commentQuery) {
                          setCommentQuery('')
                          setSearchOpen(false)
                        } else {
                          setSearchOpen(true)
                        }
                      }}
                      aria-label={searchExpanded ? tu('clearSearch') : tu('searchComments')}
                      title={searchExpanded ? tu('clearSearch') : tu('searchComments')}
                      aria-expanded={searchExpanded}
                      aria-controls={`${panelTabId}-search`}
                      className={toolbarIconClass(searchOpen || Boolean(commentQuery))}
                    >
                      <Search className="h-4 w-4" aria-hidden="true" />
                    </button>

                    {(showShortcutsButton || statusFilter !== 'ALL' || Boolean(commentQuery)) && (
                      <div className="relative">
                        <button
                          ref={moreButtonRef}
                          type="button"
                          data-review-popup-trigger
                          onClick={() => setMoreOpen((open) => !open)}
                          aria-haspopup="menu"
                          aria-expanded={moreOpen}
                          aria-controls={moreOpen ? moreMenuId : undefined}
                          aria-label={t('more')}
                          title={t('more')}
                          className={toolbarIconClass(moreOpen)}
                        >
                          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <ReviewPopup
                          id={moreMenuId}
                          open={moreOpen}
                          onOpenChange={setMoreOpen}
                          anchor={moreButtonRef}
                          label={t('more')}
                          role="menu"
                          side="bottom"
                          align="end"
                          width={190}
                        >
                          <p className={popupStyles.heading}>{t('more')}</p>
                          {(statusFilter !== 'ALL' || commentQuery) && (
                            <button
                              type="button"
                              onClick={() => {
                                clearCommentFilters()
                                setMoreOpen(false)
                              }}
                              className={popupStyles.item}
                            >
                              <span className="min-w-0 flex-1 truncate">{tu('clearFilters')}</span>
                            </button>
                          )}
                          {showShortcutsButton && (
                            <button
                              type="button"
                              onClick={() => {
                                setMoreOpen(false)
                                handleOpenShortcuts()
                              }}
                              className={popupStyles.item}
                            >
                              <span className="min-w-0 flex-1 truncate">{t('shortcuts')}</span>
                            </button>
                          )}
                        </ReviewPopup>
                      </div>
                    )}
                  </div>
                </div>

                <div
                  id={`${panelTabId}-search`}
                  data-comment-search
                  data-open={searchExpanded ? 'true' : 'false'}
                  aria-hidden={!searchExpanded ? true : undefined}
                  inert={!searchExpanded ? true : undefined}
                >
                  <div className="min-h-0 overflow-hidden">
                    <div className="relative mt-2">
                      <Search className="pointer-events-none absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                      <input
                        ref={searchInputRef}
                        value={commentQuery}
                        onChange={(event) => setCommentQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            setCommentQuery('')
                            setSearchOpen(false)
                          }
                        }}
                        placeholder={tu('searchComments')}
                        aria-label={tu('searchComments')}
                        className="h-[30px] w-full rounded-md border border-border bg-background pl-7 pr-8 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setCommentQuery('')
                          setSearchOpen(false)
                        }}
                        aria-label={tu('clearSearch')}
                        className="absolute right-1 top-[3px] inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base text-foreground">
            <MessageSquare className="h-4 w-4" />
            {t('feedbackAndDiscussion')}
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {sortedComments.length}
            </span>
          </CardTitle>
          {showInfoButton && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.dispatchEvent(new CustomEvent('openReviewInfo'))}
              className="h-[28px] gap-1.5 px-2 text-muted-foreground hover:text-foreground"
              title="视频信息"
            >
              <Info className="h-4 w-4" />
              <span>信息</span>
            </Button>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            <Filter className="h-3 w-3" />
            筛选
          </span>
          <div className="inline-flex h-[28px] items-center rounded-md border border-border bg-muted/30 p-0.5">
            {([
              ['ALL', '全部'],
              ['OPEN', '未解决'],
              ['RESOLVED', '已解决'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatusFilter(value)}
                className={`h-[24px] rounded px-2 text-[11px] font-medium transition-colors ${
                  statusFilter === value
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {(statusFilter !== 'ALL'  || commentQuery) && (
            <button
              type="button"
              onClick={() => {
                setStatusFilter('ALL')
                setCommentQuery('')
              }}
              className="h-[28px] rounded-md border border-border/70 bg-background px-2 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              清除
            </button>
          )}
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={commentQuery}
              onChange={(event) => setCommentQuery(event.target.value)}
              placeholder={tu('searchComments')}
              aria-label={tu('searchComments')}
              className="h-[28px] w-full rounded-md border border-border bg-background pl-7 pr-6 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {commentQuery && (
              <button
                type="button"
                onClick={() => setCommentQuery('')}
                aria-label={tu('clearSearch')}
                className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <CommentSortMenu value={commentSort} onChange={setCommentSort} />
        </div>
            {selectedVideoId && currentVideo && !isAdminView && (
              <p className="text-xs text-muted-foreground mt-1">
                {commentsDisabled
                  ? t('watchingApprovedVersion')
                  : `${t('currentlyViewing')} ${currentVideo.versionLabel}`}
              </p>
            )}
          </>
        )}
      </CardHeader>

      <CardContent className="flex-1 flex flex-col p-0 overflow-hidden min-h-0">
        {/* Approval Status Banner */}
        {commentsDisabled && (
          <div className="bg-success-visible border-b-2 border-success-visible p-4 flex-shrink-0">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-8 h-8 text-success flex-shrink-0" />
              <div>
                <h3 className="text-foreground font-medium">
                  {isApproved ? t('projectApproved') : t('videoApproved')}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {isApproved
                    ? t('approvedDownloadReady')
                    : approvedVideo
                    ? t('versionApprovedDownload', { versionLabel: approvedVideo.versionLabel })
                    : t('aVersionApprovedDownload')}
                </p>
              </div>
            </div>
          </div>
        )}

        {hasReviewTabs && panelTab === 'info' && (
          <div
            id={`${panelTabId}-panel`}
            role="tabpanel"
            aria-labelledby={`${panelTabId}-info`}
            data-hide-scrollbar
            className="min-h-0 flex-1 overflow-y-auto"
          >
            {infoContent}
          </div>
        )}

        {/* Collapsible header for messages (mobile only) - NOW includes "Feedback & Discussion" title */}
        {mobileCollapsible && (
          <button
            onClick={() => {
              const newCollapsed = !isMobileCollapsed
              setIsMobileCollapsed(newCollapsed)
              onMobileExpandedChange?.(!newCollapsed)
            }}
            className="order-2 sm:hidden w-full p-3 flex items-center justify-between border-b border-border/70"
            style={{ backgroundColor: 'hsl(var(--review-chrome, var(--card)))' }}
          >
            <span className="text-sm font-medium flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              {isMobileCollapsed
                ? `${t('feedbackAndDiscussion')} (${sortedComments.length}) — ${t('tapToExpand')}`
                : `${t('feedbackAndDiscussion')} (${sortedComments.length})`
              }
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {latestComment ? formatMessageTime(latestComment.createdAt) : ''}
              </span>
              {isMobileCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </div>
          </button>
        )}

        {/* Messages Area - Threaded Conversations */}
        <div
          data-comment-scroll
          data-hide-scrollbar
          role={hasReviewTabs && panelTab === 'discussion' ? 'tabpanel' : undefined}
          id={hasReviewTabs && panelTab === 'discussion' ? `${panelTabId}-panel` : undefined}
          aria-labelledby={hasReviewTabs && panelTab === 'discussion' ? `${panelTabId}-discussion` : undefined}
          className={cn(
            "min-h-0 flex-1 space-y-[8px] overflow-y-auto p-[8px]",
            mobileCollapsible && "order-3 sm:order-2",
            mobileCollapsible && isMobileCollapsed && "hidden sm:block",
            hasReviewTabs && panelTab === 'info' && "hidden sm:hidden"
          )}
        >
          {sortedComments.length === 0 ? (
            <div className="text-center py-12">
              <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">
                {commentQuery.trim() || statusFilter !== 'ALL'
                  ? tu('noMatchingComments')
                  : t('noMessages')}
              </p>
            </div>
          ) : (
            <>
              {sortedComments.map((comment, index) => {
                const sequenceNumber = index + 1
                const replies = comment.replies || []
                const video = videoById.get(comment.videoId)
                const fps = video?.fps || 24
                const duration = video?.duration
                const showTimestamp =
                  typeof comment.timecode === 'string' &&
                  comment.timecode.trim() !== ''
                const timestampLabel = showTimestamp
                  ? formatTimecodeAs(comment.timecode, fps, duration, format)
                  : null
                const timecodeEndLabel = (comment as any).timecodeEnd
                  ? formatTimecodeAs((comment as any).timecodeEnd, fps, duration, format)
                  : null
                const hasAnnotation = !!(comment as any).annotations
                const isResolved = resolvedOverrides[comment.id] ?? (comment as any).resolved === true
                const isReplying = replyingToCommentId === comment.id && !commentsDisabled
                const isReplyClosing = replyClosingId === comment.id

                return (
                  <div
                    key={comment.id}
                    id={`comment-${comment.id}`}
                    data-comment-resolved={isResolved || undefined}
                    className={cn(
                      'relative rounded-[8px] bg-muted/40 outline outline-1 outline-transparent transition-[box-shadow,outline-color] duration-150 ease-[var(--ease-standard)] motion-reduce:transition-none',
                      isReplying && !isReplyClosing
                        ? 'outline-primary/30 shadow-elevation'
                        : 'hover:outline-border/70 hover:shadow-elevation-sm',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      data-resolve-fill
                      className="pointer-events-none absolute inset-0 z-0 rounded-[8px] bg-success/10"
                    />
                    <MessageBubble
                      comment={{ ...comment, resolved: isResolved } as any}
                      isReply={false}
                      onReply={() => {
                        if (replyingToCommentId === comment.id && replyClosingId !== comment.id) {
                          handleCancelReply(comment.id)
                          return
                        }
                        handleReply(comment.id)
                      }}
                      onSeekToTimecode={handleSeekToTimecode}
                      onDelete={isAdminView || (comment as any).canDelete ? () => handleDeleteComment(comment.id) : undefined}
                      formatMessageTime={formatMessageTime}
                      commentsDisabled={commentsDisabled}
                      sequenceNumber={sequenceNumber}
                      replies={replies}
                      onDeleteReply={handleDeleteComment}
                      canDeleteReply={(reply: any) => isAdminView || Boolean(reply.canDelete)}
                      timestampLabel={timestampLabel}
                      timecodeEndLabel={timecodeEndLabel}
                      hasAnnotation={hasAnnotation}
                      shareToken={shareToken}
                      onToggleResolved={isAdminView || (comment as any).canDelete
                        ? (resolved) => handleToggleResolved(comment.id, resolved)
                        : undefined}
                      inlineReplyClosing={isReplyClosing}
                      inlineReply={isReplying ? (
                        <div id={`inline-reply-${comment.id}`}>
                          <CommentInput
                            variant="inlineReply"
                            newComment={replyDrafts[comment.id] ?? ''}
                            onCommentChange={(value) => handleReplyDraftChange(comment.id, value)}
                            onSubmit={() => handleSubmitReplyWithAuth(comment.id)}
                            loading={replySubmittingId === comment.id}
                            onCancelReply={() => handleCancelReply(comment.id)}
                            focusRequest={replyFocusRequest}
                            selectedTimestamp={null}
                            selectedVideoFps={fps}
                            selectedVideoDurationSeconds={duration ?? null}
                            commentsDisabled={commentsDisabled}
                            currentVideoRestricted={false}
                            allowClientAssetUpload={allowClientAssetUpload}
                            selectedVideoId={comment.videoId}
                            pendingAttachments={replyAttachments[comment.id] || []}
                            onAttachmentAdded={(attachment) => {
                              if (attachment.videoId !== comment.videoId) return
                              handleReplyAttachmentAdded(comment.id, attachment)
                            }}
                            onRemoveAttachment={(assetId) => {
                              void handleRemoveReplyAttachment(comment.id, assetId)
                            }}
                            attachmentError={replyErrors[comment.id] || null}
                            onAttachmentErrorChange={(message) => handleReplyAttachmentErrorChange(comment.id, message)}
                            shareToken={shareToken}
                            shareSlug={projectSlug}
                            maxCommentAttachments={maxCommentAttachments}
                            pendingAnnotation={false}
                          />
                        </div>
                      ) : undefined}
                    />
                  </div>
                )
              })}
            </>
          )}
        </div>

        {/* 输入区：收起/展开用 grid 行高过渡；只在过渡窗口内临时 overflow-hidden，
            展开后恢复可见，避免表情/提及面板从输入区上方冒出来时被剪掉。 */}
        {composerTarget && createPortal(
          <div
            data-comment-composer
            aria-hidden={!showComposer ? true : undefined}
            inert={!showComposer ? true : undefined}
            className={cn(
              'grid flex-shrink-0 rounded-[8px]',
              showComposer ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
              composerClipped && 'overflow-hidden',
            )}
          >
            <div className="min-h-0">
              <CommentInput
                newComment={newComment}
                onCommentChange={handleCommentChange}
                onSubmit={handleSubmitWithAuth}
                loading={loading}
                visibility={commentVisibility}
                onVisibilityChange={setCommentVisibility}
                showVisibilitySelector={showVisibilitySelector}
                sendInsideComposer={sendInsideComposer}
                selectedTimestamp={selectedTimestamp}
                selectedVideoFps={selectedVideoFps}
                selectedVideoDurationSeconds={currentVideoDuration}
                selectedTimecodeEnd={selectedTimecodeEnd}
                isSelectingTimecodeEnd={isSelectingTimecodeEnd}
                onSetTimecodeEnd={handleSetTimecodeEnd}
                mentionCandidates={showVisibilitySelector ? mentionCandidates : undefined}
                mentionedUserIds={mentionedUserIds}
                onMentionedUserIdsChange={setMentionedUserIds}
                currentVideoRestricted={currentVideoRestricted}
                restrictionMessage={restrictionMessage}
                commentsDisabled={commentsDisabled}
                allowClientAssetUpload={allowClientAssetUpload}
                maxCommentAttachments={maxCommentAttachments}
                selectedVideoId={selectedVideoId}
                pendingAttachments={pendingAttachments}
                onAttachmentAdded={handleAttachmentAdded}
                onRemoveAttachment={handleRemoveAttachment}
                attachmentError={attachmentError}
                attachmentNotice={attachmentNotice}
                onAttachmentErrorChange={handleAttachmentErrorChange}
                shareToken={shareToken}
                shareSlug={projectSlug}
                pendingAnnotation={pendingAnnotation}
                onStartDrawing={handleStartDrawing}
                showShortcutsButton={showShortcutsButton}
                onShowShortcuts={handleOpenShortcuts}
              />
            </div>
          </div>,
          composerTarget,
        )}
      </CardContent>
    </Card>
  )
}
