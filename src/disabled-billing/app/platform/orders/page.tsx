'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { OrderQueue, type OrderPreviewWire, type QueueFilter, type OrderDetail, type PlatformOrderRow } from '@/disabled-billing/components/platform/OrderQueue'
import { OrderConfirmDialog } from '@/disabled-billing/components/platform/OrderConfirmDialog'
import { appPrompt } from '@/components/AppDialogProvider'
import { apiFetch, apiPost } from '@/lib/api-client'
import type { PlanQuota } from '@/disabled-billing/lib/billing-pricing'

/**
 * `/platform/orders`：一期唯一的「这笔钱到没到」人工核对台（spec §8.1、§8.2）。
 *
 * 这一层只做三件事：取数、把取到的数交给展示层、把两个写入口（confirm / close）接上。
 * 数字怎么摆全在 `OrderQueue` / `OrderConfirmDialog` 里，所以那两枚组件可以被桩数据直接挂载
 * （裁定 D-22 的渲染证明要求的就是这个）。
 */

/**
 * **裁定 m-9**：`status` 白名单大小写敏感，`?status=all` 会被静默降级成 REPORTED 队列
 * （不报错、响应里也不说）。所以 URL 只可能从这枚常量表里取，`QUEUE_FILTERS` 是唯一的状态来源；
 * 界面没有任何路径能把用户输入或大小写归一后的字符串送进查询串。
 */
const LIST_URL: Record<QueueFilter, string> = {
  REPORTED: '/api/platform/orders?status=REPORTED',
  OPEN: '/api/platform/orders?status=OPEN',
}

type ListPayload = { orders?: PlatformOrderRow[]; counts?: Record<string, number>; total?: number; error?: string }
/** `currentQuota` 与 `preview` 同级（裁定 D-25）；缺 TeamQuota 行时服务端给的就是 `null`，这里不许抹平。 */
type DetailPayload = { order?: PlatformOrderRow; preview?: OrderPreviewWire; currentQuota?: PlanQuota | null; error?: string }
type DialogState = { row: PlatformOrderRow; preview: OrderPreviewWire | null; currentQuota: PlanQuota | null; previewError: string | null }

function messageOf(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback
}

export default function PlatformOrdersPage() {
  const [filter, setFilter] = useState<QueueFilter>('REPORTED')
  const [rows, setRows] = useState<PlatformOrderRow[]>([])
  const [counts, setCounts] = useState<Record<string, number> | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<OrderDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const [dialog, setDialog] = useState<DialogState | null>(null)
  // 只有一发写请求在飞时锁住那一行的按钮（关单）；「确认到账」的连点由弹窗自己的 `submitting` 管。
  const [busyRowId, setBusyRowId] = useState<string | null>(null)

  // 快速切 tab 时上一发可能后到。序号比对保证「迟到的那一发不覆盖当前筛选的结果」——
  // 否则运营会看到 REPORTED 的徽标配着 OPEN 的行。
  const listSeq = useRef(0)

  /**
   * 详情那一发**属于哪一单**（F-2）。`loadDetail` 起手就把它写成「最后一次发起的那一单」，
   * 落地时再比一次 —— 与 `loadPreview` 的「函数式 setter + 比对 id」同一型，只是详情的当前那一单
   * 记在 `expandedId` 里而不是 state 里，所以用 ref 存。
   * 每一处会打开详情面板的路径（`toggleDetail` / `onRetryDetail` / `reloadAfterDialog` / `requestClose`
   * 的收尾）都走 `loadDetail`，所以「最后一次发起的那一单」与「当前展开那一单」是同一件事；
   * 唯一的例外是「请求在飞时把面板收起」：那一发仍会写进 `detail`，但渲染闸门（`OrderQueue` 的
   * `detail={detail && detail.order.id === expandedId ? detail : null}`）与收起的面板都不显示它。
   */
  const detailReqId = useRef<string | null>(null)

  const load = useCallback(async (target: QueueFilter) => {
    const seq = listSeq.current + 1
    listSeq.current = seq
    setLoading(true)
    setError(null)
    try {
      const response = await apiFetch(LIST_URL[target], { cache: 'no-store' })
      const payload = (await response.json().catch(() => null)) as ListPayload | null
      if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`)
      if (seq !== listSeq.current) return
      setRows(payload?.orders ?? [])
      // `counts` 原样存（可以是 `{}`）：零计数的状态压根不出键，缺键必须由展示层按 `?? 0` 处理
      // （裁定 m-1 结转的界面义务），这里不替它兜成 0，免得界面里看不到那条规则真的在跑。
      setCounts(payload?.counts ?? {})
      // 裁定 D-18：`total` 是与当前筛选同谓词的行数（不限 100），界面靠它说「只显示最近 100 条」。
      // 缺这一枚键时按「不知道总数」处理（`null`），不假造一个等于行数的数字。
      setTotal(typeof payload?.total === 'number' ? payload.total : null)
    } catch (reason) {
      if (seq !== listSeq.current) return
      // 失败就说失败，并且把上一批行清掉：留着旧行等于让运营按一份过期的名单核对钱。
      setRows([])
      setCounts(null)
      setTotal(null)
      setError(messageOf(reason, '订单队列读取失败'))
    } finally {
      if (seq === listSeq.current) setLoading(false)
    }
  }, [])

  useEffect(() => { void load(filter) }, [filter, load])

  const loadDetail = useCallback(async (id: string) => {
    detailReqId.current = id
    setDetailLoading(true)
    setDetailError(null)
    try {
      const response = await apiFetch(`/api/platform/orders/${id}`, { cache: 'no-store' })
      const payload = (await response.json().catch(() => null)) as DetailPayload | null
      if (!response.ok || !payload?.order || !payload.preview) {
        throw new Error(payload?.error || `HTTP ${response.status}`)
      }
      // 迟到的一发整支丢弃（F-2）：快速点开 A 再点 B 时，A 的响应可以晚于 B 落地。
      // 不比对的话 `detail` 会变成 A 而 `expandedId` 是 B、`detailLoading` 已经 false、`detailError` 是 null
      // ⇒ B 那格详情**空白且不说为什么**。
      if (detailReqId.current !== id) return
      setDetail({ order: payload.order, preview: payload.preview })
    } catch (reason) {
      if (detailReqId.current !== id) return
      setDetail(null)
      setDetailError(messageOf(reason, '订单详情读取失败'))
    } finally {
      // 只有当前那一发才许收 loading，否则迟到的那一发会把正在转圈的那一单说成「读完了」。
      if (detailReqId.current === id) setDetailLoading(false)
    }
  }, [])

  /** 预览（`preview`）与当前额度（`currentQuota`）只在弹窗需要那四行数字时读一次；读失败时弹窗的确认按钮保持禁用。 */
  const loadPreview = useCallback(async (orderId: string) => {
    try {
      const response = await apiFetch(`/api/platform/orders/${orderId}`, { cache: 'no-store' })
      const payload = (await response.json().catch(() => null)) as DetailPayload | null
      if (!response.ok || !payload?.preview) throw new Error(payload?.error || `HTTP ${response.status}`)
      // 函数式更新 + 比对 id：窗口已经换到别的单（或已被关掉）时，这一发不许把数字塞进别人的窗里。
      // `currentQuota` 走 `?? null` 而不是 `?? undefined`：那枚键**本来就可以是 null**（无 TeamQuota 行），
      // 换成 undefined 就把「没有额度行」和「服务端没回这一枚键」混成一件事（裁定 D-25 边界 2）。
      setDialog((prev) => (prev && prev.row.id === orderId
        ? { ...prev, preview: payload.preview ?? null, currentQuota: payload.currentQuota ?? null, previewError: null }
        : prev))
    } catch (reason) {
      setDialog((prev) => (prev && prev.row.id === orderId ? { ...prev, preview: null, currentQuota: null, previewError: messageOf(reason, '订单预览读取失败') } : prev))
    }
  }, [])

  const changeFilter = (next: QueueFilter) => {
    if (next === filter) return
    // 详情面板属于上一个筛选那一列的行，换 tab 就收起：留着会把 A 单的详情挂在 B 单下面。
    setExpandedId(null)
    setDetail(null)
    setDetailError(null)
    setNotice(null)
    setFilter(next)
  }

  const toggleDetail = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null)
      setDetail(null)
      setDetailError(null)
      return
    }
    setExpandedId(id)
    setDetail(null)
    void loadDetail(id)
  }

  /**
   * 第一次点击：只把弹窗开出来（POST 在第二次点击）。这里发的那一发是 `GET /api/platform/orders/[id]`
   * —— 只读、可重放、无副作用，因为弹窗那四行数字**只有这一个来源**，凭列表行编不出来。
   *
   * 别把这三条读成「这一发必然成功」：它一样会 401/404/500 或断网。那时弹窗照常开，
   * 窗里给一句「到账预览读取失败，确认按钮已禁用」+ 重试按钮，而 `preview` 留在 `null`
   * ⇒ `OrderConfirmDialog.tsx` 的 `canSubmit`（`:84`）为 false，提交那颗按钮是禁用的
   * ——「数字没到却能提交」这一帧在结构上不存在（裁定 D-23 的兜底就是这一条）。
   */
  const openConfirm = (row: PlatformOrderRow) => {
    setDialog({ row, preview: null, currentQuota: null, previewError: null })
    void loadPreview(row.id)
  }

  /** 关窗之后队列与团队到期日都要重取（Step 3）：到期日只有详情接口的那次实时计算知道。 */
  const reloadAfterDialog = () => {
    void load(filter)
    if (expandedId) void loadDetail(expandedId)
  }

  const closeDialog = () => {
    setDialog(null)
    reloadAfterDialog()
  }

  /** 第二次点击成功之后：关窗、重取队列与详情，并把「这一发真的落地了」留在页面上（200 才是这句话的依据）。 */
  const handleConfirmed = async (row: PlatformOrderRow) => {
    setDialog(null)
    await load(filter)
    if (expandedId === row.id) {
      setExpandedId(null)
      setDetail(null)
    }
    setNotice({ tone: 'ok', text: `已确认 ${row.reference} 到账：团队到期日与额度按上面的预览改掉了。` })
  }

  const requestClose = async (row: PlatformOrderRow) => {
    // 关单理由必填（它会出现在客户的账单页上，spec §8.2）。第一版用 `window.prompt`：单行框、
    // 无校验、超长会被服务端 `billing.ts` 的 `input.reason.trim().slice(0, 200)` **静默截掉** ——
    // 那条理由是客户看得见的审计链，被悄悄改短就是界面在说谎。
    // 现在走共用的 `appPrompt`（`AppDialogProvider.tsx:76`）：`required` 在弹窗内做非空校验（`:134`）、
    // `maxLength=200` 与服务端那一刀**对齐**（`:221` 真的下发到 `<input>`），客户端就拦住，不等服务端截。
    const input = await appPrompt({
      title: '关掉这张订单',
      message: '关单理由会原样出现在客户的账单页上，请写清楚这一单为什么不做了。',
      inputLabel: `关单理由（必填，最多 200 字）：${row.teamName} · ${row.reference}`,
      required: true,
      maxLength: 200,
      confirmLabel: '确认关单',
    })
    // 取消 ⇒ `appPrompt` 给 `null` ⇒ 不发请求（与 `prompt` 那一支同一语义）。
    if (input === null) return
    const reason = input.trim()
    if (!reason) {
      // `required` 已经在弹窗里挡掉空/全空格（回车也不会 resolve），这一支是兜底：
      // 真走到了就是「服务端即将收到一条空理由」，宁可不发。
      setNotice({ tone: 'error', text: '关单必须写理由：客户在账单页看到的就是这一句。' })
      return
    }
    setBusyRowId(row.id)
    try {
      await apiPost(`/api/platform/orders/${row.id}/close`, { reason })
      setNotice({ tone: 'ok', text: `已关掉 ${row.reference}，客户在账单页能看到这句理由。` })
    } catch (reason1) {
      setNotice({ tone: 'error', text: messageOf(reason1, '关单失败，请刷新队列后重试') })
    } finally {
      setBusyRowId(null)
      await load(filter)
      if (expandedId === row.id) void loadDetail(row.id)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">订单队列</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          一期没有支付通道：客户在「套餐与续费」里选好评款、点过「我已完成付款」，单子才落到这里。
          逐笔先在对公网银流水里核对备注码，再点「确认到账」——点下去就是真把那个团队的到期日与额度改掉，且不会自动撤销。
        </p>
      </div>

      <OrderQueue
        filter={filter}
        counts={counts}
        total={total}
        rows={rows}
        loading={loading}
        error={error}
        notice={notice}
        expandedId={expandedId}
        detail={detail && detail.order.id === expandedId ? detail : null}
        detailLoading={detailLoading}
        detailError={detailError}
        busyRowId={busyRowId}
        onFilterChange={changeFilter}
        onRetry={() => void load(filter)}
        onToggleDetail={toggleDetail}
        onRetryDetail={(id) => void loadDetail(id)}
        onOpenConfirm={openConfirm}
        onCloseOrder={(row) => void requestClose(row)}
      />

      {/* 弹窗**常驻挂载**：Radix `Dialog` 要的是受控的 `open`，`row` 为 `null` 时它就是关着的
          （`open={row !== null}`），关窗动画与「焦点归还触发元素」都由这一侧的持续挂载才拿得到。
          窗内的提交状态按 `row.id` 取用，所以换单不会带着上一单的失败文案（见 OrderConfirmDialog 的 `current`）。
          同一张单那一支这里清不到（`closeDialog` 只把 `dialog` 置 `null`）⇒ 靠 `OrderConfirmDialog` 自己
          那枚 `[row?.id]` 的 effect，在重新点开同一单的那一刻把提交槽清掉。 */}
      <OrderConfirmDialog
        row={dialog?.row ?? null}
        preview={dialog?.preview ?? null}
        currentQuota={dialog?.currentQuota ?? null}
        previewError={dialog?.previewError ?? null}
        onClose={closeDialog}
        onRetryPreview={(id) => void loadPreview(id)}
        onConfirmed={(row) => void handleConfirmed(row)}
        onStale={reloadAfterDialog}
      />
    </div>
  )
}
