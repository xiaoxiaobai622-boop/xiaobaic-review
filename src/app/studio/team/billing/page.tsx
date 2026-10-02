'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CheckCircle2, Copy, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { apiFetch, apiPost } from '@/lib/api-client'
import { isUnlimitedQuota, nextExpiryMs } from '@/lib/billing-pricing'
import type { OrderDto, PlanCard } from '@/lib/billing-dto'
import type { PaymentIntent } from '@/lib/payment-provider'

type BillingQuota = { source: string | null; reference: string | null }
type BillingTeam = { plan: string | null; expiresAt: string | null; quota: BillingQuota }
type BillingData = { orders: OrderDto[]; plan: PlanCard[]; team: BillingTeam }
/** `PaymentIntent` 的另一支（`kind: 'native'`，二期微信）在一期永远不会出现，界面只认转账说明那一支。 */
type TransferIntent = Extract<PaymentIntent, { kind: 'instructions' }>

/** 每张卡片的草稿：周期 + 开票需求。一期没有支付通道，这些值只活在下单那一次请求里。 */
type Draft = { periods: number | null; invoice: boolean; title: string; taxNo: string }
const EMPTY_DRAFT: Draft = { periods: null, invoice: false, title: '', taxNo: '' }
const PERIODS = [1, 3, 6, 12] as const
const RENEWAL_ALERT_DAYS = 14

const pad = (value: number) => String(value).padStart(2, '0')
function formatDay(value: string | number | Date): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
function formatMoment(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${formatDay(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
/** 卡面价格的字面口径（brief Step 2）：`¥{(priceCents/100).toLocaleString('zh-CN')}`。 */
function formatCents(cents: number): string {
  return `¥${(cents / 100).toLocaleString('zh-CN')}`
}

export default function TeamBillingPage() {
  const t = useTranslations('billing')
  // 收款码读取失败的文案沿用平台设置里那一份（`settings.transfer.qrLoadFailed`）：
  // 那是同一个故障的同一句话，不新开一枚 billing 键就是为了不在两处写两种说法。
  const ts = useTranslations('settings')

  const [data, setData] = useState<BillingData | null>(null)
  // 「还剩几天」和「到期日将变为」都要一个当下时刻，但这个时刻**不能在 render 里取**
  // （`react-hooks/purity` 直接报错，而且 render 之间漂移会让预览忽左忽右）。
  // 它跟着每次 `load()` 一起更新：读面刷新 = 重算基准点，同一批 setState 里落地，不会有一帧错位。
  const [nowMs, setNowMs] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [orderingPlan, setOrderingPlan] = useState<string | null>(null)
  const [orderError, setOrderError] = useState<string | null>(null)
  const [reused, setReused] = useState(false)
  const [intent, setIntent] = useState<TransferIntent | null>(null)
  // `null` = 没有出错；`''` = 出错了但服务端没给可读文案（或回来的不是 instructions 分支），
  // 渲染时回落到 `t('loadFailed')`。effect 里不放 `t`，免得把取数挂在翻译函数的身份上。
  const [intentError, setIntentError] = useState<string | null>(null)
  const [reportNote, setReportNote] = useState('')
  const [reporting, setReporting] = useState(false)
  const [reportError, setReportError] = useState<string | null>(null)
  const [copiedReference, setCopiedReference] = useState(false)
  const [qrSrc, setQrSrc] = useState<string | null>(null)
  const [qrFailed, setQrFailed] = useState(false)

  const orders = data?.orders ?? []
  // 一张团队同时只可能有一张活单（`createOrder` 的幂等分支保证），所以这里各取第一枚就够。
  const { openOrder, reportedOrder } = useMemo(() => {
    const list = data?.orders ?? []
    return {
      openOrder: list.find((order) => order.status === 'OPEN') ?? null,
      reportedOrder: list.find((order) => order.status === 'REPORTED') ?? null,
    }
  }, [data])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const response = await apiFetch('/api/billing/orders', { cache: 'no-store' })
      const payload = (await response.json().catch(() => null)) as BillingData | { error?: string } | null
      if (!response.ok) throw new Error((payload as { error?: string } | null)?.error ?? `HTTP ${response.status}`)
      setData(payload as BillingData)
      // 基准点与列表同一批 state 落地（`Date.now()` 不在 render 里调用，见 `nowMs` 的注释）。
      setNowMs(Date.now())
    } catch (reason) {
      // 请求失败必须看得见：这里不返回空列表，也不把 data 留着当「已经没有订单」用。
      setData(null)
      setLoadError(reason instanceof Error ? reason.message : '')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const currentExpiry = data?.team?.expiresAt ? new Date(data.team.expiresAt) : null
  const remainingDays = nowMs > 0 && currentExpiry && currentExpiry.getTime() > nowMs
    ? Math.ceil((currentExpiry.getTime() - nowMs) / 86_400_000)
    : null

  // 转账说明只对还欠着钱的那张单存在（REPORTED / PAID 之后再发一次账号就是等人二次打款）。
  const openOrderId = openOrder?.id ?? null
  useEffect(() => {
    if (!openOrderId) {
      setIntent(null)
      setIntentError(null)
      return
    }
    let alive = true
    setIntent(null)
    setIntentError(null)
    setReportError(null)
    apiFetch(`/api/billing/orders/${openOrderId}/intent`, { cache: 'no-store' })
      .then(async (response) => ({ response, payload: await response.json().catch(() => null) }))
      .then(({ response, payload }) => {
        if (!alive) return
        if (!response.ok) {
          setIntentError(String((payload as { error?: string } | null)?.error ?? ''))
          return
        }
        const next = payload as PaymentIntent | null
        if (!next || next.kind !== 'instructions') {
          // 一期没有别的通道；真收到 native 分支也不能把 codeUrl 当账号画出来，给一句读不到的话。
          setIntentError('')
          return
        }
        setIntent(next)
      })
      .catch(() => { if (alive) setIntentError('') })
    return () => { alive = false }
  }, [openOrderId])

  const hasQr = Boolean(intent?.qrPath)
  // 与 `TransferSettingsSection.tsx:49-78` 同一套写法（照抄，不重写）：先看要不要取字节，
  // 再取字节 → createObjectURL，cleanup 里 alive=false + 一定 revokeObjectURL。
  // `<img src="/api/billing/transfer/qr">` 一定坏：那条路由要 Authorization 头，图片请求带不上。
  useEffect(() => {
    if (!openOrderId || !hasQr) {
      setQrSrc(null)
      setQrFailed(false)
      return
    }
    let url: string | null = null
    let alive = true
    setQrFailed(false)
    apiFetch('/api/billing/transfer/qr')
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.blob()
      })
      .then((blob) => {
        if (!alive) return
        url = URL.createObjectURL(blob)
        setQrSrc(url)
      })
      .catch(() => {
        // 图读不出来不打断下单流程：不渲染图片块，只留一句失败说明。
        if (alive) setQrFailed(true)
      })
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [openOrderId, hasQr])

  const patchDraft = (planKey: string, patch: Partial<Draft>) => {
    setDrafts((prev) => ({ ...prev, [planKey]: { ...EMPTY_DRAFT, ...prev[planKey], ...patch } }))
  }

  const placeOrder = async (plan: PlanCard, draft: Draft) => {
    if (!draft.periods || orderingPlan) return
    setOrderingPlan(plan.key)
    setOrderError(null)
    try {
      const body: { planKey: string; periods: number; invoice?: { requested: boolean; title: string; taxNo: string } } = {
        planKey: plan.key,
        periods: draft.periods,
      }
      // 没勾选就**一个 invoice 键都不发**：`createOrder` 的复用分支靠 `input.invoice` 在不在
      // 决定要不要动那三列，发 `{ requested: false }` 会把运营已经记下的抬头清空。
      if (draft.invoice) body.invoice = { requested: true, title: draft.title.trim(), taxNo: draft.taxNo.trim() }
      const result = await apiPost<{ order: OrderDto; reused: boolean }>('/api/billing/orders', body)
      setReused(result.reused === true)
      await load()
    } catch (reason) {
      // 这一支**不判**`ApiError.code`：`POST /api/billing/orders` 故意不调 `requireTeamWritable`
      // （过期团队正是来这里下单续费的，拦它就是关掉本门），那道 403 只有「不是 OWNER」一种，
      // 响应体里没有任何 `code` 字段 ⇒ 判 `TEAM_EXPIRED`/`TEAM_DISABLED` 是永远命不中的死码。
      // 到期/停用的真相在页顶那条横幅（`expiredBanner`）先说，不等客户点一次下单才后知后觉。
      setOrderError(reason instanceof Error && reason.message ? reason.message : '')
    } finally {
      setOrderingPlan(null)
    }
  }

  const copyReference = async () => {
    if (!intent) return
    await navigator.clipboard.writeText(intent.reference)
    setCopiedReference(true)
    window.setTimeout(() => setCopiedReference(false), 1600)
  }

  const reportPaid = async () => {
    if (!openOrder || reporting) return
    setReporting(true)
    setReportError(null)
    try {
      await apiPost<{ order: OrderDto }>(`/api/billing/orders/${openOrder.id}/report`, {
        reportNote: reportNote.trim() || null,
      })
      setReportNote('')
      setReused(false)
      await load()
    } catch (reason) {
      // 路由的 409/500 都带着一句中文（`该订单当前状态无法报付款` 等），原样给客户看，不改写。
      setReportError(reason instanceof Error && reason.message ? reason.message : '')
    } finally {
      setReporting(false)
    }
  }

  const team = data?.team ?? null
  const quota = team?.quota ?? null
  const plans = data?.plan ?? []

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">{t('title')}</h1>
      </div>

      {loading && (
        <Card>
          <CardContent className="space-y-3 py-8" aria-busy="true">
            <div className="h-4 w-40 animate-pulse rounded-md bg-muted" />
            <div className="h-4 w-64 animate-pulse rounded-md bg-muted" />
          </CardContent>
        </Card>
      )}

      {!loading && loadError !== null && (
        <Card>
          <CardContent className="space-y-3 py-6" role="alert">
            <p className="text-sm font-medium text-destructive">{t('loadFailed')}</p>
            {loadError && <p className="text-sm text-muted-foreground">{loadError}</p>}
            <Button variant="outline" size="sm" className="h-9" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />{t('retry')}
            </Button>
          </CardContent>
        </Card>
      )}

      {!loading && loadError === null && data && (
        <>
          {/* 到期横幅（Task 15 / 裁定 D-14）：判定用 `currentExpiry && getTime() <= nowMs`，
              不用 `remainingDays`（到期分支它是 null）。间距由根 div 的 `space-y-5` 负责，横幅自己不加 `mt-*`。 */}
          {currentExpiry && currentExpiry.getTime() <= nowMs && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive-visible px-3 py-2 text-sm font-medium text-destructive">
              {t('expiredBanner')}
            </p>
          )}
          <Card className={currentExpiry && currentExpiry.getTime() <= nowMs + RENEWAL_ALERT_DAYS * 86_400_000 ? 'border-l-4 border-primary' : undefined}>
            <CardHeader>
              <CardTitle className="text-base">{t('currentPlan')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <p className="text-lg font-semibold">
                  {plans.find((plan) => plan.key === team?.plan)?.name ?? team?.plan ?? '—'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {team?.expiresAt ? formatDay(team.expiresAt) : t('longTerm')}
                </p>
              </div>
              {remainingDays !== null && (
                <p className="text-sm text-muted-foreground">{t('remainingDays', { days: remainingDays })}</p>
              )}
              {/* 额度来源三分支：MANUAL 说手改；PLAN 且拿到备注码才说来自哪张单；
                  PLAN 无备注码 / source 为 null（团队还没有 TeamQuota 行）整行不渲染 —— 本地库里
                  这就是绝大多数团队的常态，写成两分支三元会渲染出「额度来自订单 」这种半句话。 */}
              {quota?.source === 'MANUAL' && (
                <p className="text-xs text-muted-foreground">{t('quotaFromManual')}</p>
              )}
              {quota?.source === 'PLAN' && quota.reference && (
                <p className="text-xs text-muted-foreground">{t('quotaFromOrder', { reference: quota.reference })}</p>
              )}
            </CardContent>
          </Card>

          {reused && (
            <p role="status" className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">{t('resumeNotice')}</p>
          )}

          {plans.length > 0 && (
            <section className="space-y-3" aria-label={t('plansTitle')}>
              <h2 className="text-base font-semibold">{t('plansTitle')}</h2>
              {orderError !== null && (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {t('orderFailed')}{orderError ? `：${orderError}` : ''}
                </p>
              )}
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {plans.map((plan) => {
                  const draft = drafts[plan.key] ?? EMPTY_DRAFT
                  const selected = draft.periods !== null
                  return (
                    <Card key={plan.key} className={selected ? 'border-primary' : undefined}>
                      <form onSubmit={(event) => { event.preventDefault(); void placeOrder(plan, draft) }}>
                        <CardHeader>
                          <CardTitle className="text-base">{plan.name}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div>
                            <p className="text-2xl font-semibold tabular-nums">{formatCents(plan.priceCents)}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{t('durationDays', { days: plan.durationDays })}</p>
                          </div>
                          {/* 「不限」的判据是 `isUnlimitedQuota`（0 **或负数**），与写闸门 `checkTeamStorageQuota`
                              同一个口径（F-12）：各写一遍的话，负数额度会「行为上不限、这里写着 -3 人」。 */}
                          <dl className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                            <div className="flex items-center justify-between gap-2">
                              <dt>{t('quotaMembers')}</dt>
                              <dd className="tabular-nums text-foreground">{isUnlimitedQuota(plan.quota.maxMembers) ? t('unlimited') : plan.quota.maxMembers}</dd>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <dt>{t('quotaProjects')}</dt>
                              <dd className="tabular-nums text-foreground">{isUnlimitedQuota(plan.quota.maxProjects) ? t('unlimited') : plan.quota.maxProjects}</dd>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <dt>{t('quotaVideos')}</dt>
                              <dd className="tabular-nums text-foreground">{isUnlimitedQuota(plan.quota.maxVideos) ? t('unlimited') : plan.quota.maxVideos}</dd>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <dt>{t('quotaStorage')}</dt>
                              <dd className="tabular-nums text-foreground">{isUnlimitedQuota(plan.quota.maxStorageGB) ? t('unlimited') : `${plan.quota.maxStorageGB} GB`}</dd>
                            </div>
                          </dl>

                          <div className="space-y-2">
                            <Label>{t('choosePeriod')}</Label>
                            <div role="group" aria-label={t('choosePeriod')} className="flex h-9 items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
                              {PERIODS.map((periods) => {
                                const active = draft.periods === periods
                                return (
                                  <button
                                    key={periods}
                                    type="button"
                                    aria-pressed={active}
                                    onClick={() => patchDraft(plan.key, { periods })}
                                    className={`h-[30px] rounded-md px-3 text-sm transition-colors ${active ? 'bg-card font-medium text-foreground shadow-elevation-sm' : 'text-muted-foreground hover:text-foreground'}`}
                                  >
                                    {periods}
                                  </button>
                                )
                              })}
                            </div>
                          </div>

                          {selected && nowMs > 0 && (
                            <p className="text-sm font-medium">
                              <span className="tabular-nums">{t('orderTotal', { amount: formatCents(plan.priceCents * (draft.periods ?? 0)) })}</span>
                              <span aria-hidden="true" className="mx-2 text-muted-foreground">｜</span>
                              <span className="tabular-nums">
                                {/* 预览就用服务端那枚纯函数（`nextExpiryMs`：未到期从现到期日叠，已到期从现在起算），
                                    所以这一行跟运营确认到账时看到的算法是同一个。 */}
                                {t('expiryWillBe', {
                                  date: formatDay(nextExpiryMs(currentExpiry, nowMs, plan.durationDays * (draft.periods ?? 0))),
                                })}
                              </span>
                            </p>
                          )}

                          <div className="space-y-3 border-t border-border pt-3">
                            <Label className="flex items-center gap-2 font-normal">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-input accent-primary"
                                checked={draft.invoice}
                                onChange={(event) => patchDraft(plan.key, { invoice: event.target.checked })}
                              />
                              {t('invoiceNeed')}
                            </Label>
                            {draft.invoice && (
                              <div className="grid gap-3">
                                <div className="space-y-1.5">
                                  <Label htmlFor={`invoice-title-${plan.key}`}>{t('invoiceTitleLabel')}</Label>
                                  <Input
                                    id={`invoice-title-${plan.key}`}
                                    className="h-9"
                                    value={draft.title}
                                    maxLength={80}
                                    required
                                    onChange={(event) => patchDraft(plan.key, { title: event.target.value })}
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <Label htmlFor={`invoice-tax-no-${plan.key}`}>{t('invoiceTaxNoLabel')}</Label>
                                  <Input
                                    id={`invoice-tax-no-${plan.key}`}
                                    className="h-9"
                                    value={draft.taxNo}
                                    maxLength={40}
                                    required
                                    onChange={(event) => patchDraft(plan.key, { taxNo: event.target.value })}
                                  />
                                </div>
                              </div>
                            )}
                            <Button type="submit" className="h-9 w-full" disabled={!selected || orderingPlan !== null}>
                              {t('orderNow')}
                            </Button>
                          </div>
                        </CardContent>
                      </form>
                    </Card>
                  )
                })}
              </div>
            </section>
          )}

          {openOrder && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('transferTitle')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {intentError !== null && !intent && (
                  <p role="alert" className="text-sm text-muted-foreground">{intentError || t('loadFailed')}</p>
                )}

                {intent && (
                  <>
                    <dl className="grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-xs text-muted-foreground">{t('accountName')}</dt>
                        <dd className="mt-1 font-medium">{intent.accountName}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">{t('bank')}</dt>
                        <dd className="mt-1 font-medium">{intent.bank ?? '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">{t('accountNo')}</dt>
                        <dd className="mt-1 font-medium tabular-nums">{intent.accountNo}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">{t('amount')}</dt>
                        <dd className="mt-1 font-medium tabular-nums">{formatCents(intent.amountCents)}</dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-xs text-muted-foreground">{t('reference')}</dt>
                        <dd className="mt-1 flex flex-wrap items-center gap-2">
                          <code className="rounded-md bg-muted px-2 py-1 font-mono text-sm">{intent.reference}</code>
                          <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => void copyReference()}>
                            <Copy className="h-4 w-4" />{copiedReference ? t('copied') : t('copyReference')}
                          </Button>
                        </dd>
                      </div>
                    </dl>

                    {hasQr && (
                      qrSrc
                        ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={qrSrc} alt={t('transferTitle')} className="h-40 w-40 rounded-lg border border-border object-contain" />
                          )
                        : qrFailed && <p className="text-xs text-muted-foreground">{ts('transfer.qrLoadFailed')}</p>
                    )}

                    {/* 补充说明是运营在平台设置里写的**文案**，不是界面 key：原样多行渲染。 */}
                    {intent.note && (
                      <p className="whitespace-pre-line rounded-md bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{intent.note}</p>
                    )}

                    <div className="space-y-2">
                      <Label htmlFor="billing-report-note">{t('colNote')}</Label>
                      <Input
                        id="billing-report-note"
                        className="h-9"
                        value={reportNote}
                        // 上限与服务端同源：`reportOrderPaid`（`src/lib/billing.ts`）把 note trim 之后
                        // 裁到 200 字符。这里给同样的数，客户就不会在界面上看着自己写的那句话被悄悄剪掉。
                        maxLength={200}
                        placeholder={t('reportNotePlaceholder')}
                        onChange={(event) => setReportNote(event.target.value)}
                      />
                    </div>

                    {reportError !== null && (
                      <p role="alert" className="text-sm font-medium text-destructive">{reportError || t('orderFailed')}</p>
                    )}

                    <Button type="button" className="h-9" onClick={() => void reportPaid()} disabled={reporting}>
                      <CheckCircle2 className="h-4 w-4" />{t('iHavePaid')}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {!openOrder && reportedOrder && (
            <Card>
              <CardContent className="flex items-start gap-3 py-5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p className="text-sm text-muted-foreground">{t('awaitingConfirm')}</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('historyTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-y border-border bg-muted/40 text-left text-xs text-muted-foreground">
                    <th className="px-5 py-3 font-medium">{t('colCreated')}</th>
                    <th className="px-3 py-3 font-medium">{t('colPlan')}</th>
                    <th className="px-3 py-3 font-medium">{t('colAmount')}</th>
                    <th className="px-3 py-3 font-medium">{t('colValidUntil')}</th>
                    <th className="px-3 py-3 font-medium">{t('colStatus')}</th>
                    <th className="px-5 py-3 font-medium">{t('colNote')}</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id} className="border-b border-border last:border-0 align-top">
                      <td className="px-5 py-3 tabular-nums text-muted-foreground">{formatMoment(order.createdAt)}</td>
                      {/* 历史单可以指向一张已经不卖的套餐：`Order.planKey` 是字符串、不是活动 Plan 的外键，
                          所以匹配不到卡片时退回 planKey 本身，这一行照样得渲染出来。 */}
                      <td className="px-3 py-3 font-medium">
                        {plans.find((plan) => plan.key === order.planKey)?.name ?? order.planKey}
                        <span className="ml-1 text-xs text-muted-foreground">× {order.periods}</span>
                      </td>
                      <td className="px-3 py-3 tabular-nums">{formatCents(order.amountCents)}</td>
                      <td className="px-3 py-3 tabular-nums">{order.periodEnd ? formatDay(order.periodEnd) : '—'}</td>
                      <td className="px-3 py-3">
                        <span className="font-medium">{statusLabel(order.status, t)}</span>
                        {order.status === 'CLOSED' && order.closeReason && (
                          <p className="mt-1 text-xs text-muted-foreground">{order.closeReason}</p>
                        )}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{order.reportNote ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

/**
 * 状态列的字面量。`Order.status` 是裸 String 列，取值见 `billing-pricing.ts:4`；
 * locales 里没有 `statusPAID`（一期人确认后立刻 FULFILLED，PAID 只是回调通道的中间态），
 * 所以认不出的状态回落到原值而不是崩在这一行上。
 */
function statusLabel(status: string, t: ReturnType<typeof useTranslations>): string {
  if (status === 'OPEN') return t('statusOPEN')
  if (status === 'REPORTED') return t('statusREPORTED')
  if (status === 'FULFILLED') return t('statusFULFILLED')
  if (status === 'CLOSED') return t('statusCLOSED')
  return status
}
