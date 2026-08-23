export type VideoReviewStatus =
  | 'PENDING_REVIEW'
  | 'IN_REVIEW'
  | 'FEEDBACK_COMPLETE'
  | 'APPROVED'

export const VIDEO_REVIEW_STATUS_OPTIONS: Array<{
  value: VideoReviewStatus
  labelKey: 'pendingReview' | 'inReview' | 'feedbackComplete' | 'approve'
  dotColor: string
  badgeClassName: string
}> = [
  {
    value: 'PENDING_REVIEW',
    labelKey: 'pendingReview',
    dotColor: 'hsl(var(--muted-foreground))',
    badgeClassName: 'border-border bg-muted/80 text-foreground',
  },
  {
    value: 'IN_REVIEW',
    labelKey: 'inReview',
    dotColor: 'hsl(var(--warning))',
    badgeClassName: 'border-warning/35 bg-warning-visible text-foreground',
  },
  {
    value: 'FEEDBACK_COMPLETE',
    labelKey: 'feedbackComplete',
    dotColor: 'hsl(var(--info))',
    badgeClassName: 'border-info/30 bg-info-visible text-foreground',
  },
  {
    value: 'APPROVED',
    labelKey: 'approve',
    dotColor: 'hsl(var(--success))',
    badgeClassName: 'border-success/30 bg-success-visible text-foreground',
  },
]

export function getEffectiveVideoReviewStatus(video?: {
  approved?: boolean
  reviewStatus?: VideoReviewStatus | null
} | null): VideoReviewStatus | null {
  if (video?.approved) return 'APPROVED'
  return video?.reviewStatus || null
}
