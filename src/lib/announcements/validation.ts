import { z } from 'zod'
import {
  ACTIVE_STATUS_VALUES,
  ANNOUNCEMENT_CONTENT_MAX,
  ANNOUNCEMENT_CTA_LABEL_MAX,
  ANNOUNCEMENT_LOCALES,
  ANNOUNCEMENT_RULES_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  ANNOUNCEMENT_TYPES,
  ANNOUNCEMENT_URL_MAX,
  AUDIENCE_KINDS,
  AUDIENCE_RULE_MODES,
  PRIMARY_MODES,
  TEAM_ROLE_VALUES,
  modeConstraintError,
  type ActiveStatusValue,
  type AnnouncementType,
  type AudienceKind,
  type AudienceRuleMode,
  type PrimaryMode,
} from './constants'
import { fromBeijingInputValue, fromIsoOrNull } from './time'
import { isSafeAnnouncementUrl } from './url'

const optionalText = (max: number) => z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.string().trim().max(max).nullable().optional(),
)

const optionalDate = z.preprocess(
  (value) => (value === '' ? null : value),
  z.string().nullable().optional(),
)

const prioritySchema = z.preprocess((value) => {
  if (typeof value === 'string' && value.trim() !== '') return Number(value)
  return value
}, z.number().int().min(0).max(100))

const audienceRuleSchema = z.object({
  kind: z.enum(AUDIENCE_KINDS),
  value: optionalText(200),
  mode: z.enum(AUDIENCE_RULE_MODES).default('INCLUDE'),
})

export const announcementPayloadSchema = z.object({
  title: z.string().trim().min(1, '标题不能为空').max(ANNOUNCEMENT_TITLE_MAX, `标题不能超过 ${ANNOUNCEMENT_TITLE_MAX} 字`),
  content: z.string().trim().min(1, '正文不能为空').max(ANNOUNCEMENT_CONTENT_MAX, `正文不能超过 ${ANNOUNCEMENT_CONTENT_MAX} 字`),
  locale: z.enum(ANNOUNCEMENT_LOCALES).default('zh'),
  type: z.enum(ANNOUNCEMENT_TYPES).default('ANNOUNCEMENT'),
  primaryMode: z.enum(PRIMARY_MODES).default('INBOX'),
  priority: prioritySchema.default(10),
  startAt: optionalDate,
  endAt: optionalDate,
  ackRequired: z.boolean().default(false),
  ctaLabel: optionalText(ANNOUNCEMENT_CTA_LABEL_MAX),
  ctaUrl: optionalText(ANNOUNCEMENT_URL_MAX),
  imageUrl: optionalText(ANNOUNCEMENT_URL_MAX),
  audienceRules: z.array(audienceRuleSchema).max(ANNOUNCEMENT_RULES_MAX, `受众规则不能超过 ${ANNOUNCEMENT_RULES_MAX} 条`).default([]),
})

export interface NormalizedAudienceRule {
  kind: AudienceKind
  value: string | null
  mode: AudienceRuleMode
}

export interface NormalizedAnnouncementPayload {
  title: string
  content: string
  locale: string
  type: AnnouncementType
  primaryMode: PrimaryMode
  priority: number
  startAt: Date | null
  endAt: Date | null
  ackRequired: boolean
  ctaLabel: string | null
  ctaUrl: string | null
  imageUrl: string | null
  audienceRules: NormalizedAudienceRule[]
}

export type ValidationResult =
  | { ok: true; data: NormalizedAnnouncementPayload }
  | { ok: false; errors: string[] }

export type AudienceRulesResult =
  | { ok: true; rules: NormalizedAudienceRule[] }
  | { ok: false; errors: string[] }

function parseDateInput(value: string | null | undefined): Date | null {
  if (!value) return null
  // The API accepts ISO; the admin form's datetime-local values are also accepted
  // so a copy/pasted Beijing wall-clock value cannot silently become UTC+0.
  return fromBeijingInputValue(value) ?? fromIsoOrNull(value)
}

function ruleValueError(kind: AudienceKind, value: string | null, mode: AudienceRuleMode): string | null {
  if (kind === 'ALL') {
    if (mode === 'EXCLUDE') return '不能排除「全员」这条基线，请改为排除具体范围'
    if (value) return '「全员」规则不需要值'
    return null
  }
  if (!value) return `「${kind}」规则缺少值`
  if (kind === 'ROLE' && !TEAM_ROLE_VALUES.includes(value as (typeof TEAM_ROLE_VALUES)[number])) {
    return `未知的团队角色：${value}`
  }
  if (kind === 'LOCALE' && !ANNOUNCEMENT_LOCALES.includes(value as (typeof ANNOUNCEMENT_LOCALES)[number])) {
    return `未知的语言：${value}`
  }
  if (kind === 'ACTIVE_STATUS' && !ACTIVE_STATUS_VALUES.includes(value as ActiveStatusValue)) {
    return `未知的活跃状态：${value}`
  }
  return null
}

const audienceRulesArraySchema = z.array(audienceRuleSchema).max(
  ANNOUNCEMENT_RULES_MAX,
  `受众规则不能超过 ${ANNOUNCEMENT_RULES_MAX} 条`,
)

/** Shared by the audience-preview endpoint so it validates exactly like publish. */
export function validateAudienceRules(input: unknown): AudienceRulesResult {
  const parsed = audienceRulesArraySchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => issue.message) }
  }

  const errors: string[] = []
  const rules: NormalizedAudienceRule[] = []
  const seen = new Set<string>()
  for (const rule of parsed.data) {
    const value = rule.kind === 'ALL' ? null : (rule.value ?? null)
    const ruleError = ruleValueError(rule.kind, value, rule.mode)
    if (ruleError) {
      errors.push(ruleError)
      continue
    }
    const key = `${rule.kind}:${value ?? ''}:${rule.mode}`
    if (seen.has(key)) continue
    seen.add(key)
    rules.push({ kind: rule.kind, value, mode: rule.mode })
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, rules }
}

export function validateAnnouncementPayload(
  input: unknown,
  options: { publishing: boolean },
): ValidationResult {
  const parsed = announcementPayloadSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => issue.message) }
  }

  const payload = parsed.data
  const errors: string[] = []

  const startAt = parseDateInput(payload.startAt)
  const endAt = parseDateInput(payload.endAt)
  if (payload.startAt && !startAt) errors.push('开始时间格式不正确')
  if (payload.endAt && !endAt) errors.push('结束时间格式不正确')
  if (startAt && endAt && endAt.getTime() <= startAt.getTime()) errors.push('结束时间必须晚于开始时间')

  const modeError = modeConstraintError({
    type: payload.type,
    primaryMode: payload.primaryMode,
    priority: payload.priority,
    ackRequired: payload.ackRequired,
  })
  if (modeError) errors.push(modeError)

  const ctaLabel = payload.ctaLabel ?? null
  const ctaUrl = payload.ctaUrl ?? null
  if (Boolean(ctaLabel) !== Boolean(ctaUrl)) errors.push('CTA 文案和链接必须同时填写')
  if (ctaUrl && !isSafeAnnouncementUrl(ctaUrl)) errors.push('CTA 链接只允许 http/https 或站内相对路径')
  const imageUrl = payload.imageUrl ?? null
  if (imageUrl && !isSafeAnnouncementUrl(imageUrl)) errors.push('图片链接只允许 http/https 或站内相对路径')

  const rules: NormalizedAudienceRule[] = []
  const seen = new Set<string>()
  for (const rule of payload.audienceRules) {
    const value = rule.kind === 'ALL' ? null : (rule.value ?? null)
    const ruleError = ruleValueError(rule.kind, value, rule.mode)
    if (ruleError) {
      errors.push(ruleError)
      continue
    }
    const key = `${rule.kind}:${value ?? ''}:${rule.mode}`
    if (seen.has(key)) continue
    seen.add(key)
    rules.push({ kind: rule.kind, value, mode: rule.mode })
  }

  if (options.publishing) {
    const includes = rules.filter((rule) => rule.mode === 'INCLUDE')
    if (includes.length === 0) errors.push('发布前至少要有一条包含规则')
    if (payload.type === 'MESSAGE') {
      if (includes.length !== 1 || includes[0]?.kind !== 'USER') {
        errors.push('个人消息必须定向到单个用户')
      }
      if (rules.some((rule) => rule.mode === 'EXCLUDE')) {
        errors.push('个人消息不支持排除规则')
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    data: {
      title: payload.title,
      content: payload.content,
      locale: payload.locale,
      type: payload.type,
      primaryMode: payload.primaryMode,
      priority: payload.priority,
      startAt,
      endAt,
      ackRequired: payload.ackRequired,
      ctaLabel,
      ctaUrl,
      imageUrl,
      audienceRules: rules,
    },
  }
}
