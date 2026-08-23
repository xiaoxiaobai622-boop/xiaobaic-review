'use client'

import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { apiFetch } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  getEffectiveVideoReviewStatus,
  VIDEO_REVIEW_STATUS_OPTIONS,
  type VideoReviewStatus,
} from '@/lib/video-review-status'

export type { VideoReviewStatus } from '@/lib/video-review-status'

const EMPTY_STATUS = 'NONE'
const MIXED_STATUS = 'MIXED'

interface VideoReviewStatusControlProps {
  value: VideoReviewStatus | null
  loading?: boolean
  disabled?: boolean
  indeterminate?: boolean
  onValueChange: (value: VideoReviewStatus | null) => void
  className?: string
}

export function VideoReviewStatusControl({
  value,
  loading = false,
  disabled = false,
  indeterminate = false,
  onValueChange,
  className,
}: VideoReviewStatusControlProps) {
  const t = useTranslations('videos')
  const currentOption = VIDEO_REVIEW_STATUS_OPTIONS.find(option => option.value === value)

  return (
    <Select
      value={indeterminate ? MIXED_STATUS : value || EMPTY_STATUS}
      onValueChange={nextValue => onValueChange(nextValue === EMPTY_STATUS ? null : nextValue as VideoReviewStatus)}
      disabled={disabled || loading}
    >
      <SelectTrigger
        data-tutorial="approve-btn"
        aria-label={t('setReviewStatus')}
        title={loading ? t('updatingReviewStatus') : t('setReviewStatus')}
        className={cn(
          'h-8 w-auto min-w-[132px] shrink-0 gap-2 border-border/80 bg-card px-2.5 py-0 text-xs font-medium shadow-none hover:bg-accent focus:ring-1 focus:ring-ring focus:ring-offset-1',
          className
        )}
      >
        <SelectValue>
          <span className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className={cn(
                'h-2.5 w-2.5 shrink-0 rounded-full',
                !currentOption && 'border-2 border-muted-foreground/55 bg-transparent'
              )}
              style={currentOption ? { backgroundColor: currentOption.dotColor } : undefined}
            />
            <span className="truncate">
              {currentOption ? t(currentOption.labelKey) : t('setReviewStatus')}
            </span>
            {loading && <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start" className="min-w-[184px]">
        {VIDEO_REVIEW_STATUS_OPTIONS.map(option => (
          <SelectItem key={option.value} value={option.value} className="py-2 pl-11 pr-3">
            <span
              aria-hidden="true"
              className="absolute left-7 h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: option.dotColor }}
            />
            <span>{t(option.labelKey)}</span>
          </SelectItem>
        ))}
        <SelectSeparator />
        <SelectItem value={EMPTY_STATUS} className="py-2 pl-8 pr-3 text-muted-foreground">
          <span className="flex items-center gap-2.5">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full border-2 border-muted-foreground/45" />
            <span>{t('removeReviewStatus')}</span>
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  )
}

interface VideoReviewStatusSelectProps {
  projectId: string
  video: {
    id: string
    approved?: boolean
    reviewStatus?: VideoReviewStatus | null
  } | null
  onUpdated?: () => void | Promise<void>
  className?: string
}

export default function VideoReviewStatusSelect({
  projectId,
  video,
  onUpdated,
  className,
}: VideoReviewStatusSelectProps) {
  const t = useTranslations('videos')
  const [loading, setLoading] = useState(false)

  const currentStatus = getEffectiveVideoReviewStatus(video)
  const [displayStatus, setDisplayStatus] = useState<VideoReviewStatus | null>(currentStatus)

  useEffect(() => {
    setDisplayStatus(currentStatus)
  }, [currentStatus, video?.id])

  const updateStatus = async (nextStatus: VideoReviewStatus | null) => {
    if (!video || loading) return
    if (nextStatus === displayStatus) return

    const previousStatus = displayStatus
    setDisplayStatus(nextStatus)
    setLoading(true)
    try {
      const isApproving = nextStatus === 'APPROVED'
      const response = await apiFetch(
        isApproving
          ? `/api/projects/${projectId}/approve`
          : `/api/projects/${projectId}/review-status`,
        {
          method: isApproving ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            selectedVideoId: video.id,
            ...(!isApproving && { reviewStatus: nextStatus }),
          }),
        }
      )

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error || t('failedToUpdateReviewStatus'))
      }

      await onUpdated?.()
    } catch (error) {
      setDisplayStatus(previousStatus)
      alert(error instanceof Error ? error.message : t('failedToUpdateReviewStatus'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <VideoReviewStatusControl
      value={displayStatus}
      loading={loading}
      disabled={!video}
      onValueChange={updateStatus}
      className={className}
    />
  )
}
