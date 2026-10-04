'use client'

import { useEffect, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Copy, ReceiptText, RefreshCw } from 'lucide-react'
import { copyTextToClipboard } from '@/lib/clipboard'
import type { OrderDto } from '@/lib/billing-dto'
import { isUnlimitedQuota, type PlanQuota } from '@/lib/billing-pricing'

/**
 * 平台运营队列的**展示层**（Task 12 Step 2）。
 *
 * 为什么单独成一枚文件而不是把表格写在 `src/app/platform/orders/page.tsx` 里：
 * 裁定 D-22 要求本任务的渲染证明「**直接挂真组件**并用桩数据驱动三种状态」，而真组件要是自己发请求，
 * 桩数据就没有注入点（一期本地库里既没有 REPORTED 单，也不许为了点界面造单 —— 见台账 D-22）。
 * 于是把「数字怎么摆」放这里（props 驱动、可桩、可 SSR），把「数字从哪来」留在页面里。
 */

/** 列表行 / 详情行的形状 = `OrderDto`（白名单，`src/lib/billing-dto.ts`）+ Task 11 加的两列名字。 */
export type PlatformOrderRow = OrderDto & { teamName: string; planName: string }

/**
 * `GET /api/platform/orders/[id]` 里 `preview` 过完 JSON 之后的形状。
 * 类型落成 `toExpiryDate: string` 是有意的：`PreviewResult.toExpiryDate` 是 `Date`
 * （`src/lib/billing-pricing.ts:76`），但 HTTP 响应里它是 ISO 串，界面写 `Date` 会在 tsc 里红；
 * `fromExpiry` / `toExpiry` 仍是**毫秒数**（`:74`，`currentExpiresAt` 为空时它就是 `nowMs`）。
 * 两半类型不一样，所以两边都只能过同一个 `formatDay()` 再上界面。
 */
export type OrderPreviewWire = {
  fromExpiry: number
  toExpiry: number
  toExpiryDate: string
  willResetManual: boolean
  quotaChanged: boolean
  nextQuota: PlanQuota
}

export type OrderDetail = { order: PlatformOrderRow; preview: OrderPreviewWire }

/**
 * 队列的两个 tab（Step 2：`REPORTED` 默认 / `OPEN`）。
 *
 * **裁定 m-9**：白名单 `['REPORTED','OPEN','ALL']` 大小写敏感，`?status=all` 这类自由文本会被
 * 静默降级成 REPORTED 队列（不报错、响应里也不说）。所以下面这枚 URL 表是**唯一**的拼 URL 的地方，
 * 键是 TS 字面量常量，任何用户输入或大小写归一后的字符串都进不来。
 */
export const QUEUE_FILTERS = ['REPORTED', 'OPEN'] as const
export type QueueFilter = (typeof QUEUE_FILTERS)[number]

export const QUEUE_TAB_LABEL: Record<QueueFilter, string> = { REPORTED: '等你确认', OPEN: '已下单未付' }

/** 与列表路由 `take: 100` 同一枚数字；界面那句「仅显示最近 100 条」从这里取，不写第二份字面量。 */
export const QUEUE_LIST_LIMIT = 100

/** 队列列表容器与 tab 的 ARIA 关联 id（`role="tablist"` 那一套的四个配套属性都从这里取）。 */
const QUEUE_TAB_ID = 'platform-orders-tab'
const QUEUE_PANEL_ID = 'platform-orders-panel'

const EMPTY_TEXT: Record<QueueFilter, string> = {
  REPORTED: '没有等待确认的订单。',
  OPEN: '没有已下单未付的订单。',
}

/** 空队列那一栏下面那句：告诉运营「单子凭什么会出现」，而不是只说这里空着。 */
const EMPTY_HINT: Record<QueueFilter, string> = {
  REPORTED: '客户在「套餐与续费」里点过「我已完成付款」的单子才进这一栏，空着就是暂时没人报付款。',
  OPEN: '这一栏是已下单、客户还没报付款的单子，不需要操作；对方报付款后会出现在「等你确认」。',
}

const STATUS_LABEL: Record<string, string> = {
  OPEN: '已下单未付',
  REPORTED: '客户已报付款',
  PAID: '已付款待落地',
  FULFILLED: '已到账',
  CLOSED: '已关单',
}

/** 认不出的状态回落到原值：状态列是裸 String，界面不该因为多一种取值就崩在这一行上。 */
export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status
}

/**
 * **裁定 m-5**：`[id]` 路由没有状态闸门（详情可看历史是刻意的），所以对 `FULFILLED` / `CLOSED`
 * 它照样回一串「今天再 +93 天」的 `preview` —— 那串数字永不发生。
 * 判定只看 `order.status`，不看 `preview` 的字段空不空（终态单的 preview 字段一个都不空）。
 */
const PREVIEWABLE_STATUSES = ['OPEN', 'REPORTED'] as const
export function canShowPreviewArrow(status: string): boolean {
  return (PREVIEWABLE_STATUSES as readonly string[]).includes(status)
}

const pad = (value: number) => String(value).padStart(2, '0')

/** `YYYY-MM-DD`。弹窗那两半（毫秒数与 ISO 串）都走这一枚，绝不把 `fromExpiry` 直接插进 JSX。 */
export function formatDay(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function formatMoment(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${formatDay(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * Step 0：「`amountCents` 旁边永远带 `currency`」。一期库里只可能出 `CNY`，但把「¥」写死
 * 等于把「这笔钱多少」与「这笔钱是什么币种」混成一件事，二期出多币种时界面就在说谎。
 * 认不出的币种代码一律原样带在数字后面，不塌成 ¥。
 */
export function formatAmount(amountCents: number, currency: string): string {
  const amount = (amountCents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (currency === 'CNY') return `¥${amount}`
  return `${amount} ${currency || '未标币种'}`
}

/**
 * 额度四列：「不限」的判据与客户账单页、与写闸门 `checkTeamStorageQuota` 同一枚
 * `isUnlimitedQuota`（spec §4.1：0 **或负数**都是不限，F-12）。各写一遍的话，负数额度会
 * 行为上不限、这里却写着「-3 人」。
 */
export function quotaText(quota: PlanQuota): string {
  const part = (value: number, unit: string) => (isUnlimitedQuota(value) ? '不限' : `${value} ${unit}`)
  return `${part(quota.maxMembers, '人')} / ${part(quota.maxProjects, '项目')} / ${part(quota.maxVideos, '视频')} / ${part(quota.maxStorageGB, 'GB')}`
}

/**
 * 备注码 = 运营在网银流水里搜的那一串（spec §8.1），所以它**可选可复制**：
 * `select-all` 让一次点击选中整串，复制按钮走 `copyTextToClipboard()` 并**按返回值**给反馈 ——
 * 非安全上下文（HTTP LAN）走 `execCommand` 兜底，返回 false 时必须说「没复制上」，
 * 假定成功就是把运营的核对动作建在一次静默失败上。
 */
export function ReferenceCode({ value, className = '' }: { value: string; className?: string }) {
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(null), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    setCopied((await copyTextToClipboard(value)) ? 'ok' : 'fail')
  }

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <code className="select-all rounded-md bg-muted px-2 py-1 font-mono text-xs text-foreground">{value}</code>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`复制备注码 ${value}`}
        className="inline-flex h-9 items-center gap-1 rounded-lg px-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        {copied === 'ok' ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
        {copied === 'ok' ? '已复制' : copied === 'fail' ? '没复制上，请手动选中' : '复制'}
      </button>
    </span>
  )
}

/** 客户填了开票信息 → 队列里必须留痕（Task 3 评审 I-2 的读侧）。 */
function InvoiceBadge() {
  return (
    <span className="ml-1.5 inline-flex items-center gap-1 rounded-md bg-primary-visible px-1.5 py-0.5 text-xs font-medium text-primary">
      <ReceiptText className="h-3 w-3" />
      需开票
    </span>
  )
}

type Props = {
  filter: QueueFilter
  /** 全库不限行的按状态计数；`groupBy` 对零计数的状态**压根不出行**，所以只能是可缺键的表。 */
  counts: Record<string, number> | null
  /** 与当前筛选同谓词的行数（裁定 D-18），`total > rows.length` 时界面明示被截断。 */
  total: number | null
  rows: PlatformOrderRow[]
  loading: boolean
  error: string | null
  notice: { tone: 'ok' | 'error'; text: string } | null
  expandedId: string | null
  detail: OrderDetail | null
  detailLoading: boolean
  detailError: string | null
  /** 这一行的读/写请求在飞（弹窗预览读取、关单提交）⇒ 按钮禁用，不给连点两次的路。 */
  busyRowId: string | null
  onFilterChange: (filter: QueueFilter) => void
  onRetry: () => void
  onToggleDetail: (id: string) => void
  onRetryDetail: (id: string) => void
  /** 第一次点击：只打开二次确认弹窗，**不发 POST**（Step 3）。 */
  onOpenConfirm: (row: PlatformOrderRow) => void
  onCloseOrder: (row: PlatformOrderRow) => void
}

export function OrderQueue(props: Props) {
  const {
    filter, counts, total, rows, loading, error, notice,
    expandedId, detail, detailLoading, detailError, busyRowId,
    onFilterChange, onRetry, onToggleDetail, onRetryDetail, onOpenConfirm, onCloseOrder,
  } = props

  // **裁定 m-9**：徽标一律 `counts?.[status] ?? 0`。`groupBy` 不给零计数的状态出行，
  // 直接写 `counts.REPORTED` 会在 tab 上渲染出 `undefined`。
  const badge = (status: QueueFilter) => counts?.[status] ?? 0
  const truncated = total !== null && total > rows.length

  // 两枚 tab 的键盘模型（Task 15 / 裁定 N-2，APG tabs 口径）：
  // ArrowLeft / ArrowRight 换 tab 并把焦点挪到新选中那枚；Home / End 落在首 / 尾那枚。
  // 四个键都 preventDefault()，方向键不许触发页面滚动。
  // 焦点用现成的 `${QUEUE_TAB_ID}-<filter>` id 取，**不新写一套 ref 注册表**。
  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, item: QueueFilter) => {
    const index = QUEUE_FILTERS.indexOf(item)
    let next: QueueFilter | null = null
    if (event.key === 'ArrowRight') next = QUEUE_FILTERS[(index + 1) % QUEUE_FILTERS.length]
    else if (event.key === 'ArrowLeft') next = QUEUE_FILTERS[(index - 1 + QUEUE_FILTERS.length) % QUEUE_FILTERS.length]
    else if (event.key === 'Home') next = QUEUE_FILTERS[0]
    else if (event.key === 'End') next = QUEUE_FILTERS[QUEUE_FILTERS.length - 1]
    if (!next) return
    event.preventDefault()
    onFilterChange(next)
    document.getElementById(`${QUEUE_TAB_ID}-${next}`)?.focus()
  }

  return (
    <div className="space-y-4">
      {/* Task 15 / 裁定 N-2 第 1 件：`role="tablist"` 的容器里只留两枚 tab ——「刷新」不是 tab，
          不许混坐在同一层。外面这一层**不带 role** 的 flex 容器把「tab 组」与「刷新」并排：
          刷新仍由 `ml-auto` 顶到最右、两枚 tab 之间与 tab-刷新之间仍是 gap-1.5，视觉位置与间距不变。 */}
      <div className="flex items-center gap-1.5">
        <div role="tablist" aria-label="订单队列筛选" className="flex items-center gap-1.5">
          {QUEUE_FILTERS.map((item) => {
            const active = item === filter
            return (
              <button
                key={item}
                type="button"
                id={`${QUEUE_TAB_ID}-${item}`}
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                // 键盘模型（Task 15 / 裁定 N-2）：roving `tabIndex`（选中 0 / 另一枚 -1）+
                // ArrowLeft/ArrowRight/Home/End（见 `onTabKeyDown`）。面板恒挂载，
                // 所以两枚 tab 的 `aria-controls` 与面板的 `aria-labelledby` 在两态都指得着。
                aria-controls={QUEUE_PANEL_ID}
                onKeyDown={(event) => onTabKeyDown(event, item)}
                // Step 4 义务 4：URL 只从这枚常量表来，`onFilterChange` 收到的也是字面量常量。
                onClick={() => onFilterChange(item)}
                className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${
                  active ? 'bg-primary-visible text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {QUEUE_TAB_LABEL[item]}
                <span className="tabular-nums text-xs opacity-80">{badge(item)}</span>
              </button>
            )
          })}
        </div>
        <button
          type="button"
          onClick={onRetry}
          disabled={loading}
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="h-4 w-4" />
          刷新
        </button>
      </div>

      {notice && (
        <p role="status" aria-live="polite" className={`text-sm ${notice.tone === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
          {notice.text}
        </p>
      )}

      {/* Task 15 / 裁定 N-2 第 4 件（选 (i) 恒渲染）：面板 section 不随 error 摘挂 ——
          摘掉它 tab 的 `aria-controls` 就指向虚无，旧注释那句「不留悬空引用」也永远对不上现实。
          失败态时在 section **内部**显示失败提示：数据口径不变 —— 请求出错时照样**不**渲染
          空队列文案，否则运营会以为「没人等确认」而漏单（提示文案与按钮沿用原有那一支，未新增）。 */}
      <section
        id={QUEUE_PANEL_ID}
        role="tabpanel"
        aria-labelledby={`${QUEUE_TAB_ID}-${filter}`}
        className="overflow-hidden rounded-lg border border-border bg-card"
      >
        {error ? (
          <div role="alert" className="bg-destructive-visible p-4">
            <p className="text-sm font-medium text-destructive">订单队列读取失败，请按下方按钮重试。</p>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground"
            >
              <RefreshCw className="h-4 w-4" />
              重试
            </button>
          </div>
        ) : (
          <>
            {/* 裁定 D-18：`total` 与 `orders` 是两个口径，被截掉的单子在控制台里必须有发现途径。
                这句话的字面就是 D-18 给的那一句，真分页（`skip`/`page`）留二期，本期只要求**可见**。 */}
            {truncated && (
              <p className="border-b border-border bg-muted/40 px-5 py-2.5 text-sm text-muted-foreground" role="status">
                共 {total} 条，仅显示最近 {QUEUE_LIST_LIMIT} 条
              </p>
            )}
            {loading ? (
              <div className="p-10 text-center text-sm text-muted-foreground">正在加载订单...</div>
            ) : rows.length === 0 ? (
              <div className="p-10 text-center text-sm text-muted-foreground">
                <p>{EMPTY_TEXT[filter]}</p>
                <p className="mx-auto mt-1 max-w-md text-xs">{EMPTY_HINT[filter]}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                      <th className="px-5 py-3 font-medium">团队</th>
                      <th className="px-3 py-3 font-medium">备注码</th>
                      <th className="px-3 py-3 font-medium">套餐 × 周期</th>
                      <th className="px-3 py-3 font-medium">金额</th>
                      <th className="px-3 py-3 font-medium">报付款时间</th>
                      <th className="px-3 py-3 font-medium">客户线索</th>
                      <th className="px-5 py-3 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const expanded = expandedId === row.id
                      return (
                        <RowGroup
                          key={row.id}
                          row={row}
                          expanded={expanded}
                          busy={busyRowId === row.id}
                          detail={expanded ? detail : null}
                          detailLoading={expanded && detailLoading}
                          detailError={expanded ? detailError : null}
                          onToggleDetail={onToggleDetail}
                          onRetryDetail={onRetryDetail}
                          onOpenConfirm={onOpenConfirm}
                          onCloseOrder={onCloseOrder}
                        />
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}

function RowGroup({
  row, expanded, busy, detail, detailLoading, detailError,
  onToggleDetail, onRetryDetail, onOpenConfirm, onCloseOrder,
}: {
  row: PlatformOrderRow
  expanded: boolean
  busy: boolean
  detail: OrderDetail | null
  detailLoading: boolean
  detailError: string | null
  onToggleDetail: (id: string) => void
  onRetryDetail: (id: string) => void
  onOpenConfirm: (row: PlatformOrderRow) => void
  onCloseOrder: (row: PlatformOrderRow) => void
}) {
  return (
    <>
      <tr className="border-b border-border last:border-0 align-top">
        <td className="px-5 py-3 font-medium">
          {row.teamName}
          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{statusLabel(row.status)}</span>
        </td>
        <td className="px-3 py-3"><ReferenceCode value={row.reference} /></td>
        <td className="px-3 py-3">
          {row.planName}
          <span className="ml-1 text-xs text-muted-foreground">× {row.periods}</span>
          {row.invoiceRequested && <InvoiceBadge />}
        </td>
        <td className="px-3 py-3 tabular-nums">{formatAmount(row.amountCents, row.currency)}</td>
        <td className="px-3 py-3 tabular-nums text-muted-foreground">{formatMoment(row.reportedAt)}</td>
        {/* 这一列被 `max-w-[240px]` 裁断，客户写多长的付款线索都只会看到前半句 ⇒ 必须给 `title`，
            否则运营看不到全句就去猜（猜出来的付款线索不是证据）。`line-clamp` 会改行高，本期只加 tooltip。 */}
        <td className="max-w-[240px] px-3 py-3 text-muted-foreground" title={row.reportNote ?? undefined}>
          {row.reportNote ?? '—'}
        </td>
        <td className="px-5 py-3">
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => onToggleDetail(row.id)}
              aria-expanded={expanded}
              className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-sm text-muted-foreground hover:text-foreground"
            >
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              详情
            </button>
            {row.status === 'REPORTED' && (
              // Step 3：这枚按钮**只开窗**，POST 在弹窗里的「确认到账」那一次点击。
              <button
                type="button"
                onClick={() => onOpenConfirm(row)}
                disabled={busy}
                className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                确认已到账
              </button>
            )}
            {row.status === 'OPEN' && (
              <button
                type="button"
                onClick={() => onCloseOrder(row)}
                disabled={busy}
                className="inline-flex h-9 items-center rounded-lg border border-destructive/30 px-3 text-sm font-medium text-destructive disabled:opacity-60"
              >
                关单
              </button>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border last:border-0 bg-muted/20">
          <td colSpan={7} className="px-5 py-4">
            {detailLoading && <p className="text-sm text-muted-foreground">正在读取订单详情...</p>}
            {detailError && (
              <div role="alert" className="space-y-2">
                <p className="text-sm font-medium text-destructive">订单详情读取失败</p>
                <p className="text-sm text-muted-foreground">{detailError}</p>
                <button
                  type="button"
                  onClick={() => onRetryDetail(row.id)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm"
                >
                  <RefreshCw className="h-4 w-4" />
                  重试
                </button>
              </div>
            )}
            {!detailLoading && !detailError && detail && <OrderDetailPanel detail={detail} />}
          </td>
        </tr>
      )}
    </>
  )
}

/**
 * 每行都能点开的详情面板（Step 2）。
 * 终态单照常开，但 **不渲染「旧 → 新」那一行**（裁定 m-5）：那串数字对 `FULFILLED` / `CLOSED` 永不发生。
 */
export function OrderDetailPanel({ detail }: { detail: OrderDetail }) {
  const { order, preview } = detail
  const showArrow = canShowPreviewArrow(order.status)
  return (
    <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
      <div className="flex items-baseline gap-2">
        <dt className="shrink-0 text-xs text-muted-foreground">订单号</dt>
        <dd className="break-all font-mono text-xs">{order.id}</dd>
      </div>
      <div className="flex items-baseline gap-2">
        <dt className="shrink-0 text-xs text-muted-foreground">状态</dt>
        <dd className="font-medium">{statusLabel(order.status)}</dd>
      </div>
      <div className="flex items-baseline gap-2">
        <dt className="shrink-0 text-xs text-muted-foreground">下单时间</dt>
        <dd className="tabular-nums">{formatMoment(order.createdAt)}</dd>
      </div>
      <div className="flex items-baseline gap-2">
        <dt className="shrink-0 text-xs text-muted-foreground">报付款时间</dt>
        <dd className="tabular-nums">{formatMoment(order.reportedAt)}</dd>
      </div>
      <div className="flex items-baseline gap-2">
        <dt className="shrink-0 text-xs text-muted-foreground">套餐</dt>
        <dd>{order.planName} × {order.periods}<span className="ml-1 font-mono text-xs text-muted-foreground">{order.planKey}</span></dd>
      </div>
      <div className="flex items-baseline gap-2">
        <dt className="shrink-0 text-xs text-muted-foreground">金额</dt>
        <dd className="tabular-nums">{formatAmount(order.amountCents, order.currency)}</dd>
      </div>
      <div className="flex items-baseline gap-2">
        <dt className="shrink-0 text-xs text-muted-foreground">备注码</dt>
        <dd><ReferenceCode value={order.reference} /></dd>
      </div>
      <div className="flex items-baseline gap-2">
        <dt className="shrink-0 text-xs text-muted-foreground">生效区间末</dt>
        <dd className="tabular-nums">{order.periodEnd ? formatDay(order.periodEnd) : '—'}</dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="text-xs text-muted-foreground">客户付款线索</dt>
        <dd className="mt-1 text-muted-foreground">{order.reportNote ?? '—'}</dd>
      </div>

      {/* 开票需求：客户填了就必须在运营这一侧看得见，否则等于把请求收走又丢掉（Task 3 评审 I-2 读侧）。 */}
      <div className="sm:col-span-2">
        <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
          开票需求
          {order.invoiceRequested ? <InvoiceBadge /> : <span className="text-muted-foreground">无</span>}
        </dt>
        {order.invoiceRequested && (
          <dd className="mt-1 grid gap-x-6 sm:grid-cols-2">
            <span><span className="text-xs text-muted-foreground">抬头：</span>{order.invoiceTitle || '—'}</span>
            <span><span className="text-xs text-muted-foreground">纳税人识别号：</span><span className="font-mono text-xs">{order.invoiceTaxNo || '—'}</span></span>
          </dd>
        )}
      </div>

      {order.status === 'CLOSED' && (
        <div className="sm:col-span-2">
          <dt className="text-xs text-muted-foreground">关单理由（客户在账单页看得到这句）</dt>
          <dd className="mt-1">{order.closeReason ?? '—'}</dd>
        </div>
      )}
      {order.status === 'FULFILLED' && (
        <div className="flex items-baseline gap-2">
          <dt className="shrink-0 text-xs text-muted-foreground">落地时间</dt>
          <dd className="tabular-nums">{formatMoment(order.fulfilledAt)}</dd>
        </div>
      )}

      {showArrow ? (
        <div className="sm:col-span-2">
          <dt className="text-xs text-muted-foreground">确认到账后的效果</dt>
          <dd className="mt-1 space-y-1">
            <p className="tabular-nums">到期日 {formatDay(preview.fromExpiry)} → {formatDay(preview.toExpiryDate)}</p>
            <p className="text-muted-foreground">
              额度 {preview.quotaChanged ? `将设为 ${quotaText(preview.nextQuota)}` : `不变（${quotaText(preview.nextQuota)}）`}
            </p>
            {preview.willResetManual && <p className="text-destructive">当前额度是手动调整的，将被本套餐重置</p>}
          </dd>
        </div>
      ) : (
        <div className="sm:col-span-2">
          <dt className="text-xs text-muted-foreground">确认到账后的效果</dt>
          {/* 裁定 m-5：终态单的 preview 数字永不发生，这里不画箭头，只说这张单实际是什么状态。 */}
          <dd className="mt-1 text-sm text-muted-foreground">这张单已是终态（{statusLabel(order.status)}），不再给「旧 → 新」的到账预览。</dd>
        </div>
      )}
    </dl>
  )
}
