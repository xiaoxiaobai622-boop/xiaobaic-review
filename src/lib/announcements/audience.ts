import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getConfiguredLocale } from '@/i18n/locale'
import { maskPhoneDisplay } from '@/lib/phone-display'
import {
  ACTIVE_STATUS_LABELS,
  AUDIENCE_KIND_LABELS,
  LOCALE_LABELS,
  TEAM_ROLE_LABELS,
  type ActiveStatusValue,
  type AudienceKind,
  type AudienceRuleMode,
} from './constants'
import { announcementNow, cutoffForActiveStatus } from './time'

export interface AudienceRuleRecord {
  kind: string
  value: string | null
  mode: string
}

export interface AudienceSource {
  userId: string | null
  rules: AudienceRuleRecord[]
}

export interface AudienceSample {
  id: string
  name: string
  contact: string | null
  teamName: string | null
}

export interface UserAudienceTeam {
  id: string
  role: string
  plan: string
  status: string
  lastActiveAt: Date | null
  featureKeys: Set<string>
}

export interface UserAudienceContext {
  id: string
  locale: string | null
  effectiveLocale: string
  teams: UserAudienceTeam[]
  now: Date
}

function valuesOf(rules: AudienceRuleRecord[], kind: AudienceKind): string[] {
  return rules
    .filter((rule) => rule.kind === kind && rule.value)
    .map((rule) => rule.value as string)
}

function activeTeamMembership(extra: Prisma.TeamMemberWhereInput = {}): Prisma.TeamMemberWhereInput {
  return {
    status: 'ACTIVE',
    team: { status: 'ACTIVE' },
    ...extra,
  }
}

function activeStatusWhere(value: string): Prisma.UserWhereInput | null {
  // NEVER_ACTIVE has no cutoff; handle it before the cutoff guard or it would
  // return null and silently match nobody (and nobody is not "never active").
  if (value === 'NEVER_ACTIVE') {
    return {
      AND: [
        { teamMemberships: { some: activeTeamMembership() } },
        {
          NOT: {
            teamMemberships: {
              some: activeTeamMembership({ lastActiveAt: { not: null } }),
            },
          },
        },
      ],
    }
  }

  const cutoff = cutoffForActiveStatus(value)
  if (!cutoff) return null

  if (value.startsWith('ACTIVE_')) {
    return {
      teamMemberships: {
        some: activeTeamMembership({ lastActiveAt: { gte: cutoff } }),
      },
    }
  }

  if (value.startsWith('INACTIVE_')) {
    return {
      AND: [
        { teamMemberships: { some: activeTeamMembership() } },
        {
          NOT: {
            teamMemberships: {
              some: activeTeamMembership({ lastActiveAt: { gte: cutoff } }),
            },
          },
        },
      ],
    }
  }

  return null
}

function ruleWhere(
  rule: AudienceRuleRecord,
  globalLocale: string,
  featureDefaults: Map<string, boolean>,
): Prisma.UserWhereInput | null {
  const kind = rule.kind as AudienceKind
  const value = rule.value?.trim() || null

  switch (kind) {
    case 'ALL':
      return {}
    case 'USER':
      return value ? { id: value } : { id: { in: [] } }
    case 'TEAM':
      return value
        ? { teamMemberships: { some: activeTeamMembership({ teamId: value }) } }
        : { id: { in: [] } }
    case 'ROLE':
      return value
        ? {
            teamMemberships: {
              some: activeTeamMembership({
                role: { in: [value as 'OWNER' | 'ADMIN' | 'MEMBER'] },
              }),
            },
          }
        : { id: { in: [] } }
    case 'PLAN':
      return value
        ? {
            teamMemberships: {
              some: activeTeamMembership({
                team: { status: 'ACTIVE', subscriptionPlan: value },
              }),
            },
          }
        : { id: { in: [] } }
    case 'FEATURE': {
      if (!value) return { id: { in: [] } }
      // Same entitlement semantics as isTeamFeatureEnabled: an explicit grant
      // wins; otherwise the platform default decides. A disabled grant must not
      // be re-enabled by the default.
      const enabledGrant: Prisma.TeamWhereInput = {
        featureGrants: { some: { featureKey: value, enabled: true } },
      }
      const teamCondition: Prisma.TeamWhereInput = featureDefaults.get(value) === true
        ? {
            OR: [
              enabledGrant,
              { featureGrants: { none: { featureKey: value } } },
            ],
          }
        : enabledGrant
      return {
        teamMemberships: {
          some: activeTeamMembership({
            team: { status: 'ACTIVE', ...teamCondition },
          }),
        },
      }
    }
    case 'LOCALE': {
      if (!value) return { id: { in: [] } }
      return {
        OR: [
          { locale: value },
          ...(value === globalLocale ? [{ locale: null }] : []),
        ],
      }
    }
    case 'ACTIVE_STATUS':
      return value ? activeStatusWhere(value) : { id: { in: [] } }
    default:
      return { id: { in: [] } }
  }
}

/**
 * Resolves audience rules to a User where-clause. Includes are OR, excludes are
 * subtracted. With no new-style rules, legacy column semantics apply: a userId
 * means one recipient, null means everyone.
 */
export function buildAudienceWhere(
  source: AudienceSource,
  globalLocale: string,
  featureDefaults: Map<string, boolean> = new Map(),
): Prisma.UserWhereInput {
  const rules = source.rules ?? []

  if (rules.length === 0) {
    return source.userId ? { id: source.userId } : {}
  }

  const includes = rules.filter((rule) => rule.mode === 'INCLUDE')
  const excludes = rules.filter((rule) => rule.mode === 'EXCLUDE')
  const conditions: Prisma.UserWhereInput[] = []

  const hasAll = includes.some((rule) => rule.kind === 'ALL')
  if (!hasAll && includes.length > 0) {
    const includeWheres = includes
      .map((rule) => ruleWhere(rule, globalLocale, featureDefaults))
      .filter((value): value is Prisma.UserWhereInput => Boolean(value))
    conditions.push(includeWheres.length > 0 ? { OR: includeWheres } : { id: { in: [] } })
  }

  if (excludes.length > 0) {
    const excludeWheres = excludes
      .map((rule) => ruleWhere(rule, globalLocale, featureDefaults))
      .filter((value): value is Prisma.UserWhereInput => Boolean(value))
    if (excludeWheres.length > 0) {
      conditions.push({ NOT: { OR: excludeWheres } })
    }
  }

  return conditions.length > 0 ? { AND: conditions } : {}
}

async function loadFeatureDefaults(featureKeys: string[]): Promise<Map<string, boolean>> {
  if (featureKeys.length === 0) return new Map()
  const rows = await prisma.platformFeature.findMany({
    where: { key: { in: featureKeys } },
    select: { key: true, defaultEnabled: true },
  })
  return new Map(rows.map((row) => [row.key, row.defaultEnabled]))
}

async function audienceWhereFor(source: AudienceSource, globalLocale?: string) {
  const locale = globalLocale ?? await getConfiguredLocale().catch(() => 'zh')
  const featureKeys = (source.rules ?? [])
    .filter((rule) => rule.kind === 'FEATURE' && rule.value)
    .map((rule) => rule.value as string)
  const featureDefaults = await loadFeatureDefaults(Array.from(new Set(featureKeys)))
  return buildAudienceWhere(source, locale, featureDefaults)
}

export async function countAudience(source: AudienceSource, globalLocale?: string): Promise<number> {
  return prisma.user.count({ where: await audienceWhereFor(source, globalLocale) })
}

function maskEmail(email: string | null): string | null {
  if (!email) return null
  const at = email.indexOf('@')
  if (at <= 0) return '***'
  return `${email.slice(0, 1)}***${email.slice(at)}`
}

function maskPhone(phone: string | null): string | null {
  if (!phone) return null
  return maskPhoneDisplay(phone)
}

export async function sampleAudience(
  source: AudienceSource,
  limit = 5,
  globalLocale?: string,
): Promise<AudienceSample[]> {
  const users = await prisma.user.findMany({
    where: await audienceWhereFor(source, globalLocale),
    orderBy: { createdAt: 'asc' },
    take: Math.max(1, Math.min(limit, 20)),
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      teamMemberships: {
        where: { status: 'ACTIVE' },
        take: 1,
        select: { team: { select: { name: true } } },
      },
    },
  })

  return users.map((user) => ({
    id: user.id,
    name: user.name || '未命名用户',
    contact: maskPhone(user.phone) || maskEmail(user.email),
    teamName: user.teamMemberships[0]?.team.name ?? null,
  }))
}

export function isBroadcastAudience(source: AudienceSource): boolean {
  const rules = source.rules ?? []
  if (rules.length === 0) return source.userId === null
  return rules.some((rule) => rule.kind === 'ALL' && rule.mode === 'INCLUDE')
}

export function summarizeAudience(source: AudienceSource): string {
  const rules = source.rules ?? []

  if (rules.length === 0) {
    return source.userId ? '指定用户' : '全员'
  }

  const includes = rules.filter((rule) => rule.mode === 'INCLUDE')
  const excludes = rules.filter((rule) => rule.mode === 'EXCLUDE')
  const includeLabels = summarizeRules(includes)
  const excludeLabels = summarizeRules(excludes)

  if (includeLabels.length === 0) return excludes.length > 0 ? '未设置包含规则' : '未设置受众'
  const base = includeLabels.join(' · ')
  return excludeLabels.length > 0 ? `${base} · 排除 ${excludeLabels.join('、')}` : base
}

function summarizeRules(rules: AudienceRuleRecord[]): string[] {
  const labels: string[] = []
  const byKind = new Map<AudienceKind, string[]>()

  for (const rule of rules) {
    const kind = rule.kind as AudienceKind
    const value = rule.value?.trim() || null
    if (kind === 'ALL') {
      labels.push('全员')
      continue
    }
    if (!value) continue
    const list = byKind.get(kind) ?? []
    list.push(value)
    byKind.set(kind, list)
  }

  for (const [kind, values] of byKind.entries()) {
    if (kind === 'TEAM') {
      labels.push(values.length === 1 ? `团队 ${values[0]}` : `团队 ${values.length} 个`)
    } else if (kind === 'USER') {
      labels.push(values.length === 1 ? '指定用户' : `${values.length} 位用户`)
    } else if (kind === 'ROLE') {
      labels.push(`角色 ${values.map((value) => TEAM_ROLE_LABELS[value] || value).join('/')}`)
    } else if (kind === 'PLAN') {
      labels.push(`套餐 ${values.join('/')}`)
    } else if (kind === 'FEATURE') {
      labels.push(`功能 ${values.join('/')}`)
    } else if (kind === 'LOCALE') {
      labels.push(`语言 ${values.map((value) => LOCALE_LABELS[value] || value).join('/')}`)
    } else if (kind === 'ACTIVE_STATUS') {
      labels.push(values.map((value) => ACTIVE_STATUS_LABELS[value as ActiveStatusValue] || value).join('/'))
    } else {
      labels.push(AUDIENCE_KIND_LABELS[kind] || kind)
    }
  }

  return labels
}

export async function loadUserAudienceContext(userId: string): Promise<UserAudienceContext | null> {
  const now = announcementNow()
  const [globalLocale, platformFeatures, user] = await Promise.all([
    getConfiguredLocale().catch(() => 'zh'),
    prisma.platformFeature.findMany({ select: { key: true, defaultEnabled: true } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        locale: true,
        teamMemberships: {
          where: { status: 'ACTIVE' },
          select: {
            role: true,
            lastActiveAt: true,
            team: {
              select: {
                id: true,
                status: true,
                subscriptionPlan: true,
                featureGrants: {
                  select: { featureKey: true, enabled: true },
                },
              },
            },
          },
        },
      },
    }),
  ])

  if (!user) return null

  const teams: UserAudienceTeam[] = user.teamMemberships
    .filter((membership) => membership.team.status === 'ACTIVE')
    .map((membership) => {
      const explicit = new Map(
        membership.team.featureGrants.map((grant) => [grant.featureKey, grant.enabled]),
      )
      const featureKeys = new Set<string>()
      for (const feature of platformFeatures) {
        const enabled = explicit.has(feature.key)
          ? explicit.get(feature.key) === true
          : feature.defaultEnabled
        if (enabled) featureKeys.add(feature.key)
      }
      // Mirror isTeamFeatureEnabled for a grant whose feature row is absent:
      // the grant itself still decides.
      for (const [key, enabled] of explicit) {
        if (enabled && !platformFeatures.some((feature) => feature.key === key)) featureKeys.add(key)
      }
      return {
        id: membership.team.id,
        role: membership.role,
        plan: membership.team.subscriptionPlan,
        status: membership.team.status,
        lastActiveAt: membership.lastActiveAt,
        featureKeys,
      }
    })

  return {
    id: user.id,
    locale: user.locale,
    effectiveLocale: user.locale || globalLocale || 'zh',
    teams,
    now,
  }
}

function matchesRule(context: UserAudienceContext, rule: AudienceRuleRecord): boolean {
  const kind = rule.kind as AudienceKind
  const value = rule.value?.trim() || null
  const activeTeams = context.teams.filter((team) => team.status === 'ACTIVE')

  switch (kind) {
    case 'ALL':
      return true
    case 'USER':
      return Boolean(value) && context.id === value
    case 'TEAM':
      return Boolean(value) && activeTeams.some((team) => team.id === value)
    case 'ROLE':
      return Boolean(value) && activeTeams.some((team) => team.role === value)
    case 'PLAN':
      return Boolean(value) && activeTeams.some((team) => team.plan === value)
    case 'FEATURE':
      return Boolean(value) && activeTeams.some((team) => team.featureKeys.has(value as string))
    case 'LOCALE':
      return Boolean(value) && context.effectiveLocale === value
    case 'ACTIVE_STATUS': {
      if (!value) return false
      const hasActiveMembership = activeTeams.length > 0
      if (value === 'NEVER_ACTIVE') {
        return hasActiveMembership && activeTeams.every((team) => team.lastActiveAt === null)
      }
      const cutoff = cutoffForActiveStatus(value, context.now)
      if (!cutoff) return false
      const hasRecentActivity = activeTeams.some(
        (team) => team.lastActiveAt && team.lastActiveAt.getTime() >= cutoff.getTime(),
      )
      if (value.startsWith('ACTIVE_')) return hasRecentActivity
      if (value.startsWith('INACTIVE_')) return hasActiveMembership && !hasRecentActivity
      return false
    }
    default:
      return false
  }
}

/**
 * JS-side match used by the feed after one context query. SQL remains the
 * authority for previews/counts; this path only avoids one query per announcement.
 */
export function userMatchesAudience(context: UserAudienceContext, source: AudienceSource): boolean {
  const rules = source.rules ?? []

  if (rules.length === 0) {
    return source.userId ? source.userId === context.id : true
  }

  const includes = rules.filter((rule) => rule.mode === 'INCLUDE')
  const excludes = rules.filter((rule) => rule.mode === 'EXCLUDE')

  const included = includes.length === 0
    ? true
    : includes.some((rule) => matchesRule(context, rule))
  if (!included) return false

  return !excludes.some((rule) => matchesRule(context, rule))
}

export function audienceRuleModeLabel(mode: string): string {
  return mode === 'EXCLUDE' ? '排除' : '包含'
}

export function audienceRuleValueLabel(rule: AudienceRuleRecord): string {
  if (rule.kind === 'ALL') return '全员'
  if (!rule.value) return '未设置'
  if (rule.kind === 'ROLE') return TEAM_ROLE_LABELS[rule.value] || rule.value
  if (rule.kind === 'LOCALE') return LOCALE_LABELS[rule.value] || rule.value
  if (rule.kind === 'ACTIVE_STATUS') return ACTIVE_STATUS_LABELS[rule.value as ActiveStatusValue] || rule.value
  return rule.value
}

export function audienceRuleModeNormalized(mode: string): AudienceRuleMode {
  return mode === 'EXCLUDE' ? 'EXCLUDE' : 'INCLUDE'
}
