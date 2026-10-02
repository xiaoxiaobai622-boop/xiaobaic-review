'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { MessageSquarePlus, Send } from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api-client'

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
          open ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        )}
      >
        <MessageSquarePlus className="h-[20px] w-[20px]" aria-hidden="true" />
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
                {error ? <span className="text-destructive">{error}</span> : done ? <span className="text-primary">已提交，感谢你的反馈</span> : `${content.length}/2000`}
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
