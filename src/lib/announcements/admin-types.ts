export interface EventTotalView {
  events: number
  users: number
}

export interface ListStatsView {
  impressions: EventTotalView
  reads: EventTotalView
  acks: EventTotalView
  clicks: EventTotalView
  dismisses: EventTotalView
  rates: {
    impression: number | null
    read: number | null
    ack: number | null
    click: number | null
    dismiss: number | null
  }
}

export interface AudienceView {
  snapshot: number | null
  current: number | null
  resolvedAt: string | null
  error: string | null
}

export interface AudienceRuleView {
  kind: string
  value: string | null
  mode: string
}

export interface AdminAnnouncementItem {
  id: string
  title: string
  content: string
  type: string
  typeLabel: string
  status: string
  statusLabel: string
  primaryMode: string
  priority: number
  locale: string
  ackRequired: boolean
  ctaLabel: string | null
  ctaUrl: string | null
  imageUrl: string | null
  startAt: string | null
  endAt: string | null
  publishedAt: string | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  isTest: boolean
  version: number
  copiedFromId: string | null
  broadcast: boolean
  targetName: string | null
  readCount: number
  active: boolean
  createdBy: { id: string; name: string | null; email: string } | null
  audienceSummary: string
  audience: AudienceView
  audienceRules: AudienceRuleView[]
  stats: ListStatsView
}

export interface AuditLogView {
  id: string
  announcementId: string | null
  actorUserId: string
  actorLabel: string
  action: string
  detail: unknown
  createdAt: string
}

export interface FullStatsView {
  generatedAt: string
  filters: { mode: string | null; from: string | null; to: string | null }
  audience: AudienceView
  totals: Record<'IMPRESSION' | 'READ' | 'ACK' | 'CLICK' | 'DISMISS', EventTotalView>
  rates: {
    impression: number | null
    read: number | null
    ack: number | null
    click: number | null
    dismiss: number | null
  }
  byMode: Array<{ mode: string; type: string; events: number; users: number }>
  byDay: Array<{ day: string; type: string; events: number; users: number }>
}

export interface AdminAnnouncementDetail {
  item: AdminAnnouncementItem
  stats: FullStatsView
  audit: AuditLogView[]
}

export interface AudiencePreview {
  audience: {
    count: number
    sample: Array<{ id: string; name: string; contact: string | null; teamName: string | null }>
  }
  rules: AudienceRuleView[]
  generatedAt: string
}

export interface AnnouncementControlView {
  bannerModalPaused: boolean
  modalMaxPerDay: number
  modalCooldownMinutes: number
  modalMaxShowsPerUser: number
  toastMaxPriority: number
}

export interface AnnouncementControlResponse {
  control: AnnouncementControlView
  updatedAt: string
  updatedByLabel: string | null
}

export interface AnnouncementListResponse {
  items: AdminAnnouncementItem[]
  total: number
}

export interface AudienceRuleDraft {
  kind: string
  value: string
  mode: 'INCLUDE' | 'EXCLUDE'
}

export interface AnnouncementFormValues {
  title: string
  content: string
  locale: string
  type: string
  primaryMode: string
  priority: number
  startAt: string
  endAt: string
  ackRequired: boolean
  ctaLabel: string
  ctaUrl: string
  imageUrl: string
  audienceRules: AudienceRuleDraft[]
}
