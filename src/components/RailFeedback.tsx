'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { apiFetch } from '@/lib/api-client'

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

/** 侧栏底部：向平台提交反馈 + 查看历史与回复。 */
export default function RailFeedback({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const [content, setContent] = useState('')
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
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

  useEffect(() => {
    if (!open) return
    load()
    const handleMouseDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close()
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [open, load])

  const close = () => {
    setOpen(false)
    setError('')
    triggerRef.current?.focus()
  }

  const submit = async () => {
    const trimmed = content.trim()
    if (!trimmed) { setError('反馈内容不能为空'); return }
    setSubmitting(true)
    setError('')
    try {
      const response = await apiFetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: trimmed }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error || '提交失败，请稍后再试')
        return
      }
      setContent('')
      setDone(true)
      window.setTimeout(() => setDone(false), 2500)
      await load()
    } catch {
      setError('提交失败，请检查网络后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label="提交反馈"
        title="提交反馈"
        className={cn(
          className,
          open ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-accent-foreground',
        )}
      >
        <BulbIcon className="h-[20px] w-[20px]" />
      </button>

      {open && (
        <div className="absolute left-full bottom-0 z-50 ml-2 w-96 overflow-hidden rounded-lg border border-border bg-card shadow-elevation-lg">
          <div className="border-b border-border px-3 py-2">
            <p className="text-sm font-medium text-foreground">提交反馈</p>
            <p className="mt-0.5 text-xs text-muted-foreground">产品和平台服务的意见建议，直接发给运营团队。</p>
          </div>

          <div className="p-3">
            <textarea
              value={content}
              onChange={(event) => { setContent(event.target.value); setError('') }}
              placeholder="写下你想对平台说的话…"
              rows={3}
              maxLength={2000}
              className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {error ? <span className="text-destructive">{error}</span> : done ? <span className="text-primary">已提交，感谢你的反馈</span> : (
                  <>提交即代表同意
                    <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="mx-0.5 underline hover:no-underline">《隐私政策》</Link>
                  </>
                )}
              </span>
              <button
                type="button"
                onClick={submit}
                disabled={submitting || !content.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" aria-hidden />
                {submitting ? '提交中…' : '提交反馈'}
              </button>
            </div>
          </div>

          {items.length > 0 && (
            <div className="border-t border-border">
              <p className="px-3 pt-2 text-xs font-medium text-muted-foreground">我的反馈</p>
              <div className="max-h-56 overflow-y-auto p-2">
                {items.map((item) => (
                  <div key={item.id} className="rounded-md px-2 py-2 text-left">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm text-foreground">{item.content}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(item.createdAt)}</span>
                    </span>
                    <span className="mt-1 flex items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                          item.status === 'RESOLVED' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {item.status === 'RESOLVED' ? '已回复' : '处理中'}
                      </span>
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
        </div>
      )}
    </div>
  )
}
