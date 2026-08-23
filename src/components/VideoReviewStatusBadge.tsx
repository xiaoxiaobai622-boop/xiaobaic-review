'use client'

import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import {
  getEffectiveVideoReviewStatus,
  VIDEO_REVIEW_STATUS_OPTIONS,
  type VideoReviewStatus,
} from '@/lib/video-review-status'

interface VideoReviewStatusBadgeProps {
  video?: {
    approved?: boolean
    reviewStatus?: VideoReviewStatus | null
  } | null
  className?: string
}

export default function VideoReviewStatusBadge({ video, className }: VideoReviewStatusBadgeProps) {
  const t = useTranslations('videos')
  const status = getEffectiveVideoReviewStatus(video)
  const option = VIDEO_REVIEW_STATUS_OPTIONS.find(item => item.value === status)

  if (!option) return null

  return (
    <span
      className={cn(
        'inline-flex h-5 max-w-full items-center gap-1.5 rounded border px-1.5 text-[10px] font-medium leading-none shadow-elevation-sm',
        option.badgeClassName,
        className
      )}
      title={t(option.labelKey)}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: option.dotColor }}
      />
      <span className="truncate">{t(option.labelKey)}</span>
    </span>
  )
}
