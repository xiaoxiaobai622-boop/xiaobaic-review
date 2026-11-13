'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type FeedbackKind = 'success' | 'error'
export type FeedbackMessage = { kind: FeedbackKind; text: string; seq: number }

/**
 * 操作反馈就近显示：每个动作区一枚独立的反馈位，show() 永远替换上一条并重置计时，
 * 所以同一动作连点不会叠出两条。成功 4 秒、错误 5 秒自动消失；带链接的结果不走这里，
 * 用常驻结果块（复制到剪贴板或手动关闭前一直可见）。
 */
export function useActionFeedback(autoDismissMs?: number) {
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null)
  const timer = useRef<number | null>(null)
  const seq = useRef(0)

  const clear = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    setFeedback(null)
  }, [])

  const show = useCallback((kind: FeedbackKind, text: string) => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    seq.current += 1
    setFeedback({ kind, text, seq: seq.current })
    const ms = autoDismissMs ?? (kind === 'error' ? 5000 : 4000)
    timer.current = window.setTimeout(() => {
      timer.current = null
      setFeedback(null)
    }, ms)
  }, [autoDismissMs])

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])

  return { feedback, show, clear }
}

export function ActionFeedback({ feedback, onDismiss, className }: {
  feedback: FeedbackMessage | null
  onDismiss?: () => void
  className?: string
}) {
  if (!feedback) return null
  const isError = feedback.kind === 'error'
  return (
    <div
      key={feedback.seq}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      className={cn(
        'flex items-start gap-1.5 rounded-md px-2.5 py-1.5 text-xs leading-5',
        isError ? 'bg-destructive-visible text-destructive' : 'bg-success-visible text-success',
        className,
      )}
    >
      {isError ? <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> : <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
      <span className="min-w-0 flex-1 break-words">{feedback.text}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="关闭提示" className="shrink-0 rounded p-0.5 opacity-70 transition-opacity hover:opacity-100">
          <X className="h-3 w-3" aria-hidden />
        </button>
      )}
    </div>
  )
}

/**
 * 常驻反馈位：空闲时也占一行高度，提示出现/消失不推挤周围按钮与卡片。
 * 动作行下方放一枚，反馈永远贴着它所属的动作。
 */
export function FeedbackSlot({ feedback, onDismiss, className }: {
  feedback: FeedbackMessage | null
  onDismiss?: () => void
  className?: string
}) {
  return (
    <div className={cn('min-h-[26px]', className)} aria-atomic="true">
      <ActionFeedback feedback={feedback} onDismiss={onDismiss} />
    </div>
  )
}
