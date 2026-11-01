'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, Loader2, MessageSquare, RefreshCw, Search, Send, StickyNote, Wifi, WifiOff } from 'lucide-react'
import { apiFetch, apiPatch, apiPost } from '@/lib/api-client'
import { getDeviceAuthHeaders } from '@/lib/device-id'
import { PlatformPushSetup } from '@/components/support/PlatformPushSetup'
import { PlatformSupportSettings } from '@/components/support/PlatformSupportSettings'
import {
  getPlatformAccessToken,
  getPlatformRefreshToken,
  isPlatformPwaMode,
  setPlatformPwaAccessToken,
  setPlatformTokens,
} from '@/lib/platform-token-store'

type Status = 'OPEN' | 'PENDING' | 'CLOSED'

type Conversation = {
  id: string
  publicId: string
  status: Status
  lastMessageAt: string
  lastMessagePreview: string | null
  unreadForVisitor: number
  unreadForAgent?: number
  createdAt: string
  closedAt: string | null
  csatScore: number | null
  csatAt: string | null
  visitor?: {
    id: string
    name: string | null
    email: string | null
    userId: string | null
    locale: string
    lastSeenAt: string
  }
  userId?: string | null
  teamId?: string | null
  projectId?: string | null
  source?: string
  pagePath?: string | null
  locale?: string
  tags?: string[]
  firstVisitorMessageAt?: string | null
  firstAgentReplyAt?: string | null
  reopenCount?: number
  assigneeId?: string | null
}

type Message = {
  id: string
  seq: number
  senderType: 'VISITOR' | 'AGENT' | 'SYSTEM'
  body: string
  visibility?: 'PUBLIC' | 'INTERNAL'
  kind: string
  createdAt: string
  clientId: string | null
  localStatus?: 'sending' | 'failed'
}

type AdminOutboxItem = { conversationId: string; clientId: string; body: string; visibility: 'PUBLIC' | 'INTERNAL'; createdAt: string }
const ADMIN_OUTBOX = 'vidx_support_admin_outbox_v1'

function readAdminOutbox(): AdminOutboxItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(ADMIN_OUTBOX) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAdminOutbox(items: AdminOutboxItem[]) {
  try {
    if (items.length) localStorage.setItem(ADMIN_OUTBOX, JSON.stringify(items))
    else localStorage.removeItem(ADMIN_OUTBOX)
  } catch {}
}

function queueAdminMessage(item: AdminOutboxItem) {
  writeAdminOutbox([...readAdminOutbox().filter((entry) => entry.clientId !== item.clientId), item])
}

function removeAdminMessage(clientId: string) {
  writeAdminOutbox(readAdminOutbox().filter((entry) => entry.clientId !== clientId))
}

type CannedResponse = { id: string; title: string; body: string; locale: string; shortcut: string | null }

type Metrics = {
  volume: number
  unanswered: number
  firstResponseSeconds: { median: number | null; answered: number }
  resolutionSeconds: { median: number | null; resolved: number }
  csat: { average: number | null; responses: number }
  notification?: { status: string; error: string | null; at: string } | null
}

function formatDuration(seconds: number | null) {
  if (seconds == null) return '—'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  return `${(seconds / 3600).toFixed(1)}h`
}

const ADMIN_LIST_CACHE = 'vidx_support_admin_list_v1'
const ADMIN_DETAIL_CACHE_PREFIX = 'vidx_support_admin_detail_v1_'
const ADMIN_CACHE_TTL = 24 * 60 * 60 * 1000

function readAdminCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.at !== 'number' || Date.now() - parsed.at > ADMIN_CACHE_TTL) return null
    return parsed.value as T
  } catch {
    return null
  }
}

function writeAdminCache(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), value }))
  } catch {}
}

const STATUS_LABEL: Record<Status, string> = { OPEN: '进行中', PENDING: '待回复', CLOSED: '已关闭' }
const STATUS_TONE: Record<Status, string> = {
  OPEN: 'bg-primary-visible text-primary',
  PENDING: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  CLOSED: 'bg-muted text-muted-foreground',
}

function formatTime(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function refreshPlatformAccess() {
  if (isPlatformPwaMode()) {
    const response = await fetch('/api/platform/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...getDeviceAuthHeaders() },
    })
    if (!response.ok) return false
    const data = await response.json().catch(() => null)
    if (!data?.tokens?.accessToken) return false
    setPlatformPwaAccessToken(data.tokens.accessToken)
    return true
  }
  const refreshToken = getPlatformRefreshToken()
  if (!refreshToken) return false
  const response = await fetch('/api/platform/auth/refresh', {
    method: 'POST',
    headers: { Authorization: `Bearer ${refreshToken}`, ...getDeviceAuthHeaders() },
  })
  if (!response.ok) return false
  const data = await response.json().catch(() => null)
  if (!data?.tokens?.accessToken || !data?.tokens?.refreshToken) return false
  setPlatformTokens(data.tokens)
  return true
}

async function openPlatformStream(path: string, signal: AbortSignal) {
  const fire = () => fetch(path, {
    headers: { Authorization: `Bearer ${getPlatformAccessToken() || ''}`, Accept: 'text/event-stream', ...getDeviceAuthHeaders() },
    signal,
    cache: 'no-store',
  })

  let response = await fire()
  if (response.status === 401 && (await refreshPlatformAccess())) response = await fire()
  return response
}

async function consumeSSE(response: Response, onEvent: (event: string, data: any) => void) {
  if (!response.body) throw new Error('No stream body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) return
    buffer += decoder.decode(value, { stream: true })
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      let event = 'message'
      const dataLines: string[] = []
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
      }
      if (dataLines.length) {
        try {
          onEvent(event, JSON.parse(dataLines.join('\n')))
        } catch {
          // Ignore a malformed event and keep the stream alive.
        }
      }
      boundary = buffer.indexOf('\n\n')
    }
  }
}

export default function SupportInboxClient({ initialConversationId }: { initialConversationId?: string } = {}) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(initialConversationId ?? null)
  const [detail, setDetail] = useState<{ conversation: Conversation; messages: Message[] } | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [statusFilter, setStatusFilter] = useState<'ALL' | Status>('ALL')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [query, setQuery] = useState('')
  const [loadingList, setLoadingList] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [streamState, setStreamState] = useState<'connecting' | 'open' | 'offline'>('connecting')
  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState('')
  const [noteMode, setNoteMode] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [canned, setCanned] = useState<CannedResponse[]>([])
  const [cannedId, setCannedId] = useState('')
  const [tagsDraft, setTagsDraft] = useState('')
  const [pwaHint, setPwaHint] = useState(false)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const typingTimer = useRef<number | null>(null)
  const lastTypingSent = useRef(0)
  const messageEndRef = useRef<HTMLDivElement | null>(null)

  const selected = useMemo(
    () => conversations.find((item) => item.id === selectedId) ?? detail?.conversation ?? null,
    [conversations, selectedId, detail],
  )

  const loadList = useCallback(async () => {
    setLoadingList(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (statusFilter !== 'ALL') params.set('status', statusFilter)
      if (unreadOnly) params.set('unread', '1')
      if (query.trim()) params.set('q', query.trim())
      const response = await apiFetch(`/api/platform/support/conversations?${params.toString()}`, { cache: 'no-store' })
      if (!response.ok) throw new Error('收件箱读取失败')
      const data = await response.json()
      const items = Array.isArray(data.items) ? data.items : []
      setConversations(items)
      writeAdminCache(ADMIN_LIST_CACHE, items.slice(0, 20))
    } catch (cause) {
      const cached = readAdminCache<Conversation[]>(ADMIN_LIST_CACHE)
      if (cached) {
        setConversations(cached)
        setError('离线：显示缓存列表')
      } else {
        setError(cause instanceof Error ? cause.message : '收件箱读取失败')
      }
    } finally {
      setLoadingList(false)
    }
  }, [query, statusFilter, unreadOnly])

  useEffect(() => { loadList() }, [loadList])

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent)
    setPwaHint(ios && !standalone)
  }, [])

  useEffect(() => {
    const badgeNavigator = navigator as Navigator & {
      setAppBadge?: (count: number) => Promise<void>
      clearAppBadge?: () => Promise<void>
    }
    const unread = conversations.reduce((sum, item) => sum + (item.unreadForAgent || 0), 0)
    if (unread > 0) void badgeNavigator.setAppBadge?.(unread).catch(() => {})
    else void badgeNavigator.clearAppBadge?.().catch(() => {})
  }, [conversations])

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    let attempt = 0
    ;(async () => {
      while (!cancelled) {
        try {
          const response = await openPlatformStream('/api/platform/support/stream', controller.signal)
          if (!response.ok) throw new Error(`inbox stream ${response.status}`)
          setStreamState('open')
          attempt = 0
          await consumeSSE(response, () => { void loadList() })
        } catch (cause) {
          if (controller.signal.aborted) return
          setStreamState('offline')
        }
        if (cancelled) return
        await sleep(Math.min(1000 * 2 ** attempt, 20_000) + Math.floor(Math.random() * 400))
        attempt += 1
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [loadList])

  const markRead = useCallback(async (conversationId: string, seq: number) => {
    if (!seq) return
    await apiPost(`/api/platform/support/conversations/${conversationId}/read`, { seq }).catch(() => {})
    setConversations((prev) => prev.map((item) => (item.id === conversationId ? { ...item, unreadForAgent: 0 } : item)))
  }, [])

  const loadDetail = useCallback(async (conversationId: string) => {
    setLoadingDetail(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/platform/support/conversations/${conversationId}`, { cache: 'no-store' })
      if (!response.ok) throw new Error('会话读取失败')
      const data = await response.json()
      const nextMessages = Array.isArray(data.messages) ? data.messages : []
      const queued = readAdminOutbox()
        .filter((item) => item.conversationId === conversationId)
        .map((item) => ({
          id: `local-${item.clientId}`,
          seq: 0,
          senderType: 'AGENT' as const,
          body: item.body,
          visibility: item.visibility,
          kind: 'TEXT',
          createdAt: item.createdAt,
          clientId: item.clientId,
          localStatus: 'failed' as const,
        }))
      setDetail({ conversation: data.conversation, messages: [...nextMessages, ...queued] })
      setMessages([...nextMessages, ...queued])
      setTagsDraft((data.conversation?.tags || []).join(', '))
      writeAdminCache(`${ADMIN_DETAIL_CACHE_PREFIX}${conversationId}`, { conversation: data.conversation, messages: nextMessages.slice(-50) })
      const lastSeq = nextMessages.at(-1)?.seq ?? 0
      if (document.visibilityState === 'visible') void markRead(conversationId, lastSeq)
    } catch (cause) {
      const cached = readAdminCache<{ conversation: Conversation; messages: Message[] }>(`${ADMIN_DETAIL_CACHE_PREFIX}${conversationId}`)
      if (cached) {
        setDetail(cached)
        setMessages(cached.messages)
        setTagsDraft((cached.conversation?.tags || []).join(', '))
        setError('离线：显示缓存会话')
      } else {
        setError(cause instanceof Error ? cause.message : '会话读取失败')
      }
    } finally {
      setLoadingDetail(false)
    }
  }, [markRead])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      setMessages([])
      return
    }
    void loadDetail(selectedId)
    const controller = new AbortController()
    let cancelled = false
    let attempt = 0
    let lastSeq = 0
    const timer = window.setTimeout(async () => {
      while (!cancelled) {
        try {
          const response = await openPlatformStream(
            `/api/platform/support/conversations/${selectedId}/stream?afterSeq=${lastSeq}`,
            controller.signal,
          )
          if (!response.ok) throw new Error(`conversation stream ${response.status}`)
          setStreamState('open')
          attempt = 0
          await consumeSSE(response, (event, data) => {
            if (data?.conversationId && data.conversationId !== selectedId) return
            if (event === 'message.created' && data.message) {
              const incoming = data.message as Message
              lastSeq = Math.max(lastSeq, incoming.seq)
              setMessages((prev) => {
                if (prev.some((item) => item.id === incoming.id || item.seq === incoming.seq)) return prev
                return [...prev, incoming].sort((a, b) => a.seq - b.seq)
              })
              setDetail((prev) => prev ? {
                ...prev,
                conversation: {
                  ...prev.conversation,
                  lastMessageAt: incoming.createdAt,
                  lastMessagePreview: incoming.visibility === 'INTERNAL' ? prev.conversation.lastMessagePreview : incoming.body,
                },
              } : prev)
              setConversations((prev) => prev.map((item) => item.id === selectedId ? {
                ...item,
                lastMessageAt: incoming.createdAt,
                lastMessagePreview: incoming.visibility === 'INTERNAL' ? item.lastMessagePreview : incoming.body,
                unreadForAgent: incoming.senderType === 'VISITOR' && document.visibilityState !== 'visible' ? (item.unreadForAgent || 0) + 1 : item.unreadForAgent,
              } : item))
              if (incoming.senderType !== 'AGENT' && document.visibilityState === 'visible') {
                void markRead(selectedId, incoming.seq)
              }
              if (incoming.senderType === 'AGENT') setTyping(false)
            } else if (event === 'typing' && data.senderType === 'VISITOR') {
              setTyping(true)
              if (typingTimer.current) window.clearTimeout(typingTimer.current)
              typingTimer.current = window.setTimeout(() => setTyping(false), 4500)
            } else if (event === 'conversation.updated') {
              setDetail((prev) => prev ? { ...prev, conversation: { ...prev.conversation, status: data.status || prev.conversation.status } } : prev)
              void loadList()
            }
          })
        } catch {
          if (controller.signal.aborted) return
          setStreamState('offline')
        }
        if (cancelled) return
        await sleep(Math.min(1000 * 2 ** attempt, 20_000) + Math.floor(Math.random() * 400))
        attempt += 1
      }
    }, 80)

    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timer)
      if (typingTimer.current) window.clearTimeout(typingTimer.current)
    }
  }, [loadDetail, loadList, markRead, selectedId])

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  const loadCanned = useCallback(async () => {
    const response = await apiFetch('/api/platform/support/canned-responses?locale=zh', { cache: 'no-store' }).catch(() => null)
    if (!response?.ok) return
    const data = await response.json().catch(() => null)
    setCanned(Array.isArray(data?.items) ? data.items : [])
  }, [])

  useEffect(() => { void loadCanned() }, [loadCanned])

  useEffect(() => {
    apiFetch('/api/platform/support/metrics', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => setMetrics(data))
      .catch(() => {})
  }, [])

  const createCanned = async () => {
    const title = window.prompt('常用语标题')
    if (!title?.trim()) return
    const body = window.prompt('常用语内容')
    if (!body?.trim()) return
    try {
      await apiPost('/api/platform/support/canned-responses', { title: title.trim(), body: body.trim(), locale: 'zh' })
      await loadCanned()
    } catch {
      setError('创建常用语失败')
    }
  }

  const markUnread = async () => {
    if (!selectedId) return
    await apiPost(`/api/platform/support/conversations/${selectedId}/unread`, {}).catch(() => {})
    setConversations((prev) => prev.map((item) => item.id === selectedId ? { ...item, unreadForAgent: Math.max(1, item.unreadForAgent || 0) } : item))
    setDetail((prev) => prev ? { ...prev, conversation: { ...prev.conversation, unreadForAgent: Math.max(1, prev.conversation.unreadForAgent || 0) } } : prev)
  }

  const postAdminMessage = useCallback(async (conversationId: string, clientId: string, body: string, visibility: 'PUBLIC' | 'INTERNAL') => {
    setMessages((prev) => prev.some((item) => item.clientId === clientId) ? prev : [...prev, {
      id: `local-${clientId}`,
      seq: 0,
      senderType: 'AGENT',
      body,
      visibility,
      kind: 'TEXT',
      createdAt: new Date().toISOString(),
      clientId,
      localStatus: 'sending',
    }])
    queueAdminMessage({ conversationId, clientId, body, visibility, createdAt: new Date().toISOString() })
    try {
      const response = await apiPost(`/api/platform/support/conversations/${conversationId}/messages`, {
        body,
        clientId,
        visibility,
      })
      if (!response?.message) throw new Error('发送失败')
      removeAdminMessage(clientId)
      setMessages((prev) => {
        const rest = prev.filter((item) => item.clientId !== clientId && item.seq !== response.message.seq)
        const serverMessages = rest.filter((item) => item.seq > 0)
        const local = rest.filter((item) => item.seq <= 0)
        serverMessages.push(response.message)
        serverMessages.sort((a, b) => a.seq - b.seq)
        return [...serverMessages, ...local]
      })
      if (response.conversation) setDetail((prev) => prev ? { ...prev, conversation: response.conversation } : prev)
      await loadList()
      return true
    } catch (cause) {
      setMessages((prev) => prev.map((item) => item.clientId === clientId ? { ...item, localStatus: 'failed' } : item))
      setError(cause instanceof Error ? cause.message : '发送失败，已存入待发队列')
      return false
    }
  }, [loadList])

  const send = async () => {
    const body = draft.trim()
    if (!body || !selectedId || sending) return
    setSending(true)
    setError(null)
    const clientId = crypto.randomUUID()
    const visibility = noteMode ? 'INTERNAL' : 'PUBLIC'
    setDraft('')
    await postAdminMessage(selectedId, clientId, body, visibility)
    setSending(false)
  }

  const retryQueued = async (message: Message) => {
    if (!message.clientId || !selectedId) return
    await postAdminMessage(selectedId, message.clientId, message.body, message.visibility === 'INTERNAL' ? 'INTERNAL' : 'PUBLIC')
  }

  useEffect(() => {
    const flush = () => {
      if (!selectedId) return
      const pending = readAdminOutbox().filter((item) => item.conversationId === selectedId)
      for (const item of pending) {
        void postAdminMessage(selectedId, item.clientId, item.body, item.visibility)
      }
    }
    window.addEventListener('online', flush)
    return () => window.removeEventListener('online', flush)
  }, [postAdminMessage, selectedId])

  const notifyTyping = () => {
    if (!selectedId) return
    const now = Date.now()
    if (now - lastTypingSent.current < 2500) return
    lastTypingSent.current = now
    void apiPost(`/api/platform/support/conversations/${selectedId}/typing`, {}).catch(() => {})
  }

  const updateConversation = async (patch: Record<string, unknown>) => {
    if (!selectedId) return
    try {
      const response = await apiPatch(`/api/platform/support/conversations/${selectedId}`, patch)
      if (response?.conversation) {
        setDetail((prev) => prev ? { ...prev, conversation: response.conversation } : prev)
        await loadList()
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败')
    }
  }

  const applyTags = () => {
    const tags = tagsDraft.split(',').map((tag) => tag.trim()).filter(Boolean)
    void updateConversation({ tags })
  }

  const insertCanned = (id: string) => {
    const item = canned.find((entry) => entry.id === id)
    if (!item) return
    setCannedId(id)
    setDraft((prev) => prev ? `${prev}\n${item.body}` : item.body)
  }

  return (
    <div className="flex h-[calc(100dvh-var(--admin-header-height)-3.5rem)] min-h-[520px] min-w-0 gap-2">
      <section className={`min-w-0 flex-1 flex-col rounded-[8px] border border-border bg-popover ${selectedId ? 'hidden lg:flex' : 'flex'} lg:max-w-[420px]`}>
        <div className="border-b border-border p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h1 className="text-base font-semibold">客服收件箱</h1>
              <p className="mt-1 text-xs text-muted-foreground">单人收件箱 · 新消息实时到达</p>
            </div>
            <div className="flex items-center gap-1">
              {streamState === 'open' ? <Wifi className="h-4 w-4 text-emerald-600" aria-label="实时已连接" /> : <WifiOff className="h-4 w-4 text-muted-foreground" aria-label="实时未连接" />}
              <button type="button" onClick={() => void loadList()} className="rounded-md p-2 hover:bg-accent" aria-label="刷新列表">
                <RefreshCw className={`h-4 w-4 ${loadingList ? 'animate-spin' : ''}`} />
              </button>
              <PlatformPushSetup />
              <button
                type="button"
                onClick={async () => {
                  try {
                    const response = await apiFetch('/api/platform/support/export', { cache: 'no-store' })
                    if (!response.ok) throw new Error('导出失败')
                    const blob = await response.blob()
                    const url = URL.createObjectURL(blob)
                    const anchor = document.createElement('a')
                    anchor.href = url
                    anchor.download = `support-${new Date().toISOString().slice(0, 10)}.csv`
                    anchor.click()
                    URL.revokeObjectURL(url)
                  } catch {
                    setError('导出失败')
                  }
                }}
                className="h-8 rounded-md border border-border px-2 text-[11px] text-muted-foreground hover:bg-accent"
              >
                导出
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!window.confirm('退出除当前设备外的所有平台会话？')) return
                  try {
                    await apiPost('/api/platform/auth/sessions/revoke-others', {})
                    window.alert('已退出其他设备')
                  } catch {
                    setError('退出其他设备失败')
                  }
                }}
                className="h-8 rounded-md border border-border px-2 text-[11px] text-muted-foreground hover:bg-accent"
              >
                退出其他设备
              </button>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void loadList() }}
                placeholder="搜索访客、内容、标签…"
                className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <button type="button" onClick={() => setUnreadOnly((value) => !value)} className={`h-9 rounded-md border px-3 text-xs ${unreadOnly ? 'border-primary bg-primary-visible text-primary' : 'border-border bg-card text-muted-foreground'}`}>
              未读
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {(['ALL', 'OPEN', 'PENDING', 'CLOSED'] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setStatusFilter(item)}
                className={`rounded-md px-2.5 py-1 text-xs ${statusFilter === item ? 'bg-primary-visible font-medium text-primary' : 'text-muted-foreground hover:bg-accent'}`}
              >
                {item === 'ALL' ? '全部' : STATUS_LABEL[item]}
              </button>
            ))}
          </div>
          {metrics && (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
              <span>近 30 天 {metrics.volume} 条</span>
              <span>首响中位 {formatDuration(metrics.firstResponseSeconds.median)}</span>
              <span>未回复 {metrics.unanswered}</span>
              <span>CSAT {metrics.csat.average ?? '—'}</span>
            </div>
          )}
          {metrics?.notification?.status === 'FAILED' && (
            <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-800 dark:text-amber-200">
              最近一次推送失败（{metrics.notification.error || '未知原因'}）。请检查“开启推送”状态与网络；邮件/飞书兜底尚未接入。
            </p>
          )}
          {pwaHint && (
            <p className="mt-2 rounded-md border border-border bg-muted/50 p-2 text-[11px] text-muted-foreground">
              在 iPhone Safari 里点分享 → 添加到主屏幕，再从主屏幕打开并开启推送；普通标签页不会收到 Web Push。
            </p>
          )}
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loadingList && conversations.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />读取中…</div>
          ) : conversations.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">暂无会话</div>
          ) : (
            conversations.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={`block w-full border-b border-border/70 px-4 py-3 text-left transition-colors hover:bg-accent/60 ${selectedId === item.id ? 'bg-primary-visible/60' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{item.visitor?.name || item.visitor?.email || `访客 ${item.publicId.slice(-6)}`}</span>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${STATUS_TONE[item.status]}`}>{STATUS_LABEL[item.status]}</span>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{item.lastMessagePreview || '尚无消息'}</p>
                    <p className="mt-1 truncate text-[11px] text-muted-foreground/80">{item.teamId ? `团队 ${item.teamId}` : item.source === 'SHARE' ? '分享页' : '网站'} · {formatTime(item.lastMessageAt)}</p>
                  </div>
                  {(item.unreadForAgent || 0) > 0 && <span className="mt-0.5 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">{item.unreadForAgent}</span>}
                </div>
              </button>
            ))
          )}
        </div>
        <PlatformSupportSettings />
      </section>

      <section className={`min-w-0 flex-1 flex-col rounded-[8px] border border-border bg-popover ${selectedId ? 'flex' : 'hidden lg:flex'}`}>
        {!selectedId ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <MessageSquare className="h-8 w-8" />
            从左侧选择一段会话
          </div>
        ) : (
          <>
            <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-border p-4">
              <div className="flex min-w-0 items-start gap-2">
                <button type="button" onClick={() => setSelectedId(null)} className="mt-0.5 rounded-md p-1 hover:bg-accent lg:hidden" aria-label="返回列表">
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-sm font-semibold">{selected?.visitor?.name || selected?.visitor?.email || `访客 ${selected?.publicId.slice(-6)}`}</h2>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${STATUS_TONE[selected?.status || 'OPEN']}`}>{STATUS_LABEL[selected?.status || 'OPEN']}</span>
                    {selected?.csatScore ? <span className="text-xs text-muted-foreground">CSAT {selected.csatScore}/5</span> : null}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span>{selected?.visitor?.email || '未登录访客'}</span>
                    <span>页面 {selected?.pagePath || '—'}</span>
                    <span>{selected?.teamId ? `团队 ${selected.teamId}` : '无团队上下文'}</span>
                    <span>{selected?.projectId ? `项目 ${selected.projectId}` : ''}</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={tagsDraft}
                  onChange={(event) => setTagsDraft(event.target.value)}
                  onBlur={applyTags}
                  onKeyDown={(event) => { if (event.key === 'Enter') applyTags() }}
                  placeholder="标签，逗号分隔"
                  className="h-8 w-36 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
                  aria-label="标签"
                />
                <button type="button" onClick={() => void markUnread()} className="h-8 rounded-md border border-border px-2.5 text-xs hover:bg-accent">标未读</button>
                {selected?.status === 'CLOSED' ? (
                  <button type="button" onClick={() => void updateConversation({ status: 'OPEN' })} className="h-8 rounded-md border border-border px-2.5 text-xs hover:bg-accent">重开</button>
                ) : (
                  <button type="button" onClick={() => void updateConversation({ status: 'CLOSED' })} className="h-8 rounded-md border border-border px-2.5 text-xs hover:bg-accent">关闭</button>
                )}
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto bg-background/40 p-4">
              {loadingDetail ? (
                <div className="flex h-32 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />读取中…</div>
              ) : messages.length === 0 ? (
                <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">还没有消息</div>
              ) : (
                <div className="space-y-3">
                  {messages.map((message) => {
                    const internal = message.visibility === 'INTERNAL'
                    return (
                      <div key={message.id} className={`flex ${message.senderType === 'AGENT' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${internal ? 'border border-dashed border-amber-500/50 bg-amber-500/10 text-foreground' : message.senderType === 'AGENT' ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-foreground'}`}>
                          <div className="mb-1 flex items-center gap-2 text-[10px] opacity-75">
                            <span>{internal ? '内部备注' : message.senderType === 'AGENT' ? '客服' : '访客'}</span>
                            <span>{formatTime(message.createdAt)}</span>
                          </div>
                          <p className="whitespace-pre-wrap break-words">{message.body}</p>
                          {message.localStatus === 'failed' && (
                            <button type="button" onClick={() => void retryQueued(message)} className="mt-1 text-[10px] underline opacity-80">发送失败，重发</button>
                          )}
                          {message.localStatus === 'sending' && <p className="mt-1 text-[10px] opacity-70">发送中…</p>}
                        </div>
                      </div>
                    )
                  })}
                  <div ref={messageEndRef} />
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-border p-3">
              {typing && <p className="mb-2 text-xs text-muted-foreground">访客正在输入…</p>}
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setNoteMode((value) => !value)} className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${noteMode ? 'border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'border-border text-muted-foreground hover:bg-accent'}`}>
                  <StickyNote className="h-3.5 w-3.5" />{noteMode ? '内部备注' : '公开回复'}
                </button>
                <select value={cannedId} onChange={(event) => insertCanned(event.target.value)} className="h-7 max-w-[220px] rounded-md border border-border bg-background px-2 text-xs">
                  <option value="">插入常用语…</option>
                  {canned.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                </select>
                <button type="button" onClick={() => void createCanned()} className="h-7 rounded-md border border-border px-2 text-[11px] text-muted-foreground hover:bg-accent">+ 常用语</button>
              </div>
              <div className="flex items-end gap-2">
                <textarea
                  value={draft}
                  onChange={(event) => { setDraft(event.target.value); notifyTyping() }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      void send()
                    }
                  }}
                  rows={2}
                  placeholder={noteMode ? '写内部备注，访客看不到…' : '回复访客，Enter 发送，Shift+Enter 换行…'}
                  className="min-h-[60px] min-w-0 flex-1 resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <button type="button" onClick={() => void send()} disabled={!draft.trim() || sending} className="inline-flex h-10 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  发送
                </button>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">内部备注不会进入访客的 SSE/通知；公开回复会。</p>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
