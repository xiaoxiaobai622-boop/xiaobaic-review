'use client'

/**
 * /platform/messages — 运营端「消息与反馈」：
 * 上半发送平台通知（全员广播或定向单个用户），下半用户反馈收件箱（回复即标记已处理）。
 */

import { useCallback, useEffect, useState } from 'react'
import { MessageSquarePlus, Send, Users } from 'lucide-react'
import { apiFetch, apiPatch, apiPost } from '@/lib/api-client'

interface SentItem {
  id: string
  title: string
  content: string
  createdAt: string
  broadcast: boolean
  targetName: string | null
  readCount: number
}

interface FeedbackItem {
  id: string
  content: string
  status: string
  reply: string | null
  repliedAt: string | null
  createdAt: string
  user: { id: string; name: string | null; contact: string | null }
}

interface UserOption {
  id: string
  name: string | null
  phone: string | null
  email: string | null
}

function timeLabel(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function PlatformMessagesPage() {
  const [sent, setSent] = useState<SentItem[]>([])
  const [feedback, setFeedback] = useState<FeedbackItem[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [target, setTarget] = useState<'ALL' | 'USER'>('ALL')
  const [userId, setUserId] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({})
  const [replyingId, setReplyingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [annRes, fbRes, usersRes] = await Promise.all([
        apiFetch('/api/platform/announcements', { cache: 'no-store' }),
        apiFetch('/api/platform/feedback', { cache: 'no-store' }),
        apiFetch('/api/users', { cache: 'no-store' }),
      ])
      if (annRes.ok) setSent(((await annRes.json())?.items || []) as SentItem[])
      if (fbRes.ok) setFeedback(((await fbRes.json())?.items || []) as FeedbackItem[])
      if (usersRes.ok) setUsers(((await usersRes.json())?.users || []) as UserOption[])
    } catch {
      setError('加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const send = async () => {
    if (!title.trim() || !content.trim()) {
      setNotice({ tone: 'error', text: '标题和内容不能为空' })
      return
    }
    if (target === 'USER' && !userId) {
      setNotice({ tone: 'error', text: '请选择接收用户' })
      return
    }
    setSending(true)
    setNotice(null)
    try {
      const res = await apiPost('/api/platform/announcements', {
        target,
        userId: target === 'USER' ? userId : undefined,
        title: title.trim(),
        content: content.trim(),
      })
      if (res?.item) {
        setNotice({ tone: 'ok', text: target === 'USER' ? '通知已发送给该用户' : '通知已全员广播' })
        setTitle('')
        setContent('')
        await load()
      } else {
        setNotice({ tone: 'error', text: '发送失败，请稍后再试' })
      }
    } catch {
      setNotice({ tone: 'error', text: '发送失败，请检查网络后重试' })
    } finally {
      setSending(false)
    }
  }

  const reply = async (id: string) => {
    const text = (replyDraft[id] || '').trim()
    if (!text) return
    setReplyingId(id)
    try {
      const res = await apiPatch(`/api/platform/feedback/${id}`, { reply: text })
      if (res?.item) {
        setReplyDraft((prev) => ({ ...prev, [id]: '' }))
        await load()
      }
    } finally {
      setReplyingId(null)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">消息与反馈</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">给用户发平台通知，处理用户提交的反馈。</p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive-visible px-3 py-2 text-sm text-destructive">{error}</div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {/* 发送通知 */}
        <section className="rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <MessageSquarePlus className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">发送平台通知</h2>
          </div>
          <div className="flex flex-col gap-3 p-4">
            <div className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-sm text-muted-foreground">接收方</span>
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-foreground">
                <input type="radio" name="msg-target" checked={target === 'ALL'} onChange={() => setTarget('ALL')} className="accent-[hsl(var(--primary))]" />
                全部用户
              </label>
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-foreground">
                <input type="radio" name="msg-target" checked={target === 'USER'} onChange={() => setTarget('USER')} className="accent-[hsl(var(--primary))]" />
                指定用户
              </label>
            </div>
            {target === 'USER' && (
              <div className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-sm text-muted-foreground">用户</span>
                <select
                  value={userId}
                  onChange={(event) => setUserId(event.target.value)}
                  className="h-9 flex-1 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">选择用户…</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name || u.phone || u.email || u.id}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-sm text-muted-foreground">标题</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={60}
                placeholder="通知标题"
                className="h-9 flex-1 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="flex items-start gap-3">
              <span className="w-16 shrink-0 pt-2 text-sm text-muted-foreground">内容</span>
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                maxLength={2000}
                rows={4}
                placeholder="通知正文…"
                className="flex-1 resize-none rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className={`text-xs ${notice?.tone === 'error' ? 'text-destructive' : 'text-primary'}`}>
                {notice ? notice.text : ''}
              </span>
              <button
                type="button"
                onClick={send}
                disabled={sending}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" aria-hidden />
                {sending ? '发送中…' : '发送通知'}
              </button>
            </div>

            {sent.length > 0 && (
              <div className="border-t border-border pt-3">
                <p className="pb-1.5 text-xs font-medium text-muted-foreground">已发送</p>
                <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
                  {sent.map((item) => (
                    <div key={item.id} className="rounded-md bg-muted/50 px-2.5 py-2">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate text-sm font-medium text-foreground">{item.title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{timeLabel(item.createdAt)}</span>
                      </span>
                      <span className="mt-0.5 line-clamp-1 block text-xs text-muted-foreground">{item.content}</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {item.broadcast ? '全员广播' : `发给 ${item.targetName || '指定用户'}`} · {item.readCount} 人已读
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* 用户反馈收件箱 */}
        <section className="rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Users className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">用户反馈</h2>
            <span className="text-xs text-muted-foreground">{feedback.length > 0 ? `${feedback.length} 条` : ''}</span>
          </div>
          <div className="max-h-[560px] overflow-y-auto p-3">
            {feedback.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">还没有用户提交反馈。</p>
            )}
            <div className="flex flex-col gap-2">
              {feedback.map((item) => (
                <div key={item.id} className="rounded-md border border-border px-3 py-2.5">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">
                      {item.user.name || item.user.contact || '用户'}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{timeLabel(item.createdAt)}</span>
                  </span>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">{item.content}</p>
                  {item.reply ? (
                    <div className="mt-2 rounded-md bg-muted px-2.5 py-1.5">
                      <p className="whitespace-pre-wrap text-xs text-foreground">
                        <span className="font-medium">已回复：</span>
                        {item.reply}
                      </p>
                      {item.repliedAt && <p className="mt-0.5 text-[11px] text-muted-foreground">{timeLabel(item.repliedAt)}</p>}
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        value={replyDraft[item.id] || ''}
                        onChange={(event) => setReplyDraft((prev) => ({ ...prev, [item.id]: event.target.value }))}
                        placeholder="回复该用户…"
                        maxLength={2000}
                        className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                        onKeyDown={(event) => { if (event.key === 'Enter') void reply(item.id) }}
                      />
                      <button
                        type="button"
                        onClick={() => void reply(item.id)}
                        disabled={replyingId === item.id || !(replyDraft[item.id] || '').trim()}
                        className="shrink-0 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        回复
                      </button>
                    </div>
                  )}
                  <span
                    className={`mt-1.5 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                      item.status === 'RESOLVED' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {item.status === 'RESOLVED' ? '已处理' : '待处理'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
