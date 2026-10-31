export const ANNOUNCEMENT_TYPES = [
  'MESSAGE',
  'ANNOUNCEMENT',
  'RELEASE',
  'MAINTENANCE',
  'INCIDENT',
  'LEGAL',
  'PROMO',
] as const

export type AnnouncementType = (typeof ANNOUNCEMENT_TYPES)[number]

export const ANNOUNCEMENT_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'ACTIVE',
  'PAUSED',
  'EXPIRED',
  'ARCHIVED',
] as const

export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number]

export const PRIMARY_MODES = ['INBOX', 'BANNER', 'MODAL', 'TOAST'] as const

export type PrimaryMode = (typeof PRIMARY_MODES)[number]

export const AUDIENCE_KINDS = [
  'ALL',
  'TEAM',
  'USER',
  'ROLE',
  'PLAN',
  'FEATURE',
  'LOCALE',
  'ACTIVE_STATUS',
] as const

export type AudienceKind = (typeof AUDIENCE_KINDS)[number]

export const AUDIENCE_RULE_MODES = ['INCLUDE', 'EXCLUDE'] as const

export type AudienceRuleMode = (typeof AUDIENCE_RULE_MODES)[number]

export const ANNOUNCEMENT_EVENT_TYPES = ['IMPRESSION', 'READ', 'ACK', 'CLICK', 'DISMISS'] as const

export type AnnouncementEventType = (typeof ANNOUNCEMENT_EVENT_TYPES)[number]

export const ACTIVE_STATUS_VALUES = [
  'ACTIVE_7D',
  'ACTIVE_30D',
  'INACTIVE_7D',
  'INACTIVE_30D',
  'NEVER_ACTIVE',
] as const

export type ActiveStatusValue = (typeof ACTIVE_STATUS_VALUES)[number]

export const TEAM_ROLE_VALUES = ['OWNER', 'ADMIN', 'MEMBER'] as const
export const ANNOUNCEMENT_LOCALES = ['zh', 'en', 'nl', 'de'] as const

export const ANNOUNCEMENT_TITLE_MAX = 60
export const ANNOUNCEMENT_CONTENT_MAX = 2000
export const ANNOUNCEMENT_CTA_LABEL_MAX = 40
export const ANNOUNCEMENT_URL_MAX = 2000
export const ANNOUNCEMENT_RULES_MAX = 30
export const ANNOUNCEMENT_FEED_LIMIT = 100
export const ANNOUNCEMENT_HISTORY_PAGE_SIZE = 50
export const ANNOUNCEMENT_HISTORY_PAGE_MAX = 100

export const TYPE_LABELS: Record<AnnouncementType, string> = {
  MESSAGE: '个人消息',
  ANNOUNCEMENT: '运营公告',
  RELEASE: '版本说明',
  MAINTENANCE: '维护',
  INCIDENT: '故障',
  LEGAL: '条款/隐私',
  PROMO: '活动',
}

export const STATUS_LABELS: Record<AnnouncementStatus, string> = {
  DRAFT: '草稿',
  SCHEDULED: '定时',
  ACTIVE: '生效中',
  PAUSED: '已暂停',
  EXPIRED: '已过期',
  ARCHIVED: '已归档',
}

export const MODE_LABELS: Record<PrimaryMode, string> = {
  INBOX: '收件箱',
  BANNER: '横幅',
  MODAL: '弹窗',
  TOAST: '轻提示',
}

export const AUDIENCE_KIND_LABELS: Record<AudienceKind, string> = {
  ALL: '全员',
  TEAM: '团队',
  USER: '指定用户',
  ROLE: '团队角色',
  PLAN: '套餐',
  FEATURE: '功能',
  LOCALE: '语言',
  ACTIVE_STATUS: '活跃状态',
}

export const RULE_MODE_LABELS: Record<AudienceRuleMode, string> = {
  INCLUDE: '包含',
  EXCLUDE: '排除',
}

export const EVENT_LABELS: Record<AnnouncementEventType, string> = {
  IMPRESSION: '曝光',
  READ: '已读',
  ACK: '已知晓',
  CLICK: '点击',
  DISMISS: '关闭',
}

export const ACTIVE_STATUS_LABELS: Record<ActiveStatusValue, string> = {
  ACTIVE_7D: '7 天内活跃',
  ACTIVE_30D: '30 天内活跃',
  INACTIVE_7D: '7 天以上不活跃',
  INACTIVE_30D: '30 天以上不活跃',
  NEVER_ACTIVE: '从未活跃',
}

export const TEAM_ROLE_LABELS: Record<string, string> = {
  OWNER: '创建人',
  ADMIN: '管理员',
  MEMBER: '成员',
}

export const LOCALE_LABELS: Record<string, string> = {
  zh: '简体中文',
  en: 'English',
  nl: 'Nederlands',
  de: 'Deutsch',
}

const TYPE_SET = new Set<string>(ANNOUNCEMENT_TYPES)
const STATUS_SET = new Set<string>(ANNOUNCEMENT_STATUSES)
const MODE_SET = new Set<string>(PRIMARY_MODES)
const AUDIENCE_KIND_SET = new Set<string>(AUDIENCE_KINDS)
const RULE_MODE_SET = new Set<string>(AUDIENCE_RULE_MODES)

export function isAnnouncementType(value: unknown): value is AnnouncementType {
  return typeof value === 'string' && TYPE_SET.has(value)
}

export function isAnnouncementStatus(value: unknown): value is AnnouncementStatus {
  return typeof value === 'string' && STATUS_SET.has(value)
}

export function isPrimaryMode(value: unknown): value is PrimaryMode {
  return typeof value === 'string' && MODE_SET.has(value)
}

export function isAudienceKind(value: unknown): value is AudienceKind {
  return typeof value === 'string' && AUDIENCE_KIND_SET.has(value)
}

export function isAudienceRuleMode(value: unknown): value is AudienceRuleMode {
  return typeof value === 'string' && RULE_MODE_SET.has(value)
}

/**
 * Carrier constraints are enforced on the server, not only in the form. A modal
 * is the only blocking surface, so it is reserved for high-priority operational
 * and legal messages; a toast is the only auto-dismissing surface, so it never
 * carries an acknowledgement requirement.
 */
export function modeConstraintError(params: {
  type: AnnouncementType
  primaryMode: PrimaryMode
  priority: number
  ackRequired: boolean
}): string | null {
  const { type, primaryMode, priority, ackRequired } = params

  if (type === 'MESSAGE' && primaryMode !== 'INBOX') {
    return '个人消息只能使用收件箱承载'
  }

  if (primaryMode === 'MODAL') {
    if (!['ANNOUNCEMENT', 'RELEASE', 'MAINTENANCE', 'INCIDENT', 'LEGAL'].includes(type)) {
      return '弹窗只用于运营公告、版本说明、维护、故障或条款/隐私'
    }
    if (priority < 50) return '弹窗公告的优先级必须不低于 50'
  }

  if (primaryMode === 'TOAST') {
    if (!['ANNOUNCEMENT', 'RELEASE', 'PROMO'].includes(type)) {
      return '轻提示只用于运营公告、版本说明或活动'
    }
    if (priority > 30) return '轻提示的优先级不能高于 30'
  }

  if (primaryMode === 'BANNER' && type === 'MESSAGE') {
    return '个人消息不能使用横幅承载'
  }

  if (ackRequired && !['MODAL', 'INBOX'].includes(primaryMode)) {
    return '只有弹窗或收件箱公告可以要求「已知晓」'
  }

  return null
}

export function canEditAnnouncement(status: AnnouncementStatus): boolean {
  return status === 'DRAFT'
}

export function isActiveStatus(status: AnnouncementStatus): boolean {
  return status === 'ACTIVE'
}
