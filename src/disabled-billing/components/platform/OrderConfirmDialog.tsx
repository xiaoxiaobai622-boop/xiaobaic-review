'use client'

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { apiPost } from '@/lib/api-client'
import type { PlanQuota } from '@/disabled-billing/lib/billing-pricing'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  ReferenceCode,
  formatAmount,
  formatDay,
  quotaText,
  type OrderPreviewWire,
  type PlatformOrderRow,
} from '@/disabled-billing/components/platform/OrderQueue'

/**
 * 「确认到账」的二次确认框（Task 12 Step 3，spec §8.2）。
 *
 * 这枚按钮是全站唯一会把某个真实团队的 `subscriptionExpiresAt` 前移、并覆盖它额度的入口，
 * 误点代价等同对生产跑一条 UPDATE ⇒ **必须点第二次**：
 * - 第一次点击（队列行上的「确认已到账」）只把这张窗开出来，不 POST；
 * - 只有窗里的「确认到账」这一发才 `POST /api/platform/orders/[id]/confirm`。
 *
 * **外壳是共用的 Radix `Dialog`（`src/components/ui/dialog.tsx`，裁定 D-26）**，不是自己手搓的遮罩。
 * Task 12 第一版按 Step 0 那句「全站没有共用 Modal 组件」写了 `fixed inset-0` + `role="dialog"` +
 * 自接 `Escape` + `onMouseDown` 判 `target === currentTarget`，那句话是错的：Radix 这一套已经在
 * `AppDialogProvider` 与 `/platform/users` 等 12+ 处用着，白给的四件事手写就会漏 ——
 * 焦点收拢、焦点归还触发元素、背景 `inert`、`Escape` 语义。结构照 `src/app/platform/users/page.tsx:566` 起
 * 那一枚（`Dialog` + `DialogContent` + `DialogHeader`/`Title`/`Description` + `DialogFooter`）。
 * 受控模式只有一枚来源：`open={row !== null}`，关窗（`onOpenChange(false)`：Escape / 点遮罩 / `DialogClose`）
 * 一律汇到父组件既有的「关窗并重取」逻辑，组件内不另存一份 open 状态。
 *
 * 数字从哪来：四行内容全部来自 `GET /api/platform/orders/[id]`（`preview` 与同级的 `currentQuota`，
 * 唯一算式来源，与 `fulfillOrder()` 落地用的是同一个函数）。**预览由父组件取好递进来**，本组件不自己发 GET ——
 * 于是它可以被桩数据直接挂载（裁定 D-22 的渲染证明要求的就是这个），也永远不会出现
 * 「数字还没到、按钮已经能点」的那一帧：`preview === null` 时「确认到账」是禁用状态。
 *
 * 记一笔给后面的任务：Radix 的 `DialogContent` 走 `Portal`，**SSR HTML 里没有窗内正文**
 * （`node_modules/@radix-ui/react-portal` 在服务器上取不到 container 就返回 null）。
 * 所以弹窗这一侧的渲染证明必须取「浏览器水合后的 DOM」，`curl` 只够证队列那一侧（Task 12 fix1 F-6）。
 */

type Props = {
  /** 队列行（或详情行）本身：备注码、金额与币种、套餐名都从它取。`null` = 这张窗没开（见 `open`）。 */
  row: PlatformOrderRow | null
  /** `null` = 预览还在读；配合 `previewError` 一起决定「确认到账」能不能点。 */
  preview: OrderPreviewWire | null
  /**
   * 当前额度的四列（裁定 D-25，详情接口与 `preview` 同级回显）。
   * **`null` 是合法值且必须原样传**：它表示这张单所属团队**没有 TeamQuota 行**，
   * 界面对应「当前无额度记录」那一支；把它兜成 `undefined`/`0`/套餐默认就是在替客户编一个不存在的旧值。
   */
  currentQuota: PlanQuota | null
  previewError: string | null
  onClose: () => void
  onRetryPreview: (orderId: string) => void
  /** 200：父组件重取队列与团队到期日，然后关窗。 */
  onConfirmed: (row: PlatformOrderRow) => void
  /** 409/500：队列同样要重取（这张单可能已经不在这个筛选里了），但窗口留着把失败说清楚。 */
  onStale: () => void
}

export function OrderConfirmDialog({ row, preview, currentQuota, previewError, onClose, onRetryPreview, onConfirmed, onStale }: Props) {
  /**
   * 组件常驻挂载（`open` 由 `row` 决定），所以窗内状态必须**按单**取用：
   * 上一张单的失败留在状态里，会把下一张单的「确认到账」莫名禁掉。`current` 只认当前这一单那一份。
   * 清零分两条：**跨单**靠 `submission.rowId` 与 `row.id` 比对（下面的 `current`）各用各的那一格；
   * **同一张单**靠下面那枚 `[row?.id]` 的 effect 在重新点开那一刻把整格清掉 —— 常驻挂载把
   * 「关窗即卸载 ⇒ 状态自然清零」那条路拿掉了（`closeDialog` 只置 `dialog = null`，清不到组件内部这一格），
   * 所以要自己补回来，否则 `canSubmit` 会因为一枚陈旧的 error 永久为 false。
   */
  const [submission, setSubmission] = useState<{ rowId: string; submitting: boolean; error: string | null } | null>(null)
  const current = submission !== null && row !== null && submission.rowId === row.id ? submission : null
  const submitting = current?.submitting ?? false
  const submitError = current?.error ?? null
  useEffect(() => { setSubmission(null) }, [row?.id])

  // 失败之后只留「关窗重看」这一条路：窗口里那份 preview 是打开那一刻的快照，
  // 而这张单可能已经被另一个运营确认过了 —— 让它原地重试等于逼着人再点一次危险的按钮。
  // 窗内**没有**「同一单原地重试」这条路：`onRetryPreview` 只重取 preview，不清提交槽，
  // 所以失败后唯一的出路就是关窗再点（重开同一单时上面那枚 effect 会把这一格清掉）。
  const canSubmit = preview !== null && !previewError && !submitting && submitError === null

  const submit = async () => {
    if (row === null || !canSubmit) return
    const rowId = row.id
    setSubmission({ rowId, submitting: true, error: null })
    try {
      // 唯一的入参就是路径上的 orderId；请求体这里是空的。`confirm` 路由把署名取自会话
      // （`user.id`），所以界面**不**递 `actorUserId` —— 「谁确认的这笔钱」必须是服务端说了算。
      // 200 回显里的 `team` 只有四列（Task 11 评审 m-6 收窄），套餐名一律从行上的 `planName` 取。
      await apiPost(`/api/platform/orders/${rowId}/confirm`, {})
      onConfirmed(row)
    } catch (reason) {
      // 409 的「该订单已被处理」与 500 的「确认到账失败，请刷新队列后重试」都是路由给的中文原话，
      // 界面上不改写：改写就把服务端对「到底落没落地」的判断换成了猜。
      setSubmission({
        rowId,
        submitting: false,
        error: reason instanceof Error && reason.message ? reason.message : '确认到账失败，请刷新队列后重试',
      })
      onStale()
    } finally {
      // 只收「正在提交」这一半；失败文案要留在窗里（上面那一支已经写进去了，别在这里抹掉）。
      setSubmission((prev) => (prev && prev.rowId === rowId && prev.submitting ? { ...prev, submitting: false } : prev))
    }
  }

  return (
    <Dialog open={row !== null} onOpenChange={(next) => { if (!next) onClose() }}>
      {row && (
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>确认这笔转账已到账</DialogTitle>
            <DialogDescription>
              {row.teamName} · {row.planName} × {row.periods}
            </DialogDescription>
          </DialogHeader>

          {/* 预览数字是异步填进来的（开窗那一刻 `preview` 还是 null）⇒ 这一整块要 aria-live，
              否则读屏用户看不到后来出现的那四行后果。 */}
          <div className="space-y-2 text-sm" aria-live="polite">
            {preview === null && !previewError && (
              <p aria-busy="true" className="text-muted-foreground">正在读取到账预览（到期日与额度变化）...</p>
            )}
            {previewError && (
              <div role="alert" className="space-y-2">
                <p className="font-medium text-destructive">到账预览读取失败，确认按钮已禁用</p>
                <p className="text-muted-foreground">{previewError}</p>
                <button
                  type="button"
                  onClick={() => onRetryPreview(row.id)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm"
                >
                  <RefreshCw className="h-4 w-4" />
                  重试预览
                </button>
              </div>
            )}
            {preview && (
              <>
                {/* 两半类型不一样：`fromExpiry` 是毫秒数、`toExpiryDate` 是 JSON 后的 ISO 串，
                    两边都过同一枚 `formatDay()`（Step 3 点名的坑：直接把 `fromExpiry` 插进 JSX 会显示一串 13 位数字）。 */}
                <p className="tabular-nums">
                  到期日 {formatDay(preview.fromExpiry)} → {formatDay(preview.toExpiryDate)}
                </p>
                {/* 裁定 D-25：这一行现在是真的「旧 → 新」。「旧」来自详情接口同级的 `currentQuota`
                    （`[id]/route.ts` 回显库里那一行 TeamQuota），不再由界面猜。三支分支：
                    1) `currentQuota === null` = 这张单所属团队**没有额度行** ⇒ 说「当前无额度记录」，
                       绝不把 null 渲染成 0 或套餐默认（台账 #57 那一族）；
                    2) `quotaChanged === false` ⇒ 旧值就等于新值，保留「不变（X）」的写法；
                    3) 其余 ⇒ 旧四列 → 新四列，四列口径沿用 `quotaText()`。 */}
                <p className="text-muted-foreground">
                  额度 {currentQuota === null
                    ? `当前无额度记录 → 将设为 ${quotaText(preview.nextQuota)}`
                    : preview.quotaChanged
                      ? `${quotaText(currentQuota)} → ${quotaText(preview.nextQuota)}`
                      : `不变（${quotaText(preview.nextQuota)}`}
                </p>
                {preview.willResetManual && (
                  <p className="text-destructive">当前额度是手动调整的，将被本套餐重置</p>
                )}
              </>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3">
              <span className="inline-flex items-center gap-2 text-sm">
                <span className="text-xs text-muted-foreground">备注码</span>
                <ReferenceCode value={row.reference} />
              </span>
              <span className="inline-flex items-center gap-2 text-sm">
                <span className="text-xs text-muted-foreground">金额</span>
                <span className="font-medium tabular-nums">{formatAmount(row.amountCents, row.currency)}</span>
                {row.currency !== 'CNY' && <span className="text-xs text-muted-foreground">{row.currency}</span>}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">请先在网银流水里核对这笔到账</p>

            {submitError && (
              <p role="alert" className="text-sm font-medium text-destructive">{submitError}</p>
            )}
          </div>

          <DialogFooter>
            {/* 点遮罩关窗与 Escape 都由 Radix 的 `Dialog` 给（第一版手搓遮罩时是三处手写代码），
                「取消」这颗走 `DialogClose`，走的就是同一条 `onOpenChange(false)` ⇒ 父组件那边
                只有「关窗并重取队列与详情」一个出口。 */}
            <DialogClose asChild>
              <button
                type="button"
                className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm text-muted-foreground hover:text-foreground"
              >
                取消
              </button>
            </DialogClose>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canSubmit}
              className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {submitting ? '正在确认...' : '确认到账'}
            </button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}
