'use client'

import { appAlert, appConfirm } from '@/components/AppDialogProvider'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Comment, Video, Prisma } from '@prisma/client'
import { useTranslations } from 'next-intl'
import { apiPost, apiDelete } from '@/lib/api-client'
import { secondsToTimecode, timecodeToSeconds } from '@/lib/timecode'
import { AnnotationData } from '@/types/annotations'
import type { DrawingTool } from '@/types/annotations'

type CommentWithReplies = Comment & {
  replies?: Comment[]
}

interface PendingAttachment {
  assetId: string
  videoId: string
  fileName: string
  fileSize: string
  fileType: string
  category: string
}

interface UseCommentManagementProps {
  projectId: string
  initialComments: CommentWithReplies[]
  videos: Video[]
  adminUser?: any
  restrictToLatestVersion: boolean
  shareToken?: string | null
  useAdminAuth?: boolean
  authenticatedName?: string | null
}

export function useCommentManagement({
  projectId,
  initialComments,
  videos,
  adminUser = null,
  restrictToLatestVersion,
  shareToken = null,
  useAdminAuth = false,
  authenticatedName = null,
}: UseCommentManagementProps) {
  const tComments = useTranslations('comments')

  const [optimisticComments, setOptimisticComments] = useState<CommentWithReplies[]>([])
  const [newComment, setNewComment] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<'PICTURE' | 'AUDIO' | 'SUBTITLE' | 'EDITING' | 'OTHER' | null>(null)
  const [selectedTimestamp, setSelectedTimestamp] = useState<number | null>(null) // Internal: still use seconds for video player integration
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [hasAutoFilledTimestamp, setHasAutoFilledTimestamp] = useState(false)
  const [replyingToCommentId, setReplyingToCommentId] = useState<string | null>(null)
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null)
  const [pendingAnnotation, setPendingAnnotation] = useState<AnnotationData | null>(null)
  const [selectedTimecodeEnd, setSelectedTimecodeEnd] = useState<string | null>(null)
  const [isSelectingTimecodeEnd, setIsSelectingTimecodeEnd] = useState(false)
  const submittingCommentRef = useRef(false)
  const attachmentUploadCountRef = useRef(0)
  const previousVideoIdRef = useRef<string | null>(null)
  const rangeWasAdjustedRef = useRef(false)

  const authorName = adminUser?.name || adminUser?.phone || adminUser?.email || authenticatedName || ''

  // Remove optimistic comments that have been confirmed by the server
  const activeOptimisticComments = optimisticComments.filter(oc => {
    if (oc.id.startsWith('temp-')) {
      const hasRealVersionTopLevel = initialComments.some(rc =>
        rc.content === oc.content &&
        rc.videoId === oc.videoId &&
        Math.abs(new Date(rc.createdAt).getTime() - new Date(oc.createdAt).getTime()) < 10000
      )

      const hasRealVersionInReplies = initialComments.some(rc =>
        rc.replies?.some((reply: any) =>
          reply.content === oc.content &&
          reply.videoId === oc.videoId &&
          Math.abs(new Date(reply.createdAt).getTime() - new Date(oc.createdAt).getTime()) < 10000
        )
      )

      return !hasRealVersionTopLevel && !hasRealVersionInReplies
    }

    // Keep non-temp comments (shouldn't happen, but safe fallback)
    return true
  })

  // Merge optimistic replies under parent comments
  const mergedComments = initialComments.map(comment => {
    const optimisticReplies = activeOptimisticComments.filter(oc => oc.parentId === comment.id)

    if (optimisticReplies.length > 0) {
      return {
        ...comment,
        replies: [...(comment.replies || []), ...optimisticReplies]
      }
    }
    return comment
  })

  const optimisticTopLevel = activeOptimisticComments.filter(oc => !oc.parentId)
  const comments = [...mergedComments, ...optimisticTopLevel]

  const cleanupAttachmentAsset = useCallback(async (attachment: PendingAttachment) => {
    try {
      if (shareToken) {
        await fetch(`/api/videos/${attachment.videoId}/client-assets?assetId=${attachment.assetId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${shareToken}` },
        })
      } else if (useAdminAuth) {
        await apiDelete(`/api/videos/${attachment.videoId}/client-assets?assetId=${attachment.assetId}`)
      } else {
        await fetch(`/api/videos/${attachment.videoId}/client-assets?assetId=${attachment.assetId}`, {
          method: 'DELETE',
        })
      }
    } catch {
      // Best-effort cleanup only. Ignore errors for now.
    }
  }, [shareToken, useAdminAuth])

  // Auto-select first video when videos list changes (admin panel without player)
  useEffect(() => {
    if (videos.length > 0 && !selectedVideoId) {
      setSelectedVideoId(videos[0].id)
    }
  }, [videos, selectedVideoId])

  // Clear pending attachments when user switches to a different video context.
  useEffect(() => {
    const previousVideoId = previousVideoIdRef.current
    if (
      previousVideoId &&
      selectedVideoId &&
      selectedVideoId !== previousVideoId &&
      pendingAttachments.length > 0
    ) {
      const staleAttachments = pendingAttachments.filter(a => a.videoId !== selectedVideoId)
      if (staleAttachments.length > 0) {
        setPendingAttachments(prev => prev.filter(a => a.videoId === selectedVideoId))
        setAttachmentError(null)
        setAttachmentNotice('Attachments were cleared because you switched videos.')
        staleAttachments.forEach((attachment) => {
          void cleanupAttachmentAsset(attachment)
        })
      }
    }
    previousVideoIdRef.current = selectedVideoId
  }, [selectedVideoId, pendingAttachments, cleanupAttachmentAsset])

  // Sync with the video player once per selected-video change. The player
  // emits `videoChanged` for subsequent changes, so a polling timer is not
  // needed while the reviewer is playing or scrubbing.
  useEffect(() => {
    const syncCurrentVideo = () => {
      window.dispatchEvent(
        new CustomEvent('getSelectedVideoId', {
          detail: {
            callback: (videoId: string) => {
              if (videoId && videoId !== selectedVideoId) {
                setSelectedVideoId(videoId)
              }
            },
          },
        })
      )
    }

    syncCurrentVideo()
  }, [selectedVideoId])

  // Listen for immediate video changes from VideoPlayer
  useEffect(() => {
    const handleVideoChange = (e: CustomEvent) => {
      const { videoId } = e.detail
      if (videoId && videoId !== selectedVideoId) {
        setSelectedVideoId(videoId)
      }
    }

    window.addEventListener('videoChanged', handleVideoChange as EventListener)
    return () => {
      window.removeEventListener('videoChanged', handleVideoChange as EventListener)
    }
  }, [selectedVideoId])

  // Listen for video selection from admin page (message icon clicks)
  useEffect(() => {
    const handleSelectVideo = (e: CustomEvent) => {
      const { videoId } = e.detail
      if (videoId) {
        setSelectedVideoId(videoId)
      }
    }

    window.addEventListener('selectVideoForComments', handleSelectVideo as EventListener)
    return () => {
      window.removeEventListener('selectVideoForComments', handleSelectVideo as EventListener)
    }
  }, [])

  // Listen for add comment events from video player
  useEffect(() => {
    const handleAddComment = (e: CustomEvent) => {
      setSelectedVideoId(e.detail.videoId)
      setSelectedTimestamp(e.detail.timestamp)
      setHasAutoFilledTimestamp(true)
    }

    window.addEventListener('addComment', handleAddComment as EventListener)
    return () => {
      window.removeEventListener('addComment', handleAddComment as EventListener)
    }
  }, [])

  // Shared helper: capture a timestamp + video for the comment input
  const captureTimestamp = useCallback((time: number, videoId: string) => {
    setSelectedTimestamp(time)
    setSelectedVideoId(videoId)
    setHasAutoFilledTimestamp(true)
  }, [])

  // Keep the drawing draft attached to the comment as each shape is finished.
  useEffect(() => {
    const handleAnnotationDraftChanged = (e: CustomEvent) => {
      const { annotations, timecodeStart, timecodeEnd, videoId } = e.detail
      setPendingAnnotation(annotations || null)

      if (timecodeEnd && !selectedTimecodeEnd) {
        setSelectedTimecodeEnd(timecodeEnd)
      }
      if (selectedTimestamp === null && timecodeStart && videoId) {
        const video = videos.find(v => v.id === videoId)
        const fps = video?.fps || 24
        captureTimestamp(timecodeToSeconds(timecodeStart, fps), videoId)
      }
    }
    const handleAnnotationCleared = () => setPendingAnnotation(null)

    window.addEventListener('annotationDraftChanged', handleAnnotationDraftChanged as EventListener)
    window.addEventListener('annotationCleared', handleAnnotationCleared)
    return () => {
      window.removeEventListener('annotationDraftChanged', handleAnnotationDraftChanged as EventListener)
      window.removeEventListener('annotationCleared', handleAnnotationCleared)
    }
  }, [videos, captureTimestamp, selectedTimestamp, selectedTimecodeEnd])

  // Expose the pending range to the video timeline while a comment is being
  // drafted. The range is only persisted when the user adjusts a handle.
  useEffect(() => {
    const video = videos.find(v => v.id === selectedVideoId)
    const fps = video?.fps || 24
    const startTime = selectedTimestamp === null ? null : selectedTimestamp
    const endTime = selectedTimecodeEnd
      ? timecodeToSeconds(selectedTimecodeEnd, fps)
      : startTime

    window.dispatchEvent(new CustomEvent('commentRangeStateChanged', {
      detail: {
        active: isSelectingTimecodeEnd && startTime !== null && !!selectedVideoId,
        startTime,
        endTime,
        videoId: selectedVideoId,
      },
    }))
  }, [isSelectingTimecodeEnd, selectedTimecodeEnd, selectedTimestamp, selectedVideoId, videos])

  useEffect(() => {
    const updateRangeStart = (e: CustomEvent) => {
      const time = e.detail?.time
      const videoId = e.detail?.videoId
      if (!isSelectingTimecodeEnd || typeof time !== 'number' || videoId !== selectedVideoId) return
      rangeWasAdjustedRef.current = true
      setSelectedTimestamp(Math.max(0, time))
    }

    const updateRangeEnd = (e: CustomEvent) => {
      const time = e.detail?.time
      const videoId = e.detail?.videoId
      if (!isSelectingTimecodeEnd || typeof time !== 'number' || videoId !== selectedVideoId) return

      const video = videos.find(v => v.id === selectedVideoId)
      const fps = video?.fps || 24
      const start = selectedTimestamp ?? time
      rangeWasAdjustedRef.current = true
      setSelectedTimecodeEnd(secondsToTimecode(Math.max(start, time), fps))
    }

    const cancelRange = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      rangeWasAdjustedRef.current = false
      setSelectedTimestamp(null)
      setHasAutoFilledTimestamp(false)
      setSelectedTimecodeEnd(null)
      setIsSelectingTimecodeEnd(false)
    }

    window.addEventListener('commentRangeStartChanged', updateRangeStart as EventListener)
    window.addEventListener('commentRangeEndChanged', updateRangeEnd as EventListener)
    window.addEventListener('keydown', cancelRange)
    return () => {
      window.removeEventListener('commentRangeStartChanged', updateRangeStart as EventListener)
      window.removeEventListener('commentRangeEndChanged', updateRangeEnd as EventListener)
      window.removeEventListener('keydown', cancelRange)
    }
  }, [isSelectingTimecodeEnd, selectedTimestamp, selectedVideoId, videos])

  // Auto-fill timestamp when user starts typing
  const handleCommentChange = (value: string) => {
    setNewComment(value)
    setAttachmentError(null)

    if (value.length > 0 && !hasAutoFilledTimestamp && selectedTimestamp === null) {
      window.dispatchEvent(new CustomEvent('pauseVideoForComment'))

      window.dispatchEvent(
        new CustomEvent('getCurrentTime', {
          detail: {
            callback: (time: number, videoId: string) => {
              const video = videos.find(v => v.id === videoId)
              const fps = video?.fps || 24
              const duration = typeof video?.duration === 'number' && video.duration > 0
                ? video.duration
                : null
              const handleGap = Math.max(1 / fps, Math.min(1, duration ? duration / 96 : 0.5))
              let start = Math.max(0, time)
              let end = start + handleGap

              // Keep the two handles separated even when typing near the end.
              if (duration) {
                end = Math.min(duration, end)
                if (end <= start) {
                  end = duration
                  start = Math.max(0, duration - handleGap)
                }
              }

              rangeWasAdjustedRef.current = false
              setSelectedTimestamp(start)
              setSelectedVideoId(videoId)
              setHasAutoFilledTimestamp(true)
              setSelectedTimecodeEnd(secondsToTimecode(end, fps))
              setIsSelectingTimecodeEnd(true)
            },
          },
        })
      )
    }
  }

  const handleCategoryChange = (category: 'PICTURE' | 'AUDIO' | 'SUBTITLE' | 'EDITING' | 'OTHER' | null) => {
    setSelectedCategory(category)
  }

  const handleSubmitComment = async () => {
    let annotationForComment = pendingAnnotation
    let annotationVideoId: string | null = null

    // React state may not have committed the final pointer-up yet. Read the
    // canvas synchronously so Send always includes the newest completed shape.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('getAnnotationDraft', {
          detail: {
            callback: (draft: { annotations?: AnnotationData | null; videoId?: string | null } | null) => {
              if (draft?.annotations) annotationForComment = draft.annotations
              if (draft?.videoId) annotationVideoId = draft.videoId
            },
          },
        }),
      )
    }

    const targetVideoId = selectedVideoId || annotationVideoId
    const attachmentsForVideo = pendingAttachments.filter(a => a.videoId === targetVideoId)
    const hasAttachments = attachmentsForVideo.length > 0
    const hasAnnotations = !!annotationForComment

    if (!newComment.trim() && !hasAttachments && !hasAnnotations) return

    // State updates are asynchronous; the ref closes the double-click window
    // before React has committed `loading=true`.
    if (loading || submittingCommentRef.current) return

    if (!targetVideoId) {
      appAlert('Please select a video before commenting.')
      return
    }

    if (useAdminAuth && !adminUser) {
      appAlert('Admin session not loaded yet. Please wait a moment and try again.')
      return
    }

    const validatedVideoId: string = targetVideoId
    setAttachmentError(null)
    setAttachmentNotice(null)

    if (restrictToLatestVersion) {
      const latestVideoVersion = videos.length > 0 ? Math.max(...videos.map(v => v.version)) : null
      const selectedVideo = videos.find(v => v.id === validatedVideoId)
      if (selectedVideo && selectedVideo.version !== latestVideoVersion) {
        appAlert('Comments are only allowed on the latest version of this project.')
        return
      }
    }

    submittingCommentRef.current = true
    setLoading(true)

    let commentContent = newComment
    if (!commentContent.trim() && hasAttachments) {
      attachmentUploadCountRef.current += 1
      commentContent = `Attachments uploaded #${attachmentUploadCountRef.current}`
    } else if (!commentContent.trim() && hasAnnotations) {
      commentContent = tComments('drawingAnnotation')
    }

    // Read the player synchronously at send time. The timestamp captured when
    // typing starts is only used to position the draft handles.
    let playerTime: number | null = null
    let playerVideoId: string | null = null
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('getCurrentTime', {
          detail: {
            callback: (time: number, videoId: string) => {
              if (typeof time === 'number') playerTime = time
              if (videoId) playerVideoId = videoId
            },
          },
        }),
      )
    }

    const commentVideoId = playerVideoId === validatedVideoId ? playerVideoId : validatedVideoId
    const commentTimestamp = !rangeWasAdjustedRef.current && playerTime !== null
      ? playerTime
      : selectedTimestamp
    const commentTimecodeEnd = rangeWasAdjustedRef.current ? selectedTimecodeEnd : null

    // OPTIMISTIC UPDATE
    const isInternalComment = useAdminAuth || !!adminUser
    const selectedVideo = videos.find(v => v.id === commentVideoId)
    const fps = selectedVideo?.fps || 24 // Default to 24fps if not available
    const timecode = commentTimestamp !== null ? secondsToTimecode(commentTimestamp, fps) : '00:00:00:00'

    const optimisticComment: CommentWithReplies = {
      id: `temp-${Date.now()}`,
      projectId,
      videoId: commentVideoId,
      videoVersion: videos.find(v => v.id === commentVideoId)?.version || null,
      timecode,
      timecodeEnd: commentTimecodeEnd || null,
      annotations: (annotationForComment as Prisma.JsonValue) || null,
      content: commentContent,
      authorName: isInternalComment
        ? (adminUser!.name || adminUser!.phone || adminUser!.email)
        : (authenticatedName || authorName),
      authorEmail: isInternalComment ? adminUser?.email || null : null,
      category: selectedCategory,
      isInternal: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      resolved: false,
      parentId: replyingToCommentId,
      userId: null,
      replies: [],
    }

    setOptimisticComments(prev => [...prev, optimisticComment])

    const commentParentId = replyingToCommentId
    setNewComment('')
    setSelectedCategory(null)
    setSelectedTimestamp(null)
    // Keep selectedVideoId so user can post multiple comments
    setHasAutoFilledTimestamp(false)
    setReplyingToCommentId(null)
    setPendingAnnotation(null)
    if (annotationForComment) {
      window.dispatchEvent(new CustomEvent('annotationSubmitted'))
    }
    setSelectedTimecodeEnd(null)
    setIsSelectingTimecodeEnd(false)
    rangeWasAdjustedRef.current = false
    const attachmentsForComment = pendingAttachments.filter(a => a.videoId === validatedVideoId)
    const commentAssetIds = attachmentsForComment.map(a => a.assetId)
    setPendingAttachments(prev => prev.filter(a => !commentAssetIds.includes(a.assetId)))

    try {
      // Convert timestamp to timecode for API
      const commentVideo = videos.find(v => v.id === commentVideoId)
      const fps = commentVideo?.fps || 24
      const commentTimecode = commentTimestamp !== null ? secondsToTimecode(commentTimestamp, fps) : '00:00:00:00'

      const requestBody: any = {
        projectId,
        videoId: commentVideoId,
        timecode: commentTimecode,
        content: commentContent,
        category: selectedCategory,
        isInternal: true,
      }

      if (annotationForComment) {
        requestBody.annotations = annotationForComment
      }
      if (commentTimecodeEnd) {
        requestBody.timecodeEnd = commentTimecodeEnd
      }

      if (isInternalComment) {
        requestBody.authorName = adminUser!.name || adminUser!.phone || adminUser!.email
      } else {
        requestBody.authorName = authenticatedName || authorName
      }

      if (commentParentId) {
        requestBody.parentId = commentParentId
      }

      if (commentAssetIds.length > 0) {
        requestBody.assetIds = commentAssetIds
      }

      const submitPromise = shareToken || useAdminAuth
        ? apiPost('/api/comments', requestBody, shareToken ? {
            headers: { 'X-Share-Token': `Bearer ${shareToken}` },
          } : undefined)
        : Promise.reject(new Error('Authentication required to submit comment'))

      // Keep the submit lifecycle inside this async function. Previously the
      // promise was detached, which cleared `loading` immediately and allowed
      // duplicate POSTs while the first request was still in flight.
      const updatedComments = await submitPromise
      setOptimisticComments(prev => prev.filter(c => c.id !== optimisticComment.id))

      window.dispatchEvent(new CustomEvent('commentPosted', {
        detail: { comments: updatedComments, projectId }
      }))

    } catch (error) {
      setOptimisticComments(prev => prev.filter(c => c.id !== optimisticComment.id))
      setNewComment(commentContent)
      setSelectedTimestamp(commentTimestamp)
      setSelectedVideoId(commentVideoId)
      setPendingAnnotation(annotationForComment)
      setAttachmentError(error instanceof Error ? error.message : 'Failed to submit comment')
      setPendingAttachments(prev => {
        const existingIds = new Set(prev.map(a => a.assetId))
        const toRestore = attachmentsForComment.filter(a => !existingIds.has(a.assetId))
        return toRestore.length > 0 ? [...prev, ...toRestore] : prev
      })
    } finally {
      submittingCommentRef.current = false
      setLoading(false)
    }
  }

  const handleReply = (commentId: string, videoId: string) => {
    setReplyingToCommentId(commentId)
    setSelectedVideoId(videoId)
  }

  const handleCancelReply = () => {
    setReplyingToCommentId(null)
  }

  const handleClearTimestamp = () => {
    rangeWasAdjustedRef.current = false
    setSelectedTimestamp(null)
    setSelectedVideoId(null)
    setHasAutoFilledTimestamp(false)
    setSelectedTimecodeEnd(null)
    setIsSelectingTimecodeEnd(false)
  }

  const handleDeleteComment = async (commentId: string) => {
    if (!await appConfirm('确定要删除这条批注吗？删除后无法恢复。')) {
      return
    }

    try {
      if (shareToken) {
        await apiDelete(`/api/comments/${commentId}`, {
          headers: { 'X-Share-Token': `Bearer ${shareToken}` },
        })
      } else if (useAdminAuth) {
        await apiDelete(`/api/comments/${commentId}`)
      } else {
        throw new Error('删除批注需要先登录')
      }

      window.dispatchEvent(new CustomEvent('commentDeleted', {
        detail: { commentId, projectId },
      }))
    } catch (error) {
      appAlert(`批注删除失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  const handleAttachmentAdded = (attachment: PendingAttachment) => {
    setAttachmentError(null)
    setAttachmentNotice(null)
    setPendingAttachments(prev => [...prev, attachment])
  }

  const handleRemoveAttachment = async (assetId: string) => {
    const attachment = pendingAttachments.find(a => a.assetId === assetId)
    setPendingAttachments(prev => prev.filter(a => a.assetId !== assetId))
    setAttachmentError(null)
    setAttachmentNotice(null)
    if (attachment) {
      await cleanupAttachmentAsset(attachment)
    }
  }

  const handleAttachmentErrorChange = (message: string | null) => {
    setAttachmentError(message)
    if (message) {
      setAttachmentNotice(null)
    }
  }

  const handleStartDrawing = (tool: DrawingTool) => {
    window.dispatchEvent(
      new CustomEvent('enterDrawingMode', {
        detail: { tool, timecodeEnd: selectedTimecodeEnd },
      })
    )
  }

  const handleClearAnnotation = () => {
    setPendingAnnotation(null)
    window.dispatchEvent(new CustomEvent('annotationCleared'))
  }

  // Set end timecode from current video playback position
  const handleSetTimecodeEnd = () => {
    if (isSelectingTimecodeEnd) {
      setIsSelectingTimecodeEnd(false)
      return
    }

    window.dispatchEvent(
      new CustomEvent('getCurrentTime', {
        detail: {
          callback: (time: number, videoId: string) => {
            if (videoId) {
              setSelectedVideoId(videoId)
            }
            const video = videos.find(v => v.id === (videoId || selectedVideoId))
            const fps = video?.fps || 24
            const rangeStart = selectedTimestamp ?? time
            rangeWasAdjustedRef.current = true
            setSelectedTimestamp(rangeStart)
            setHasAutoFilledTimestamp(true)
            const timecode = secondsToTimecode(Math.max(rangeStart, time), fps)
            setSelectedTimecodeEnd(timecode)
            setIsSelectingTimecodeEnd(true)
          },
        },
      })
    )
  }

  const handleClearTimecodeEnd = () => {
    rangeWasAdjustedRef.current = false
    setSelectedTimecodeEnd(null)
    setIsSelectingTimecodeEnd(false)
  }

  // Get FPS of currently selected video
  const selectedVideo = videos.find(v => v.id === selectedVideoId)
  const selectedVideoFps = selectedVideo?.fps || 24

  return {
    comments,
    newComment,
    selectedCategory,
    selectedTimestamp,
    selectedTimecodeEnd,
    isSelectingTimecodeEnd,
    selectedVideoId,
    selectedVideoFps,
    loading,
    replyingToCommentId,
    pendingAttachments,
    attachmentError,
    attachmentNotice,
    pendingAnnotation: !!pendingAnnotation,
    handleCommentChange,
    handleCategoryChange,
    handleSubmitComment,
    handleReply,
    handleCancelReply,
    handleClearTimestamp,
    handleDeleteComment,
    handleAttachmentAdded,
    handleRemoveAttachment,
    handleAttachmentErrorChange,
    handleStartDrawing,
    handleClearAnnotation,
    handleSetTimecodeEnd,
    handleClearTimecodeEnd,
  }
}
