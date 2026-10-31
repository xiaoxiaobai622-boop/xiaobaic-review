'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Eye, Loader2, Plus, Save, Send, Trash2, UploadCloud } from 'lucide-react'
import { appNotice } from '@/components/AppDialogProvider'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { apiFetch, apiPatch, apiPost } from '@/lib/api-client'
import { cn, formatBeijingDateTime } from '@/lib/utils'
import {
  ACTIVE_STATUS_LABELS,
  ACTIVE_STATUS_VALUES,
  ANNOUNCEMENT_CONTENT_MAX,
  ANNOUNCEMENT_LOCALES,
  ANNOUNCEMENT_RULES_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  AUDIENCE_KINDS,
  AUDIENCE_KIND_LABELS,
  LOCALE_LABELS,
  MODE_LABELS,
  PRIMARY_MODES,
  STATUS_LABELS,
  TEAM_ROLE_LABELS,
  TEAM_ROLE_VALUES,
  TYPE_LABELS,
  ANNOUNCEMENT_TYPES,
} from '@/lib/announcements/constants'
import { fromBeijingInputValue, toBeijingInputValue } from '@/lib/announcements/time'
import { validateAnnouncementPayload } from '@/lib/announcements/validation'
import type {
  AdminAnnouncementDetail,
  AudiencePreview,
  AudienceRuleDraft,
  AnnouncementFormValues,
} from '@/lib/announcements/admin-types'

interface TeamOption { id: string; name: string; subscriptionPlan: string }
interface UserOption { id: string; name: string | null; email: string; phone: string | null }
interface FeatureOption { key: string; name: string }

const EMPTY_VALUES: AnnouncementFormValues = {
  title: '',
  content: '',
  locale: 'zh',
  type: 'ANNOUNCEMENT',
  primaryMode: 'INBOX',
  priority: 10,
  startAt: '',
  endAt: '',
  ackRequired: false,
  ctaLabel: '',
  ctaUrl: '',
  imageUrl: '',
  audienceRules: [{ kind: 'ALL', value: '', mode: 'INCLUDE' }],
}

const fieldClass = 'h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring'
const textareaClass = 'w-full resize-y rounded-md border border-border bg-background px-2 py-2 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring'

function initialValuesFromDetail(detail: AdminAnnouncementDetail): AnnouncementFormValues {
  const item = detail.item
  return {
    title: item.title,
    content: item.content,
    locale: item.locale,
    type: item.type,
    primaryMode: item.primaryMode,
    priority: item.priority,
    startAt: toBeijingInputValue(item.startAt),
    endAt: toBeijingInputValue(item.endAt),
    ackRequired: item.ackRequired,
    ctaLabel: item.ctaLabel || '',
    ctaUrl: item.ctaUrl || '',
    imageUrl: item.imageUrl || '',
    audienceRules: item.audienceRules.length > 0
      ? item.audienceRules.map((rule) => ({
          kind: rule.kind,
          value: rule.value || '',
          mode: rule.mode === 'EXCLUDE' ? 'EXCLUDE' : 'INCLUDE',
        }))
      : [{ kind: 'ALL', value: '', mode: 'INCLUDE' }],
  }
}

function payloadFromValues(values: AnnouncementFormValues) {
  const start = values.startAt ? fromBeijingInputValue(values.startAt) : null
  const end = values.endAt ? fromBeijingInputValue(values.endAt) : null
  return {
    title: values.title,
    content: values.content,
    locale: values.locale,
    type: values.type,
    primaryMode: values.primaryMode,
    priority: values.priority,
    startAt: start ? start.toISOString() : (values.startAt ? values.startAt : null),
    endAt: end ? end.toISOString() : (values.endAt ? values.endAt : null),
    ackRequired: values.ackRequired,
    ctaLabel: values.ctaLabel || null,
    ctaUrl: values.ctaUrl || null,
    imageUrl: values.imageUrl || null,
    audienceRules: values.audienceRules.map((rule) => ({
      kind: rule.kind,
      value: rule.kind === 'ALL' ? null : (rule.value || null),
      mode: rule.mode,
    })),
  }
}

function hasAllInclude(rules: AudienceRuleDraft[]): boolean {
  return rules.some((rule) => rule.kind === 'ALL' && rule.mode === 'INCLUDE')
}

function TypePillPreview({ type }: { type: string }) {
  return <span className="rounded bg-primary-visible px-1.5 py-0.5 text-[10px] font-medium text-primary">{TYPE_LABELS[type as keyof typeof TYPE_LABELS] || type}</span>
}

function PreviewBody({ values }: { values: AnnouncementFormValues }) {
  const [mode, setMode] = useState(values.primaryMode)
  useEffect(() => { setMode(values.primaryMode) }, [values.primaryMode])

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="预览承载" className="flex flex-wrap gap-1">
        {PRIMARY_MODES.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            onClick={() => setMode(value)}
            className={cn(
              'rounded px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              mode === value ? 'bg-primary-visible text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {MODE_LABELS[value]}
          </button>
        ))}
      </div>

      {mode === 'BANNER' || mode === 'TOAST' ? (
        <div className="rounded-lg border border-border bg-popover p-3 shadow-elevation-lg">
          <div className="flex items-start gap-2">
            <TypePillPreview type={values.type} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">{values.title || '公告标题'}</p>
              <p className="mt-0.5 line-clamp-3 whitespace-pre-line text-xs text-muted-foreground">{values.content || '公告正文会显示在这里。'}</p>
              {values.ctaLabel ? <span className="mt-2 inline-flex rounded bg-primary px-2 py-1 text-[11px] text-primary-foreground">{values.ctaLabel}</span> : null}
            </div>
          </div>
        </div>
      ) : mode === 'MODAL' ? (
        <div className="mx-auto w-full max-w-md rounded-lg border border-border bg-popover p-4 shadow-elevation-lg">
          <div className="flex items-center gap-2">
            <TypePillPreview type={values.type} />
            <span className="text-[10px] text-muted-foreground">弹窗预览</span>
          </div>
          <p className="mt-2 text-base font-semibold text-foreground">{values.title || '公告标题'}</p>
          <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-line text-sm leading-6 text-foreground">{values.content || '公告正文会显示在这里。'}</p>
          <div className="mt-4 flex justify-end gap-2">
            {values.ctaLabel ? <span className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground">{values.ctaLabel}</span> : null}
            <span className="rounded border border-border px-3 py-1.5 text-xs text-foreground">{values.ackRequired ? '我已知晓' : '关闭'}</span>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-popover p-2">
          <div className="rounded-md px-2 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <p className="min-w-0 truncate text-sm font-medium text-foreground">{values.title || '公告标题'}</p>
              <span className="shrink-0 text-[10px] text-muted-foreground">刚刚</span>
            </div>
            <p className="mt-0.5 line-clamp-3 whitespace-pre-line text-xs text-foreground">{values.content || '公告正文会显示在这里。'}</p>
            <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <TypePillPreview type={values.type} />
              {values.ackRequired ? <span className="rounded bg-destructive-visible px-1 py-px text-destructive">需确认</span> : null}
            </div>
          </div>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">预览只渲染纯文本与安全链接，不执行 HTML。</p>
    </div>
  )
}

function PublishDialog({
  open,
  onOpenChange,
  values,
  audienceCount,
  audienceCurrent,
  onConfirm,
  publishing,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  values: AnnouncementFormValues
  audienceCount: number | null
  audienceCurrent: number | null
  onConfirm: (confirmAllModal: boolean) => void
  publishing: boolean
}) {
  const allModal = values.primaryMode === 'MODAL' && hasAllInclude(values.audienceRules)
  const [confirmed, setConfirmed] = useState(false)
  const [nowMs, setNowMs] = useState(0)
  const start = values.startAt ? fromBeijingInputValue(values.startAt) : null
  const scheduled = Boolean(start && nowMs > 0 && start.getTime() > nowMs)

  useEffect(() => {
    setNowMs(Date.now())
    if (!open) setConfirmed(false)
  }, [open, values.startAt])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>发布确认</DialogTitle>
          <DialogDescription>发布后标题、正文和受众不能再静默修改；需要调整时请复制成新版本。</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <p className="font-medium text-foreground">{values.title}</p>
          <dl className="grid grid-cols-[92px_1fr] gap-x-3 gap-y-1.5 text-xs">
            <dt className="text-muted-foreground">类型</dt><dd>{TYPE_LABELS[values.type as keyof typeof TYPE_LABELS]}</dd>
            <dt className="text-muted-foreground">主承载</dt><dd>{MODE_LABELS[values.primaryMode as keyof typeof MODE_LABELS]}</dd>
            <dt className="text-muted-foreground">优先级</dt><dd>{values.priority}</dd>
            <dt className="text-muted-foreground">受众</dt><dd>{audienceCount === null ? '未知' : `${audienceCount} 人`}{audienceCurrent !== null && audienceCurrent !== audienceCount ? `（发布时快照；当前解析 ${audienceCurrent} 人）` : ''}</dd>
            <dt className="text-muted-foreground">开始</dt><dd>{values.startAt ? formatBeijingDateTime(fromBeijingInputValue(values.startAt) || new Date()) : '立即'}</dd>
            <dt className="text-muted-foreground">结束</dt><dd>{values.endAt ? formatBeijingDateTime(fromBeijingInputValue(values.endAt) || new Date()) : '不设结束'}</dd>
            <dt className="text-muted-foreground">需已知晓</dt><dd>{values.ackRequired ? '是' : '否'}</dd>
          </dl>
          {allModal ? (
            <label className="mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive-visible p-2 text-xs text-destructive">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="mt-0.5"
              />
              我确认向全员发布阻塞式弹窗公告，并已核对受众与时间。
            </label>
          ) : null}
          <p className="text-[11px] text-muted-foreground">这次发布会写入审计；{scheduled ? '到开始时间后自动生效。' : '发布后立即生效。'}</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="h-8 px-3 text-xs">取消</Button>
          <Button
            type="button"
            onClick={() => onConfirm(allModal ? confirmed : true)}
            disabled={publishing || audienceCount === null || audienceCount <= 0 || (allModal && !confirmed)}
            className="h-8 px-3 text-xs"
          >
            {publishing ? '发布中…' : scheduled ? '定时发布' : '立即发布'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function AnnouncementForm({ announcementId }: { announcementId?: string }) {
  const router = useRouter()
  const [values, setValues] = useState<AnnouncementFormValues>(EMPTY_VALUES)
  const [detail, setDetail] = useState<AdminAnnouncementDetail | null>(null)
  const [loading, setLoading] = useState(Boolean(announcementId))
  const [loadError, setLoadError] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(announcementId ?? null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishTargetId, setPublishTargetId] = useState<string | null>(null)
  const [audiencePreview, setAudiencePreview] = useState<AudiencePreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const previewRequest = useRef(0)

  const [teams, setTeams] = useState<TeamOption[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  const [features, setFeatures] = useState<FeatureOption[]>([])
  const [optionsFailed, setOptionsFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const results = await Promise.allSettled([
        apiFetch('/api/platform/teams', { cache: 'no-store' }).then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status)))),
        apiFetch('/api/users', { cache: 'no-store' }).then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status)))),
        apiFetch('/api/platform/features', { cache: 'no-store' }).then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status)))),
      ])
      if (cancelled) return
      const failed = results.some((result) => result.status === 'rejected')
      setOptionsFailed(failed)
      if (results[0].status === 'fulfilled') setTeams(Array.isArray(results[0].value?.teams) ? results[0].value.teams : [])
      if (results[1].status === 'fulfilled') setUsers(Array.isArray(results[1].value?.users) ? results[1].value.users : [])
      if (results[2].status === 'fulfilled') setFeatures(Array.isArray(results[2].value?.features) ? results[2].value.features : [])
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!announcementId) return
    let cancelled = false
    void (async () => {
      try {
        const response = await apiFetch(`/api/platform/announcements/${announcementId}`, { cache: 'no-store' })
        if (!response.ok) throw new Error(String(response.status))
        const data = await response.json() as AdminAnnouncementDetail
        if (cancelled) return
        setDetail(data)
        setValues(initialValuesFromDetail(data))
        setSavedId(data.item.id)
        if (data.item.status !== 'DRAFT') setLoadError('这条公告已发布/已排期，不能直接编辑；请复制成新版本。')
      } catch {
        if (!cancelled) setLoadError('公告读取失败，请返回列表重试。')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [announcementId])

  const setValue = <K extends keyof AnnouncementFormValues>(key: K, value: AnnouncementFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }))
  }

  const rulePayload = useMemo(() => values.audienceRules.map((rule) => ({
    kind: rule.kind,
    value: rule.kind === 'ALL' ? null : (rule.value || null),
    mode: rule.mode,
  })), [values.audienceRules])

  const rulesKey = JSON.stringify(rulePayload)

  useEffect(() => {
    if (values.audienceRules.length === 0) {
      setAudiencePreview(null)
      setPreviewLoading(false)
      setPreviewError('至少需要一条包含规则')
      return
    }
    const request = ++previewRequest.current
    setPreviewLoading(true)
    setPreviewError(null)
    const timer = window.setTimeout(async () => {
      try {
        const response = await apiPost<AudiencePreview>('/api/platform/announcements/audience', { audienceRules: rulePayload, sampleLimit: 6 })
        if (request !== previewRequest.current) return
        setAudiencePreview(response)
      } catch (error) {
        if (request !== previewRequest.current) return
        setAudiencePreview(null)
        setPreviewError(error instanceof Error ? error.message : '受众预览失败')
      } finally {
        if (request === previewRequest.current) setPreviewLoading(false)
      }
    }, 450)
    return () => window.clearTimeout(timer)
  }, [rulePayload, rulesKey, values.audienceRules.length])

  const refreshAudience = async (): Promise<AudiencePreview | null> => {
    try {
      const response = await apiPost<AudiencePreview>('/api/platform/announcements/audience', {
        audienceRules: rulePayload,
        sampleLimit: 6,
      })
      setAudiencePreview(response)
      setPreviewError(null)
      return response
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : '受众预览失败')
      return null
    }
  }

  const validate = useCallback((publishingNow: boolean): boolean => {
    const validated = validateAnnouncementPayload(payloadFromValues(values), { publishing: publishingNow })
    if (validated.ok) {
      setErrors([])
      return true
    }
    setErrors(validated.errors)
    return false
  }, [values])

  const saveDraft = useCallback(async (redirectOnCreate = false): Promise<string | null> => {
    if (!validate(false)) return null
    setSaving(true)
    try {
      const payload = payloadFromValues(values)
      if (savedId) {
        await apiPatch(`/api/platform/announcements/${savedId}`, payload)
        if (redirectOnCreate && !announcementId) router.replace(`/platform/announcements/${savedId}/edit`)
        return savedId
      }
      const response = await apiPost<{ item: { id: string } }>('/api/platform/announcements', payload)
      const id = response.item?.id
      if (!id) throw new Error('保存失败')
      setSavedId(id)
      if (redirectOnCreate) router.replace(`/platform/announcements/${id}/edit`)
      return id
    } catch (error) {
      setErrors([error instanceof Error ? error.message : '保存失败，请稍后重试'])
      return null
    } finally {
      setSaving(false)
    }
  }, [announcementId, router, savedId, validate, values])

  const handleSave = async () => {
    const id = await saveDraft(true)
    if (id && announcementId) appNotice({ tone: 'success', message: '草稿已保存' })
  }

  const handlePreviewPublish = async () => {
    if (!validate(true)) return
    // Always re-resolve right before publishing: a debounced preview from an
    // earlier rule set must not become the confirmed audience count.
    const preview = await refreshAudience()
    if (!preview) return
    const id = await saveDraft(false)
    if (!id) return
    setPublishTargetId(id)
    setPublishOpen(true)
  }

  const confirmPublish = async (confirmAllModal: boolean) => {
    const id = publishTargetId ?? savedId
    if (!id) return
    setPublishing(true)
    try {
      const response = await apiPost<{ ok: boolean; id: string }>(`/api/platform/announcements/${id}/lifecycle`, {
        action: 'publish',
        confirmAllModal,
      })
      setPublishOpen(false)
      router.push(`/platform/announcements/${response.id || id}`)
    } catch (error) {
      appNotice({ tone: 'error', message: error instanceof Error ? error.message : '发布失败，请稍后重试' })
    } finally {
      setPublishing(false)
    }
  }

  const handleTest = async () => {
    const id = await saveDraft(false)
    if (!id) return
    try {
      const response = await apiPost<{ id: string }>(`/api/platform/announcements/${id}/lifecycle`, { action: 'test' })
      appNotice({
        tone: 'success',
        message: `测试公告已发送给你（${response.id}）。到工作台左侧「通知 → 平台」查看；如果主模式是弹窗，会在工作台壳层弹出。`,
      })
    } catch (error) {
      appNotice({ tone: 'error', message: error instanceof Error ? error.message : '测试发送失败，请稍后重试' })
    }
  }

  const updateRule = (index: number, patch: Partial<AudienceRuleDraft>) => {
    setValues((current) => ({
      ...current,
      audienceRules: current.audienceRules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule),
    }))
  }

  const addRule = () => {
    const newRule: AudienceRuleDraft = { kind: 'TEAM', value: '', mode: 'INCLUDE' }
    setValues((current) => ({
      ...current,
      audienceRules: [...current.audienceRules, newRule].slice(0, ANNOUNCEMENT_RULES_MAX),
    }))
  }

  const removeRule = (index: number) => {
    setValues((current) => ({
      ...current,
      audienceRules: current.audienceRules.filter((_, ruleIndex) => ruleIndex !== index),
    }))
  }

  const changeType = (type: string) => {
    setValues((current) => {
      const next = { ...current, type }
      if (type === 'MESSAGE') {
        next.primaryMode = 'INBOX'
        // A direct message must target one user; keeping the default ALL rule
        // would only surface a publish-time error.
        if (next.audienceRules.every((rule) => rule.kind === 'ALL' || rule.mode === 'EXCLUDE')) {
          next.audienceRules = [{ kind: 'USER', value: '', mode: 'INCLUDE' }]
        }
      }
      if (type === 'PROMO' && next.primaryMode === 'MODAL') next.primaryMode = 'BANNER'
      return next
    })
  }

  const changeMode = (mode: string) => {
    setValues((current) => {
      const next = { ...current, primaryMode: mode }
      if (mode === 'MODAL' && next.priority < 50) next.priority = 50
      if (mode === 'TOAST' && next.priority > 30) next.priority = 20
      if (!['INBOX', 'MODAL'].includes(mode)) next.ackRequired = false
      return next
    })
  }

  const planOptions = Array.from(new Set(teams.map((team) => team.subscriptionPlan).filter(Boolean)))

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <div className="h-8 w-52 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded-lg bg-muted/60" />
        <div className="h-48 animate-pulse rounded-lg bg-muted/40" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive-visible p-4 text-sm text-destructive">
        <p>{loadError}</p>
        <div className="mt-3 flex gap-2">
          <Button asChild variant="outline" size="sm" className="h-8 px-3 text-xs">
            <Link href="/platform/announcements">返回列表</Link>
          </Button>
          {detail ? (
            <Button asChild size="sm" className="h-8 px-3 text-xs">
              <Link href={`/platform/announcements/${detail.item.id}`}>查看详情</Link>
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 pb-20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{announcementId ? `编辑公告${detail ? ` · v${detail.item.version}` : ''}` : '新建公告'}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">保存草稿后可测试发送给自己；发布后内容与受众锁定，需要修改请复制新版本。</p>
        </div>
        <span className="rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">{detail ? STATUS_LABELS[detail.item.status as keyof typeof STATUS_LABELS] : '草稿'}</span>
      </div>

      {errors.length > 0 ? (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive-visible px-3 py-2 text-xs text-destructive">
          {errors.map((error) => <p key={error}>{error}</p>)}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-2.5">
            <h2 className="text-sm font-semibold text-foreground">内容</h2>
          </div>
          <div className="flex flex-col gap-3 p-4">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              标题 <span className="ml-auto text-[10px]">{values.title.length}/{ANNOUNCEMENT_TITLE_MAX}</span>
              <input
                value={values.title}
                onChange={(event) => setValue('title', event.target.value)}
                maxLength={ANNOUNCEMENT_TITLE_MAX}
                className={fieldClass}
                placeholder="例如：10 月 31 日晚间维护通知"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              正文（纯文本） <span className="ml-auto text-[10px]">{values.content.length}/{ANNOUNCEMENT_CONTENT_MAX}</span>
              <textarea
                value={values.content}
                onChange={(event) => setValue('content', event.target.value)}
                maxLength={ANNOUNCEMENT_CONTENT_MAX}
                rows={9}
                className={textareaClass}
                placeholder="公告正文…"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                CTA 文案（可选）
                <input value={values.ctaLabel} onChange={(event) => setValue('ctaLabel', event.target.value)} maxLength={40} className={fieldClass} placeholder="查看详情" />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                CTA 链接（http/https 或 /站内路径）
                <input value={values.ctaUrl} onChange={(event) => setValue('ctaUrl', event.target.value)} className={fieldClass} placeholder="/studio/projects 或 https://…" />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              图片 URL（可选，http/https 或 /站内路径）
              <input value={values.imageUrl} onChange={(event) => setValue('imageUrl', event.target.value)} className={fieldClass} placeholder="https://…" />
            </label>
            {values.imageUrl ? (
              <div className="rounded-md border border-border p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={values.imageUrl} alt="公告图片预览" className="max-h-48 rounded object-cover" />
              </div>
            ) : null}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-2.5">
            <h2 className="text-sm font-semibold text-foreground">发布设置</h2>
          </div>
          <div className="flex flex-col gap-3 p-4">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              类型
              <select value={values.type} onChange={(event) => changeType(event.target.value)} className={fieldClass}>
                {ANNOUNCEMENT_TYPES.map((value) => <option key={value} value={value}>{TYPE_LABELS[value]}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              主承载
              <select value={values.primaryMode} onChange={(event) => changeMode(event.target.value)} className={fieldClass}>
                {PRIMARY_MODES.map((value) => <option key={value} value={value}>{MODE_LABELS[value]}</option>)}
              </select>
            </label>
            <p className="text-[10px] text-muted-foreground">弹窗要求优先级 ≥ 50；轻提示 ≤ 30；个人消息只能是收件箱。收件箱始终留档。</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                优先级 0–100
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={values.priority}
                  onChange={(event) => setValue('priority', Number(event.target.value))}
                  className={fieldClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                内容语言
                <select value={values.locale} onChange={(event) => setValue('locale', event.target.value)} className={fieldClass}>
                  {ANNOUNCEMENT_LOCALES.map((value) => <option key={value} value={value}>{LOCALE_LABELS[value]}</option>)}
                </select>
              </label>
            </div>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              开始时间（北京时间，留空立即）
              <input type="datetime-local" value={values.startAt} onChange={(event) => setValue('startAt', event.target.value)} className={fieldClass} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              结束时间（北京时间，留空不设结束）
              <input type="datetime-local" value={values.endAt} onChange={(event) => setValue('endAt', event.target.value)} className={fieldClass} />
            </label>
            <label className={cn('flex items-center gap-2 text-xs', ['INBOX', 'MODAL'].includes(values.primaryMode) ? 'text-foreground' : 'text-muted-foreground opacity-60')}>
              <input
                type="checkbox"
                checked={values.ackRequired}
                disabled={!['INBOX', 'MODAL'].includes(values.primaryMode)}
                onChange={(event) => setValue('ackRequired', event.target.checked)}
              />
              要求用户点「我已知晓」
            </label>
            <p className="text-[10px] text-muted-foreground">全员 + 弹窗发布时会要求再次确认。</p>
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold text-foreground">受众</h2>
          <p className="text-[11px] text-muted-foreground">包含规则之间是 OR；排除规则做减法。受众在服务端解析。</p>
          <Button type="button" variant="outline" size="sm" onClick={addRule} disabled={values.audienceRules.length >= ANNOUNCEMENT_RULES_MAX} className="ml-auto h-7 px-2 text-xs">
            <Plus className="mr-1 h-3 w-3" aria-hidden />
            添加规则
          </Button>
        </div>
        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex flex-col gap-2">
            {values.audienceRules.map((rule, index) => (
              <div key={index} className="grid grid-cols-[76px_120px_minmax(0,1fr)_32px] items-center gap-2">
                <select
                  aria-label={`受众规则 ${index + 1} 包含或排除`}
                  value={rule.mode}
                  onChange={(event) => updateRule(index, { mode: event.target.value as 'INCLUDE' | 'EXCLUDE' })}
                  className={fieldClass}
                >
                  <option value="INCLUDE">包含</option>
                  <option value="EXCLUDE">排除</option>
                </select>
                <select
                  aria-label={`受众规则 ${index + 1} 类型`}
                  value={rule.kind}
                  onChange={(event) => updateRule(index, { kind: event.target.value, value: '' })}
                  className={fieldClass}
                >
                  {AUDIENCE_KINDS.map((kind) => <option key={kind} value={kind}>{AUDIENCE_KIND_LABELS[kind]}</option>)}
                </select>
                {rule.kind === 'ALL' ? (
                  <span className="text-xs text-muted-foreground">所有用户</span>
                ) : rule.kind === 'ROLE' ? (
                  <select aria-label={`受众规则 ${index + 1} 值`} value={rule.value} onChange={(event) => updateRule(index, { value: event.target.value })} className={fieldClass}>
                    <option value="">选择角色…</option>
                    {TEAM_ROLE_VALUES.map((value) => <option key={value} value={value}>{TEAM_ROLE_LABELS[value]}</option>)}
                  </select>
                ) : rule.kind === 'LOCALE' ? (
                  <select aria-label={`受众规则 ${index + 1} 值`} value={rule.value} onChange={(event) => updateRule(index, { value: event.target.value })} className={fieldClass}>
                    <option value="">选择语言…</option>
                    {ANNOUNCEMENT_LOCALES.map((value) => <option key={value} value={value}>{LOCALE_LABELS[value]}</option>)}
                  </select>
                ) : rule.kind === 'ACTIVE_STATUS' ? (
                  <select aria-label={`受众规则 ${index + 1} 值`} value={rule.value} onChange={(event) => updateRule(index, { value: event.target.value })} className={fieldClass}>
                    <option value="">选择活跃状态…</option>
                    {ACTIVE_STATUS_VALUES.map((value) => <option key={value} value={value}>{ACTIVE_STATUS_LABELS[value]}</option>)}
                  </select>
                ) : rule.kind === 'PLAN' ? (
                  planOptions.length > 0 ? (
                    <select aria-label={`受众规则 ${index + 1} 值`} value={rule.value} onChange={(event) => updateRule(index, { value: event.target.value })} className={fieldClass}>
                      <option value="">选择套餐…</option>
                      {planOptions.map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                  ) : (
                    <input value={rule.value} onChange={(event) => updateRule(index, { value: event.target.value })} className={fieldClass} placeholder="套餐 key" />
                  )
                ) : rule.kind === 'FEATURE' ? (
                  features.length > 0 ? (
                    <select aria-label={`受众规则 ${index + 1} 值`} value={rule.value} onChange={(event) => updateRule(index, { value: event.target.value })} className={fieldClass}>
                      <option value="">选择功能…</option>
                      {features.map((feature) => <option key={feature.key} value={feature.key}>{feature.name} ({feature.key})</option>)}
                    </select>
                  ) : (
                    <input value={rule.value} onChange={(event) => updateRule(index, { value: event.target.value })} className={fieldClass} placeholder="功能 key" />
                  )
                ) : rule.kind === 'TEAM' ? (
                  teams.length > 0 ? (
                    <select aria-label={`受众规则 ${index + 1} 值`} value={rule.value} onChange={(event) => updateRule(index, { value: event.target.value })} className={fieldClass}>
                      <option value="">选择团队…</option>
                      {teams.map((team) => <option key={team.id} value={team.id}>{team.name} ({team.id}) · {team.subscriptionPlan}</option>)}
                    </select>
                  ) : (
                    <input value={rule.value} onChange={(event) => updateRule(index, { value: event.target.value })} className={fieldClass} placeholder="团队 ID" />
                  )
                ) : rule.kind === 'USER' ? (
                  users.length > 0 ? (
                    <select aria-label={`受众规则 ${index + 1} 值`} value={rule.value} onChange={(event) => updateRule(index, { value: event.target.value })} className={fieldClass}>
                      <option value="">选择用户…</option>
                      {users.map((user) => <option key={user.id} value={user.id}>{user.name || user.email} · {user.email}</option>)}
                    </select>
                  ) : (
                    <input value={rule.value} onChange={(event) => updateRule(index, { value: event.target.value })} className={fieldClass} placeholder="用户 ID" />
                  )
                ) : (
                  <input value={rule.value} onChange={(event) => updateRule(index, { value: event.target.value })} className={fieldClass} placeholder="值" />
                )}
                <button
                  type="button"
                  onClick={() => removeRule(index)}
                  aria-label={`删除受众规则 ${index + 1}`}
                  className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive-visible hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            ))}
            {values.audienceRules.length === 0 ? <p className="text-xs text-destructive">请至少添加一条包含规则。</p> : null}
            {optionsFailed ? <p className="text-[11px] text-warning-foreground">团队/用户/功能名单未完整加载；可以直接填 ID。</p> : null}
          </div>

          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-foreground">受众预览</p>
              <button type="button" onClick={() => void refreshAudience()} className="text-[11px] text-primary underline-offset-2 hover:underline">重新解析</button>
            </div>
            {previewLoading ? (
              <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" aria-hidden />解析中…</p>
            ) : previewError ? (
              <p className="mt-2 text-xs text-destructive">{previewError}</p>
            ) : audiencePreview ? (
              <>
                <p className={cn('mt-2 text-2xl font-semibold tabular-nums', audiencePreview.audience.count === 0 ? 'text-destructive' : 'text-foreground')}>
                  {audiencePreview.audience.count} <span className="text-xs font-normal text-muted-foreground">人</span>
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">发布时会记录这个数字作为快照。</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {audiencePreview.audience.sample.map((user) => (
                    <span key={user.id} className="rounded bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground" title={user.teamName || undefined}>
                      {user.name}{user.contact ? ` · ${user.contact}` : ''}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">调整规则后会自动解析人数与样本。</p>
            )}
          </div>
        </div>
      </section>

      <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-border bg-popover/95 px-4 py-2.5 backdrop-blur lg:left-56">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setPreviewOpen(true)} className="h-8 px-2.5 text-xs">
            <Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            预览
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void handleTest()} disabled={saving || publishing} className="h-8 px-2.5 text-xs">
            <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            测试发给自己
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void handleSave()} disabled={saving || publishing} className="h-8 px-2.5 text-xs">
            <Save className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {saving ? '保存中…' : '保存草稿'}
          </Button>
          <Button type="button" size="sm" onClick={() => void handlePreviewPublish()} disabled={saving || publishing} className="h-8 px-3 text-xs">
            <UploadCloud className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            发布
          </Button>
        </div>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>预览为收件人</DialogTitle>
            <DialogDescription>这是本地预览，不会发送，也不会写曝光/已读。</DialogDescription>
          </DialogHeader>
          <PreviewBody values={values} />
        </DialogContent>
      </Dialog>

      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        values={values}
        audienceCount={audiencePreview?.audience.count ?? null}
        audienceCurrent={audiencePreview?.audience.count ?? null}
        onConfirm={(confirmAllModal) => void confirmPublish(confirmAllModal)}
        publishing={publishing}
      />
    </div>
  )
}
