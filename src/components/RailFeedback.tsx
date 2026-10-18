'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { apiFetch } from '@/lib/api-client'
import { FEEDBACK_CATEGORIES } from '@/lib/feedback-categories'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

// 1:1 抄自 frame.io 侧栏「提交反馈」的灯泡图标（fill=currentColor，24 viewBox）。
function BulbIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true" focusable="false">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M15.971 15.185c0-.424.336-.83.762-1.345.745-.9 1.767-2.135 1.767-4.384C18.5 5.53 15.234 3 12 3S5.5 5.506 5.5 9.456c0 2.254 1.023 3.488 1.767 4.387.427.514.762.919.762 1.342 0 .45.365.815.816.815h6.31c.45 0 .816-.365.816-.815ZM12.5 5a1 1 0 1 0 0 2c.425 0 .933.223 1.355.645.422.422.645.93.645 1.355a1 1 0 1 0 2 0c0-1.075-.527-2.067-1.23-2.77C14.567 5.529 13.575 5 12.5 5Z"
        fill="currentColor"
      />
      <path d="M14.995 17.998a2.998 2.998 0 0 1-5.995 0h5.995Z" fill="currentColor" />
    </svg>
  )
}

interface FeedbackItem {
  id: string
  content: string
  category: string | null
  status: string
  reply: string | null
  repliedAt: string | null
  createdAt: string
}

const MAX_CONTENT = 2000

function relativeTime(value: string): string {
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return new Date(value).toLocaleDateString('zh-CN')
}

/** 侧栏底部：向平台提交反馈 + 查看历史与回复。对标那枚是居中弹窗，不是贴在栏边的小卡。 */
export default function RailFeedback({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const load = useCallback(async () => {
    try {
      const response = await apiFetch('/api/feedback', { cache: 'no-store' })
      if (!response.ok) return
      const data = await response.json()
      setItems((data.items || []) as FeedbackItem[])
    } catch {
      // 历史拉不到不影响提交
    }
  }, [])

  const close = () => {
    setOpen(false)
    setError('')
    triggerRef.current?.focus()
  }

  useEffect(() => { if (open) load() }, [open, load])

  const submit = async () => {
    const trimmed = content.trim()
    if (!trimmed) { setError('反馈内容不能为空'); return }
    setSubmitting(true)
    setError('')
    try {
      const response = await apiFetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: trimmed, category }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error || '提交失败，请稍后再试')
        return
      }
      setContent('')
      setCategory(null)
      setDone(true)
      window.setTimeout(() => setDone(false), 2500)
      await load()
    } catch {
      setError('提交失败，请检查网络后重试')
    } finally {
      setSubmitting(false)
    }
  }

  const hint = FEEDBACK_CATEGORIES.find((row) => row.key === category)?.hint || '写下你想对平台说的话…'

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label="提交反馈"
        title="提交反馈"
        className={cn(className, 'text-muted-foreground hover:text-accent-foreground')}
      >
        <BulbIcon className="h-[20px] w-[20px]" />
      </button>

      <Dialog open={open} onOpenChange={(next) => { if (!next) close() }}>
        <DialogContent aria-label="提交反馈" className="w-[calc(100%-2rem)] max-w-[560px] !rounded-lg"
          onOpenAutoFocus={(event) => {
            // Radix 默认会把焦点停在第一枚可聚焦元素上，也就是「功能建议」那颗胶囊；对标是把光标放进正文，
            // 打开就能打字。焦点归还给触发按钮由 onCloseAutoFocus 管（壳子里已接好）。
            event.preventDefault()
            window.setTimeout(() => document.getElementById('rail-feedback-content')?.focus(), 0)
          }}
        >
          <DialogHeader>
            <DialogTitle>提交反馈</DialogTitle>
            <DialogDescription>请提出您的意见。</DialogDescription>
          </DialogHeader>

          <div data-feedback-categories className="flex flex-wrap gap-1.5">
            {FEEDBACK_CATEGORIES.map((row) => (
              <button
                key={row.key}
                type="button"
                onClick={() => setCategory((current) => (current === row.key ? null : row.key))}
                aria-pressed={category === row.key}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs transition-colors',
                  category === row.key
                    ? 'border-primary bg-primary-visible text-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {row.key}
              </button>
            ))}
          </div>

          <div>
            <label htmlFor="rail-feedback-content" className="text-xs font-medium text-foreground">
              添加细节（必填）
            </label>
            <textarea
              id="rail-feedback-content"
              value={content}
              onChange={(event) => { setContent(event.target.value); setError('') }}
              placeholder={hint}
              rows={6}
              maxLength={MAX_CONTENT}
              className="mt-1 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {error
                ? <span className="text-destructive">{error}</span>
                : done
                  ? <span className="text-primary">已提交，感谢你的反馈</span>
                  : <>提交即代表同意
                    <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="mx-0.5 underline hover:no-underline">《隐私政策》</Link>
                    {category ? `；类型记为「${category}」。` : '；选一枚类型标签能让运营更快定位。'}
                  </>}
            </p>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={close}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              取消
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={submitting || !content.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-4 w-4" aria-hidden />
              {submitting ? '提交中…' : '提交'}
            </button>
          </div>

          {items.length > 0 && (
            <div className="border-t border-border pt-3">
              <p className="text-xs font-medium text-muted-foreground">我的反馈</p>
              <div className="mt-1 max-h-56 overflow-y-auto">
                {items.map((item) => (
                  <div key={item.id} data-feedback-row className="border-b border-border/60 px-1 py-2 last:border-b-0">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm text-foreground">{item.content}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(item.createdAt)}</span>
                    </span>
                    {item.category && (
                      <span className="mt-1 mr-1.5 inline-flex items-center rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{item.category}</span>
                    )}
                    <span className="mt-1 inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {item.status === 'RESOLVED' ? '已回复' : '处理中'}
                    </span>
                    {item.reply && (
                      <span className="mt-1.5 block rounded-md bg-muted px-2 py-1.5 text-xs text-foreground">
                        <span className="font-medium">运营回复：</span>
                        {item.reply}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
