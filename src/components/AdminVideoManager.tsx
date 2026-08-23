'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { ChevronRight, ChevronUp, Video, Check, CheckCircle2, Loader2, Pencil, Trash2, Upload, GitCompareArrows, MessageSquare, MoreVertical, Play, ExternalLink, Link2, Layers3, FolderInput, Clock3, Share2, ListChecks, CircleOff } from 'lucide-react'
import VideoUpload from './VideoUpload'
import VideoList from './VideoList'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { VideoUploadModal } from './VideoUploadModal'
import { cn, formatFileSize } from '@/lib/utils'
import { useRouter } from 'next/navigation'
import { apiPatch, apiFetch, apiDelete } from '@/lib/api-client'
import { FILE_LIMITS } from '@/lib/file-validation'
import { entryToFiles } from '@/lib/drop-entries'
import { useTranslations } from 'next-intl'
import VideoComparison, { type VideoComparisonComment } from './VideoComparison'
import { copyTextToClipboard } from '@/lib/clipboard'
import { getLatestVideo } from '@/lib/video-comment-counts'
import VideoReviewStatusBadge from './VideoReviewStatusBadge'
import { VideoReviewStatusControl } from './VideoReviewStatusSelect'
import { VIDEO_REVIEW_STATUS_OPTIONS, getEffectiveVideoReviewStatus, type VideoReviewStatus } from '@/lib/video-review-status'

function isVideoFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return FILE_LIMITS.ALLOWED_EXTENSIONS.includes(name.slice(name.lastIndexOf('.')))
}

function formatVideoUploadTime(createdAt?: string): string {
  if (!createdAt) return '--'
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return '--'

  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || ''
  return `${value('year')}-${value('month')}-${value('day')} ${value('hour')}:${value('minute')}`
}

interface AdminVideoManagerProps {
  projectId: string
  videos: any[]
  projectStatus: string
  restrictToLatestVersion?: boolean
  companyName?: string
  onRefresh?: () => void | Promise<void>
  sortMode?: 'status' | 'alphabetical'
  viewMode?: 'list' | 'grid'
  maxRevisions?: number
  enableRevisions?: boolean
  comments?: VideoComparisonComment[]
  shareUrl?: string
  uploadRequestKey?: number
  timestampDisplayMode?: 'TIMECODE' | 'AUTO'
  onShowVideoInfo?: (videoGroup: { name: string; videos: any[] }) => void
  selectionToolbarTargetId?: string
}

interface CollectedUpload {
  id: string
  fileName: string
  fileSize: string
  fileType: string
  uploadedByName: string | null
  uploadedByEmail: string | null
  createdAt: string
}

export default function AdminVideoManager({
  projectId,
  videos,
  projectStatus,
  restrictToLatestVersion: _restrictToLatestVersion = false,
  companyName: _companyName = 'Studio',
  onRefresh,
  sortMode = 'alphabetical',
  viewMode = 'grid',
  comments = [],
  shareUrl = '',
  uploadRequestKey = 0,
  timestampDisplayMode = 'TIMECODE',
  onShowVideoInfo,
  selectionToolbarTargetId,
}: AdminVideoManagerProps) {
  const t = useTranslations('videos')
  const tc = useTranslations('common')
  const router = useRouter()

  // Group videos by name
  const videoGroups = videos.reduce((acc: Record<string, any[]>, video) => {
    const name = video.name
    if (!acc[name]) {
      acc[name] = []
    }
    acc[name].push(video)
    return acc
  }, {})

  // Only allow one video expanded at a time - default collapsed
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false)
  const [droppedFiles, setDroppedFiles] = useState<File[]>([])
  const localVersionInputRef = useRef<HTMLInputElement>(null)
  const [localVersionTargetGroup, setLocalVersionTargetGroup] = useState<string | null>(null)
  const [localVersionFile, setLocalVersionFile] = useState<File | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [copiedReviewGroup, setCopiedReviewGroup] = useState<string | null>(null)
  const dragCounterRef = useRef(0)
  const [editingGroupName, setEditingGroupName] = useState<string | null>(null)
  const [editGroupValue, setEditGroupValue] = useState('')
  const [savingGroupName, setSavingGroupName] = useState<string | null>(null)
  const [deletingGroup, setDeletingGroup] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ name: string; label: string; token: string } | null>(null)
  const [comparisonVideos, setComparisonVideos] = useState<any[] | null>(null)
  const [actionMenuGroup, setActionMenuGroup] = useState<string | null>(null)
  const [versionSourceMenuGroup, setVersionSourceMenuGroup] = useState<string | null>(null)
  const [reviewStatusMenuGroup, setReviewStatusMenuGroup] = useState<string | null>(null)
  const [collectionTargetGroup, setCollectionTargetGroup] = useState<string | null>(null)
  const [collectionUploads, setCollectionUploads] = useState<CollectedUpload[]>([])
  const [collectionLoading, setCollectionLoading] = useState(false)
  const [selectedCollectionUploadId, setSelectedCollectionUploadId] = useState<string | null>(null)
  const [promotingCollectionUploadId, setPromotingCollectionUploadId] = useState<string | null>(null)
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const [sessionId] = useState<string>(() => `admin:${Date.now()}`)
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(() => new Set())
  const [bulkStatusLoading, setBulkStatusLoading] = useState(false)
  const [reviewStatusUpdatingVideoId, setReviewStatusUpdatingVideoId] = useState<string | null>(null)
  const [reviewStatusOverrides, setReviewStatusOverrides] = useState<Record<string, VideoReviewStatus | null>>({})
  const [selectionLinkCopied, setSelectionLinkCopied] = useState(false)
  const [selectionToolbarTarget, setSelectionToolbarTarget] = useState<HTMLElement | null>(null)
  const cardClickTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const videoTokenUrl = useCallback((videoId: string, quality: string) => {
    const params = new URLSearchParams({ videoId, projectId, quality, sessionId })
    return `/api/studio/video-token?${params.toString()}`
  }, [projectId, sessionId])

  useEffect(() => {
    if (uploadRequestKey > 0 && projectStatus !== 'APPROVED') setIsUploadModalOpen(true)
  }, [uploadRequestKey, projectStatus])

  useEffect(() => {
    const currentNames = new Set(videos.map(video => video.name))
    setSelectedGroups(current => new Set([...current].filter(name => currentNames.has(name))))
    setReviewStatusOverrides({})
  }, [videos])

  useEffect(() => () => {
    Object.values(cardClickTimersRef.current).forEach(timer => clearTimeout(timer))
  }, [])

  useEffect(() => {
    setSelectionToolbarTarget(
      selectionToolbarTargetId ? document.getElementById(selectionToolbarTargetId) : null
    )
  }, [selectionToolbarTargetId])

  // Fetch a thumbnail per video group (latest version that has one)
  useEffect(() => {
    let cancelled = false

    const fetchThumbnails = async () => {
      const groups = videos.reduce((acc: Record<string, any[]>, video) => {
        ;(acc[video.name] = acc[video.name] || []).push(video)
        return acc
      }, {})

      const entries = await Promise.all(
        Object.entries(groups).map(async ([name, groupVideos]) => {
          const videoWithThumb = [...(groupVideos as any[])]
            .sort((a, b) => b.version - a.version)
            .find(v => v.thumbnailPath)
          if (!videoWithThumb) return null

          try {
            const res = await apiFetch(
              videoTokenUrl(videoWithThumb.id, 'thumbnail'),
              { cache: 'no-store' }
            )
            if (!res.ok) return null
            const data = await res.json()
            return data.token ? ([name, `/api/content/${data.token}`] as const) : null
          } catch {
            return null
          }
        })
      )

      if (!cancelled) {
        setThumbnails(Object.fromEntries(entries.filter(Boolean) as Array<readonly [string, string]>))
      }
    }

    fetchThumbnails()
    return () => { cancelled = true }
  }, [videos, videoTokenUrl])

  // Handle upload completion from modal - refresh to show processing inline
  const handleUploadComplete = () => {
    onRefresh?.()
  }

  // Preview the latest READY version's transcoded preview (never the original file)
  const handlePreview = async (groupName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const latest = [...videoGroups[groupName]]
      .sort((a, b) => b.version - a.version)
      .find(v => v.status === 'READY')
    if (!latest) return

    try {
      const res = await apiFetch(
        videoTokenUrl(latest.id, '720p'),
        { cache: 'no-store' }
      )
      if (!res.ok) return
      const data = await res.json()
      if (data.token) {
        setPreview({ name: groupName, label: latest.versionLabel || `v${latest.version}`, token: data.token })
      }
    } catch {}
  }

  const handleCompare = async (groupName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const readyVersions = [...videoGroups[groupName]]
      .filter(video => video.status === 'READY')
      .sort((a, b) => a.version - b.version)
    if (readyVersions.length < 2) return

    try {
      const versionsWithStreams = await Promise.all(readyVersions.map(async video => {
        const response = await apiFetch(
          videoTokenUrl(video.id, '720p'),
          { cache: 'no-store' }
        )
        if (!response.ok) throw new Error(t('failedToLoadData'))
        const data = await response.json()
        return { ...video, streamUrl720p: `/api/content/${data.token}` }
      }))
      setComparisonVideos(versionsWithStreams)
    } catch {
      alert(t('failedToLoadData'))
    }
  }

  const handleOpenReview = (groupName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setActionMenuGroup(null)
    setVersionSourceMenuGroup(null)
    setReviewStatusMenuGroup(null)
    const url = `/studio/projects/${projectId}/share?video=${encodeURIComponent(groupName)}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const toggleGroupSelection = (groupName: string) => {
    setSelectedGroups(current => {
      const next = new Set(current)
      if (next.has(groupName)) next.delete(groupName)
      else next.add(groupName)
      return next
    })
  }

  const handleCardClick = (groupName: string, event: React.MouseEvent) => {
    event.stopPropagation()
    if (event.detail !== 1) return

    const existingTimer = cardClickTimersRef.current[groupName]
    if (existingTimer) clearTimeout(existingTimer)
    cardClickTimersRef.current[groupName] = setTimeout(() => {
      toggleGroupSelection(groupName)
      delete cardClickTimersRef.current[groupName]
    }, 220)
  }

  const handleCardDoubleClick = (groupName: string, event: React.MouseEvent) => {
    event.stopPropagation()
    if ((event.target as HTMLElement).closest('button, a, input, textarea, select, [role="menuitem"]')) return
    const existingTimer = cardClickTimersRef.current[groupName]
    if (existingTimer) {
      clearTimeout(existingTimer)
      delete cardClickTimersRef.current[groupName]
    }
    router.push(`/studio/projects/${projectId}/share?video=${encodeURIComponent(groupName)}`)
  }

  const getDisplayVideo = (video: any) => {
    if (!Object.prototype.hasOwnProperty.call(reviewStatusOverrides, video.id)) return video
    const reviewStatus = reviewStatusOverrides[video.id]
    return { ...video, approved: reviewStatus === 'APPROVED', reviewStatus }
  }

  const handleBulkReviewStatus = async (reviewStatus: VideoReviewStatus | null) => {
    if (bulkStatusLoading || selectedGroups.size === 0) return
    const selectedVideos = [...selectedGroups]
      .map(name => getLatestVideo(videoGroups[name] || []))
      .filter((video): video is any => Boolean(video))
      .filter(video => getEffectiveVideoReviewStatus(getDisplayVideo(video)) !== reviewStatus)

    if (selectedVideos.length === 0) return

    setReviewStatusOverrides(current => ({
      ...current,
      ...Object.fromEntries(selectedVideos.map(video => [video.id, reviewStatus])),
    }))
    setBulkStatusLoading(true)

    try {
      for (const video of selectedVideos) {
        const isApproving = reviewStatus === 'APPROVED'
        const response = await apiFetch(
          isApproving
            ? `/api/projects/${projectId}/approve`
            : `/api/projects/${projectId}/review-status`,
          {
            method: isApproving ? 'POST' : 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              selectedVideoId: video.id,
              ...(!isApproving && { reviewStatus }),
            }),
          }
        )

        if (!response.ok) {
          const errorData = await response.json().catch(() => null)
          throw new Error(errorData?.error || t('failedToUpdateReviewStatus'))
        }
      }
      await onRefresh?.()
    } catch (error) {
      await onRefresh?.()
      alert(error instanceof Error ? error.message : t('failedToUpdateReviewStatus'))
    } finally {
      setBulkStatusLoading(false)
    }
  }

  const handleVideoReviewStatus = async (video: any, reviewStatus: VideoReviewStatus | null) => {
    if (
      reviewStatusUpdatingVideoId ||
      getEffectiveVideoReviewStatus(getDisplayVideo(video)) === reviewStatus
    ) return

    setReviewStatusOverrides(current => ({ ...current, [video.id]: reviewStatus }))
    setReviewStatusUpdatingVideoId(video.id)
    setActionMenuGroup(null)
    setReviewStatusMenuGroup(null)
    setVersionSourceMenuGroup(null)

    try {
      const isApproving = reviewStatus === 'APPROVED'
      const response = await apiFetch(
        isApproving
          ? `/api/projects/${projectId}/approve`
          : `/api/projects/${projectId}/review-status`,
        {
          method: isApproving ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            selectedVideoId: video.id,
            ...(!isApproving && { reviewStatus }),
          }),
        }
      )

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error || t('failedToUpdateReviewStatus'))
      }
      await onRefresh?.()
    } catch (error) {
      await onRefresh?.()
      alert(error instanceof Error ? error.message : t('failedToUpdateReviewStatus'))
    } finally {
      setReviewStatusUpdatingVideoId(null)
    }
  }

  const handleShareSelection = async () => {
    if (selectedGroups.size === 0) return
    const baseUrl = shareUrl || `${window.location.origin}/studio/projects/${projectId}/share`
    const selectedNames = [...selectedGroups]
    const targetUrl = selectedNames.length === 1
      ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}video=${encodeURIComponent(selectedNames[0])}`
      : baseUrl
    const copied = await copyTextToClipboard(targetUrl)
    if (!copied) {
      alert(tc('errorTryAgain'))
      return
    }
    setSelectionLinkCopied(true)
    window.setTimeout(() => setSelectionLinkCopied(false), 1600)
  }

  const handleCopyReviewLink = async (groupName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const baseUrl = shareUrl || `${window.location.origin}/studio/projects/${projectId}/share`
    const separator = baseUrl.includes('?') ? '&' : '?'
    const copied = await copyTextToClipboard(`${baseUrl}${separator}video=${encodeURIComponent(groupName)}`)
    if (!copied) {
      alert(tc('errorTryAgain'))
      return
    }
    setCopiedReviewGroup(groupName)
    window.setTimeout(() => {
      setCopiedReviewGroup(null)
      setActionMenuGroup(null)
      setVersionSourceMenuGroup(null)
      setReviewStatusMenuGroup(null)
    }, 1200)
  }

  const openLocalVersionPicker = (groupName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setActionMenuGroup(null)
    setVersionSourceMenuGroup(null)
    setReviewStatusMenuGroup(null)
    setLocalVersionTargetGroup(groupName)
    setLocalVersionFile(null)
    localVersionInputRef.current?.click()
  }

  const handleLocalVersionFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] || null
    event.target.value = ''
    if (!selectedFile) return
    if (!isVideoFile(selectedFile)) {
      alert(t('invalidVideoShort'))
      setLocalVersionTargetGroup(null)
      return
    }
    setLocalVersionFile(selectedFile)
  }

  const clearLocalVersionUpload = () => {
    setLocalVersionTargetGroup(null)
    setLocalVersionFile(null)
  }

  const isCollectedVideo = (upload: CollectedUpload) => {
    const lowerName = upload.fileName.toLowerCase()
    const extension = lowerName.includes('.') ? lowerName.slice(lowerName.lastIndexOf('.')) : ''
    return upload.fileType?.toLowerCase().startsWith('video/') || FILE_LIMITS.ALLOWED_EXTENSIONS.includes(extension)
  }

  const formatCollectedUploadTime = (createdAt: string) => new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(createdAt))

  const openCollectionVersionPicker = async (groupName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setActionMenuGroup(null)
    setVersionSourceMenuGroup(null)
    setReviewStatusMenuGroup(null)
    setCollectionTargetGroup(groupName)
    setCollectionUploads([])
    setSelectedCollectionUploadId(null)
    setCollectionLoading(true)

    try {
      const response = await apiFetch(`/api/projects/${projectId}/project-uploads`, { cache: 'no-store' })
      if (!response.ok) throw new Error(t('collectionLoadFailed'))
      const data = await response.json()
      setCollectionUploads((data.uploads || []).filter(isCollectedVideo))
    } catch (error) {
      alert(error instanceof Error ? error.message : t('collectionLoadFailed'))
      setCollectionTargetGroup(null)
    } finally {
      setCollectionLoading(false)
    }
  }

  const promoteCollectedUpload = async () => {
    if (!collectionTargetGroup || !selectedCollectionUploadId) return
    setPromotingCollectionUploadId(selectedCollectionUploadId)

    try {
      const response = await apiFetch(
        `/api/projects/${projectId}/project-uploads/${selectedCollectionUploadId}/promote`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoName: collectionTargetGroup }),
        }
      )
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || t('collectionReplaceFailed'))
      }

      setCollectionTargetGroup(null)
      setSelectedCollectionUploadId(null)
      onRefresh?.()
      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : t('collectionReplaceFailed'))
    } finally {
      setPromotingCollectionUploadId(null)
    }
  }

  // Delete a video group: removes every version of the video
  const handleDeleteGroup = async (groupName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (deletingGroup) return
    if (!confirm(t('deleteGroupConfirm'))) return

    setDeletingGroup(groupName)
    try {
      for (const video of videoGroups[groupName]) {
        await apiDelete(`/api/videos/${video.id}`)
      }
      router.refresh()
      onRefresh?.()
    } catch {
      alert(t('deleteGroupFailed'))
    } finally {
      setDeletingGroup(null)
    }
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current += 1
    setIsDragOver(true)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current -= 1
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0
      setIsDragOver(false)
    }
  }

  // Drop video files or folders (flattened) onto the section: open the upload modal pre-filled
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current = 0
    setIsDragOver(false)
    if (projectStatus === 'APPROVED') return

    // webkitGetAsEntry must be read synchronously before any await
    const entries = Array.from(e.dataTransfer.items || [])
      .map(item => (item as any).webkitGetAsEntry?.())
      .filter(Boolean)

    const files = entries.length > 0
      ? (await Promise.all(entries.map(entryToFiles))).flat()
      : Array.from(e.dataTransfer.files || [])

    const videoFiles = files.filter(isVideoFile)
    if (videoFiles.length === 0) return

    setDroppedFiles(videoFiles)
    setIsUploadModalOpen(true)
  }

  const handleStartEditGroupName = (oldName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingGroupName(oldName)
    setEditGroupValue(oldName)
  }

  const handleCancelEditGroupName = () => {
    setEditingGroupName(null)
    setEditGroupValue('')
  }

  const handleSaveGroupName = async (oldName: string) => {
    if (!editGroupValue.trim()) {
      alert(t('videoNameEmpty'))
      return
    }

    setSavingGroupName(oldName)

    const videosInGroup = videoGroups[oldName]
    const videoIds = videosInGroup.map(v => v.id)

    // Single batch update for all videos (non-blocking)
    apiPatch('/api/videos/batch', { videoIds, name: editGroupValue.trim() })
      .then(() => {
        setEditingGroupName(null)
        setEditGroupValue('')
        // Refresh in background
        onRefresh?.()
        router.refresh()
      })
      .catch(() => {
        alert(t('failedToUpdateName'))
      })
      .finally(() => {
        setSavingGroupName(null)
      })
  }

  const sortedGroupNames = Object.keys(videoGroups).sort((nameA, nameB) => {
    if (sortMode === 'alphabetical') {
      return nameA.localeCompare(nameB)
    } else {
      // Status sorting
      // Check if ANY version is approved in each group
      const hasApprovedA = videoGroups[nameA].some(v => v.approved)
      const hasApprovedB = videoGroups[nameB].some(v => v.approved)

      // Groups with no approved versions come first, groups with any approved versions come last
      if (hasApprovedA !== hasApprovedB) {
        return hasApprovedA ? 1 : -1
      }
      // If both have same approval status, sort alphabetically
      return nameA.localeCompare(nameB)
    }
  })

  const selectedLatestVideos = [...selectedGroups]
    .map(name => getLatestVideo(videoGroups[name] || []))
    .filter((video): video is any => Boolean(video))
    .map(getDisplayVideo)
  const selectedStatuses = selectedLatestVideos.map(getEffectiveVideoReviewStatus)
  const selectedStatusesAreUniform = selectedStatuses.length > 0 && selectedStatuses.every(status => status === selectedStatuses[0])
  const bulkStatusValue = selectedStatusesAreUniform
    ? selectedStatuses[0]
    : null
  const selectionMode = selectedGroups.size > 0
  const selectionToolbar = selectedGroups.size > 0 ? (
    <div className="flex w-full flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8"
        onClick={() => setSelectedGroups(new Set(sortedGroupNames))}
        disabled={selectedGroups.size === sortedGroupNames.length}
      >
        {tc('selectAll')}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8"
        onClick={() => setSelectedGroups(new Set())}
      >
        {tc('cancel')}
      </Button>
      <span className="text-xs tabular-nums text-muted-foreground">
        {t('selectionCount', { count: selectedGroups.size })}
      </span>
      <div className="min-w-2 flex-1" />
      <VideoReviewStatusControl
        value={bulkStatusValue}
        indeterminate={!selectedStatusesAreUniform}
        loading={bulkStatusLoading}
        onValueChange={handleBulkReviewStatus}
        className="bg-background"
      />
      <Button
        type="button"
        size="sm"
        className="h-8"
        onClick={handleShareSelection}
      >
        {selectionLinkCopied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
        {selectionLinkCopied ? tc('copied') : t('shareSelection')}
      </Button>
    </div>
  ) : null

  return (
    <div
      className={`space-y-4 rounded-lg transition-shadow ${isDragOver ? 'ring-2 ring-primary/60' : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && projectStatus !== 'APPROVED' && (
        <div className="px-3 py-2 rounded-lg border border-dashed border-primary/60 bg-primary/5 text-sm text-primary">
          {t('dropVideosHint')}
        </div>
      )}
      {/* Upload Modal - handles full upload with TUS, processing shows inline after */}
      <VideoUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => { setIsUploadModalOpen(false); setDroppedFiles([]) }}
        projectId={projectId}
        onUploadComplete={handleUploadComplete}
        initialFiles={droppedFiles}
      />
      <input
        ref={localVersionInputRef}
        type="file"
        accept={`video/*,${FILE_LIMITS.ALLOWED_EXTENSIONS.join(',')}`}
        className="hidden"
        onChange={handleLocalVersionFile}
      />
      {localVersionTargetGroup && localVersionFile && (
        <VideoUpload
          key={`${localVersionTargetGroup}:${localVersionFile.name}:${localVersionFile.lastModified}`}
          projectId={projectId}
          videoName={localVersionTargetGroup}
          initialFile={localVersionFile}
          autoStart
          compact
          onCancel={clearLocalVersionUpload}
          onUploadComplete={() => {
            clearLocalVersionUpload()
            handleUploadComplete()
          }}
        />
      )}

      {selectionToolbar && (
        selectionToolbarTargetId
          ? selectionToolbarTarget && createPortal(selectionToolbar, selectionToolbarTarget)
          : <div className="border-y border-border py-2.5">{selectionToolbar}</div>
      )}

      {sortedGroupNames.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <Video className="w-8 h-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t('noVideosYet')}</p>
            {projectStatus !== 'APPROVED' && (
              <Button variant="outline" size="sm" onClick={() => setIsUploadModalOpen(true)}>
                <Upload className="w-3.5 h-3.5 mr-1" />
                {t('uploadFirstVideo')}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <div
        className={viewMode === 'grid' ? 'grid content-start gap-3' : 'space-y-4'}
        style={viewMode === 'grid' ? { gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 280px))' } : undefined}
      >
      {sortedGroupNames.map((groupName) => {
        const groupVideos = videoGroups[groupName]
        const isExpanded = expandedGroup === groupName
        const latestVideo = getLatestVideo(groupVideos)!
        const displayLatestVideo = getDisplayVideo(latestVideo)
        const isSelected = selectedGroups.has(groupName)
        const processingCount = groupVideos.filter(v => v.status === 'PROCESSING').length
        const hasProcessingVideos = processingCount > 0
        const errorCount = groupVideos.filter(v => v.status === 'ERROR').length
        const hasErrorVideos = errorCount > 0
        const feedbackCount = comments.filter(comment => comment.videoId === latestVideo.id).length
        const isGridCard = viewMode === 'grid' && !isExpanded

        return (
          <Card
            key={groupName}
            className={cn(
              'group relative',
              isGridCard && 'h-full',
              viewMode === 'grid' && isExpanded && 'col-span-full',
              isSelected && 'border-primary ring-1 ring-primary shadow-elevation-lg'
            )}
          >
            <CardHeader
              className={cn(
                'relative cursor-pointer hover:bg-accent/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset',
                isGridCard
                  ? 'block space-y-0 p-2.5'
                  : 'flex flex-row items-center justify-between space-y-0 py-3 px-3 sm:px-6'
              )}
              data-selected={isSelected || undefined}
              onClick={(event) => handleCardClick(groupName, event)}
              onDoubleClick={(event) => handleCardDoubleClick(groupName, event)}
            >
              <button
                type="button"
                className={cn(
                  'absolute left-3 top-3 z-20 flex h-6 w-6 items-center justify-center rounded-full border-2 bg-background/90 text-primary shadow-elevation-sm transition-[opacity,background-color,border-color,color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                  isSelected
                    ? 'scale-100 border-primary bg-primary text-primary-foreground opacity-100'
                    : selectionMode
                      ? 'scale-100 border-muted-foreground/55 text-transparent opacity-100'
                      : 'scale-95 border-white/90 text-transparent opacity-0 group-hover:scale-100 group-hover:opacity-100 group-focus-within:opacity-100'
                )}
                onClick={(event) => {
                  event.stopPropagation()
                  toggleGroupSelection(groupName)
                }}
                aria-label={isSelected ? t('deselectVideo') : t('selectVideo')}
                aria-pressed={isSelected}
              >
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
              </button>
              <div className={cn('relative flex gap-3 flex-1 min-w-0', isGridCard ? 'flex-col items-stretch' : 'items-center')}>
                {thumbnails[groupName] ? (
                  <div
                    className={cn('relative flex-shrink-0 cursor-pointer overflow-hidden rounded-md border border-border bg-black', isGridCard && 'w-full aspect-video')}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={thumbnails[groupName]}
                      alt={groupName}
                      loading="lazy"
                      className={cn('object-contain bg-black', isGridCard ? 'h-full w-full' : 'w-20 h-12 rounded-md')}
                    />
                    {isGridCard && (
                      <VideoReviewStatusBadge video={displayLatestVideo} className="absolute right-2 top-2 max-w-[calc(100%-3.5rem)]" />
                    )}
                  </div>
                ) : (
                  <div className={cn('relative rounded-md border border-border bg-black flex items-center justify-center flex-shrink-0', isGridCard ? 'w-full aspect-video' : 'w-20 h-12')}>
                    <Video className="w-5 h-5 text-muted-foreground" />
                    {isGridCard && (
                      <VideoReviewStatusBadge video={displayLatestVideo} className="absolute right-2 top-2 max-w-[calc(100%-3.5rem)]" />
                    )}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {editingGroupName === groupName ? (
                      <CardTitle className={cn('min-w-0', isGridCard ? 'truncate text-sm leading-5' : 'text-lg')}>{groupName}</CardTitle>
                    ) : (
                      <>
                        <CardTitle className={cn('min-w-0', isGridCard ? 'truncate text-sm leading-5' : 'text-lg')}>{groupName}</CardTitle>
                        {!isGridCard && <VideoReviewStatusBadge video={displayLatestVideo} />}
                        {isExpanded && projectStatus !== 'APPROVED' && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground hover:text-primary hover:bg-primary-visible flex-shrink-0"
                              onClick={(e) => handleStartEditGroupName(groupName, e)}
                              title={t('editVideoName')}
                            >
                              <Pencil className="w-3 h-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive-visible flex-shrink-0"
                              onClick={(e) => handleDeleteGroup(groupName, e)}
                              disabled={deletingGroup === groupName}
                              title={t('deleteVideo')}
                            >
                              {deletingGroup === groupName
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <Trash2 className="w-3 h-3" />}
                            </Button>
                          </>
                        )}
                        {isExpanded && groupVideos.filter(v => v.status === 'READY').length > 1 && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={(e) => handleCompare(groupName, e)}
                          >
                            <GitCompareArrows className="mr-1.5 h-3.5 w-3.5" />
                            {t('compareVersions')}
                          </Button>
                        )}
                        {hasProcessingVideos && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-primary-visible text-primary border border-primary-visible flex-shrink-0">
                            <div className="animate-spin rounded-full h-2.5 w-2.5 border-b border-primary"></div>
                            {processingCount} {t('processing')}
                          </span>
                        )}
                        {hasErrorVideos && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-destructive-visible text-destructive border border-destructive-visible flex-shrink-0">
                            {errorCount} {t('error')}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  {editingGroupName !== groupName && (
                    <p className={cn('mt-1 flex w-full max-w-sm items-center gap-4 whitespace-nowrap text-muted-foreground', isGridCard ? '-translate-y-0.5 overflow-hidden pr-8 text-xs' : 'text-sm')}>
                      <span className="tabular-nums">{formatVideoUploadTime(latestVideo.createdAt)}</span>
                      <span className="font-medium">{latestVideo.versionLabel || `v${latestVideo.version}`}</span>
                      <span className="inline-flex items-center gap-1 tabular-nums" title={t('feedbackCount', { count: feedbackCount })}>
                        <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{feedbackCount}</span>
                      </span>
                    </p>
                  )}
                </div>
                {editingGroupName !== groupName && (
                  isExpanded ? (
                    <button
                      type="button"
                      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                      onClick={(event) => {
                        event.stopPropagation()
                        setExpandedGroup(null)
                      }}
                      title={t('collapseVersion')}
                      aria-label={t('collapseVersion')}
                    >
                      <ChevronUp className="h-5 w-5" />
                    </button>
                  ) : (
                    <div
                      className={cn(
                        'relative flex-shrink-0',
                        actionMenuGroup === groupName ? 'z-[70]' : 'z-10',
                        isGridCard && 'absolute bottom-0 right-0'
                      )}
                    >
                      <button
                        type="button"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation()
                          setVersionSourceMenuGroup(null)
                          setReviewStatusMenuGroup(null)
                          setActionMenuGroup(current => current === groupName ? null : groupName)
                        }}
                        aria-label={t('videoActions')}
                        title={t('videoActions')}
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                      {actionMenuGroup === groupName && (
                        <>
                          <button
                            type="button"
                            className="fixed inset-0 z-40 cursor-default"
                            aria-label={tc('close')}
                            onClick={(e) => {
                              e.stopPropagation()
                              setActionMenuGroup(null)
                              setVersionSourceMenuGroup(null)
                              setReviewStatusMenuGroup(null)
                            }}
                          />
                          <div className="absolute right-0 top-8 z-50 w-52 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-xl">
                            <button type="button" onClick={(e) => { setActionMenuGroup(null); setVersionSourceMenuGroup(null); setReviewStatusMenuGroup(null); handlePreview(groupName, e) }} className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent">
                              <Play className="h-4 w-4" />{t('previewVideo')}
                            </button>
                            <button type="button" onClick={(e) => handleOpenReview(groupName, e)} className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent">
                              <ExternalLink className="h-4 w-4" />{t('openReviewPage')}
                            </button>
                            <button type="button" onClick={(e) => handleCopyReviewLink(groupName, e)} className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent">
                              {copiedReviewGroup === groupName ? <Check className="h-4 w-4 text-success" /> : <Link2 className="h-4 w-4" />}
                              {copiedReviewGroup === groupName ? tc('copied') : t('copyReviewLink')}
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setActionMenuGroup(null)
                                setVersionSourceMenuGroup(null)
                                setReviewStatusMenuGroup(null)
                                onShowVideoInfo?.({
                                  name: groupName,
                                  videos: [...groupVideos].sort((a, b) => b.version - a.version),
                                })
                              }}
                              className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
                            >
                              <Layers3 className="h-4 w-4" />{t('versionInfo')}
                            </button>
                            <div
                              className="relative"
                              onMouseEnter={() => {
                                setVersionSourceMenuGroup(null)
                                setReviewStatusMenuGroup(groupName)
                              }}
                              onMouseLeave={() => setReviewStatusMenuGroup(null)}
                            >
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setVersionSourceMenuGroup(null)
                                  setReviewStatusMenuGroup(groupName)
                                }}
                                className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
                                aria-haspopup="menu"
                                aria-expanded={reviewStatusMenuGroup === groupName}
                              >
                                <ListChecks className="h-4 w-4" />
                                <span className="flex-1">{t('setReviewStatus')}</span>
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              </button>
                              {reviewStatusMenuGroup === groupName && (
                                <div className="absolute left-full top-0 z-[60] -ml-px w-44 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-xl" role="menu">
                                  {VIDEO_REVIEW_STATUS_OPTIONS.map(option => {
                                    const isCurrent = getEffectiveVideoReviewStatus(displayLatestVideo) === option.value
                                    return (
                                      <button
                                        key={option.value}
                                        type="button"
                                        role="menuitem"
                                        disabled={reviewStatusUpdatingVideoId === latestVideo.id || isCurrent}
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          void handleVideoReviewStatus(latestVideo, option.value)
                                        }}
                                        className="flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent disabled:cursor-wait disabled:opacity-60"
                                      >
                                        <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: option.dotColor }} />
                                        <span className="flex-1">{t(option.labelKey)}</span>
                                        {isCurrent && <Check className="h-4 w-4 text-primary" aria-hidden="true" />}
                                      </button>
                                    )
                                  })}
                                  <div className="my-1 border-t border-border" />
                                  <button
                                    type="button"
                                    role="menuitem"
                                    disabled={reviewStatusUpdatingVideoId === latestVideo.id || getEffectiveVideoReviewStatus(displayLatestVideo) === null}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      void handleVideoReviewStatus(latestVideo, null)
                                    }}
                                    className="flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    <CircleOff className="h-4 w-4 text-muted-foreground" />
                                    {t('removeReviewStatus')}
                                  </button>
                                </div>
                              )}
                            </div>
                            <div className="my-1 border-t border-border" />
                            {projectStatus !== 'APPROVED' && (
                              <div
                                className="relative"
                                onMouseEnter={() => {
                                  setReviewStatusMenuGroup(null)
                                  setVersionSourceMenuGroup(groupName)
                                }}
                                onMouseLeave={() => setVersionSourceMenuGroup(null)}
                              >
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setReviewStatusMenuGroup(null)
                                    setVersionSourceMenuGroup(groupName)
                                  }}
                                  className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
                                  aria-haspopup="menu"
                                  aria-expanded={versionSourceMenuGroup === groupName}
                                >
                                  <Upload className="h-4 w-4" />
                                  <span className="flex-1">{t('uploadNewVersion')}</span>
                                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                </button>
                                {versionSourceMenuGroup === groupName && (
                                  <div className="absolute left-full top-0 z-[60] -ml-px w-40 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-xl" role="menu">
                                    <button type="button" onClick={(e) => openLocalVersionPicker(groupName, e)} className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent">
                                      <Upload className="h-4 w-4" />{t('localUpload')}
                                    </button>
                                    <button type="button" onClick={(e) => openCollectionVersionPicker(groupName, e)} className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent">
                                      <FolderInput className="h-4 w-4" />{t('collectionReplace')}
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                            <button
                              type="button"
                              disabled={groupVideos.filter(v => v.status === 'READY').length < 2}
                              onClick={(e) => { setActionMenuGroup(null); setVersionSourceMenuGroup(null); setReviewStatusMenuGroup(null); handleCompare(groupName, e) }}
                              className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <GitCompareArrows className="h-4 w-4" />{t('compareVersions')}
                            </button>
                            {projectStatus !== 'APPROVED' && (
                              <>
                                <button type="button" onClick={(e) => { setActionMenuGroup(null); setVersionSourceMenuGroup(null); setReviewStatusMenuGroup(null); handleStartEditGroupName(groupName, e) }} className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent">
                                  <Pencil className="h-4 w-4" />{t('editVideoName')}
                                </button>
                                <div className="my-1 border-t border-border" />
                                <button type="button" onClick={(e) => { setActionMenuGroup(null); setVersionSourceMenuGroup(null); setReviewStatusMenuGroup(null); handleDeleteGroup(groupName, e) }} className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10">
                                  <Trash2 className="h-4 w-4" />{t('deleteVideo')}
                                </button>
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )
                )}
              </div>
            </CardHeader>

            {isExpanded && (
              <CardContent className="border-t border-border pt-0 px-3 sm:px-6 space-y-4">
                {/* Upload new version for this video */}
                {projectStatus !== 'APPROVED' && (
                  <div className="mt-4">
                    <h4 className="text-sm font-medium mb-3">{t('uploadNewVersion')}</h4>
                    <p className="mb-3 text-xs text-muted-foreground">{t('versionUploadDescription')}</p>
                    <VideoUpload
                      projectId={projectId}
                      videoName={groupName}
                      onUploadComplete={handleUploadComplete}
                    />
                  </div>
                )}

                {/* Version list */}
                <div className="mt-5">
                  <h4 className="text-sm font-medium mb-3">{t('allVersions')}</h4>
                  <VideoList
                    videos={groupVideos.sort((a, b) => {
                      if (sortMode === 'alphabetical') {
                        // Alphabetical by version label
                        return a.versionLabel.localeCompare(b.versionLabel)
                      } else {
                        // Status sorting: approved first, then by version descending
                        if (a.approved !== b.approved) {
                          return a.approved ? -1 : 1
                        }
                        return b.version - a.version
                      }
                    })}
                    onRefresh={onRefresh}
                  />
                </div>
              </CardContent>
            )}
          </Card>
        )
      })}
      </div>

      <Dialog
        open={!!editingGroupName}
        onOpenChange={(open) => {
          if (!open && !savingGroupName) handleCancelEditGroupName()
        }}
      >
        <DialogContent
          className="sm:max-w-md"
          onPointerDownOutside={() => {
            if (!savingGroupName) handleCancelEditGroupName()
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('editVideoName')}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (editingGroupName) handleSaveGroupName(editingGroupName)
            }}
          >
            <Input
              value={editGroupValue}
              onChange={(event) => setEditGroupValue(event.target.value)}
              autoFocus
              disabled={!!savingGroupName}
              aria-label={t('videoName')}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleCancelEditGroupName} disabled={!!savingGroupName}>
                {tc('cancel')}
              </Button>
              <Button type="submit" disabled={!!savingGroupName || !editGroupValue.trim()}>
                {savingGroupName ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {tc('save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!collectionTargetGroup}
        onOpenChange={(open) => {
          if (!open && !promotingCollectionUploadId) {
            setCollectionTargetGroup(null)
            setSelectedCollectionUploadId(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('collectionReplaceTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('collectionReplaceDescription', { name: collectionTargetGroup || '' })}
            </p>
            {collectionLoading ? (
              <div className="flex min-h-36 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : collectionUploads.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                {t('noCollectedVideos')}
              </div>
            ) : (
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {collectionUploads.map((upload) => {
                  const selected = selectedCollectionUploadId === upload.id
                  return (
                    <button
                      key={upload.id}
                      type="button"
                      onClick={() => setSelectedCollectionUploadId(upload.id)}
                      className={cn(
                        'flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors',
                        selected ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'border-border hover:bg-accent'
                      )}
                    >
                      <span className={cn('mt-0.5 rounded-md p-2', selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                        <Video className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium" title={upload.fileName}>{upload.fileName}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">{formatFileSize(Number(upload.fileSize))}</span>
                        <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Clock3 className="h-3.5 w-3.5" />{formatCollectedUploadTime(upload.createdAt)}
                        </span>
                      </span>
                      {selected && <CheckCircle2 className="mt-1 h-4 w-4 text-primary" />}
                    </button>
                  )
                })}
              </div>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setCollectionTargetGroup(null)
                  setSelectedCollectionUploadId(null)
                }}
                disabled={!!promotingCollectionUploadId}
              >
                {tc('cancel')}
              </Button>
              <Button type="button" onClick={promoteCollectedUpload} disabled={!selectedCollectionUploadId || !!promotingCollectionUploadId}>
                {promotingCollectionUploadId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FolderInput className="mr-2 h-4 w-4" />}
                {t('confirmCollectionReplace')}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate">{preview?.name} — {preview?.label}</DialogTitle>
          </DialogHeader>
          {preview && (
            <video
              src={`/api/content/${preview.token}`}
              controls
              autoPlay
              className="w-full max-h-[70vh] bg-black rounded-lg"
            />
          )}
        </DialogContent>
      </Dialog>

      {comparisonVideos && (
        <VideoComparison
          videoVersions={comparisonVideos}
          comments={comments}
          defaultQuality="720p"
          timestampDisplayMode={timestampDisplayMode}
          onClose={() => setComparisonVideos(null)}
        />
      )}

    </div>
  )
}
