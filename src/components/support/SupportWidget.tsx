'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, MessageCircle, Send, X } from 'lucide-react'
import { getAccessToken } from '@/lib/token-store'
import { getActiveTeamId } from '@/lib/team-store'
import { getSupportStrings, resolveSupportLocale } from '@/lib/support/i18n'

type SupportSettings = {
  enabled: boolean
  online: boolean
  offlineMessage: Record<string, string>
  fallbackContacts: { wechatImage?: string | null; email?: string | null; feishu?: string | null }
  firstResponseTargetMinutes: number
  csatEnabled: boolean
}

type Conversation = {
  id: string
  publicId: string
  status: 'OPEN' | 'PENDING' | 'CLOSED'
  lastMessagePreview: string | null
  unreadForVisitor: number
  csatScore: number | null
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

type PendingMessage = { conversationId: string; clientId: string; body: string; createdAt: string }

const OUTBOX_KEY = 'vidx_support_outbox_v1'
const MAX_MESSAGE = 4000

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function readOutbox(): PendingMessage[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeOutbox(items: PendingMessage[]) {
  try {
    if (items.length) localStorage.setItem(OUTBOX_KEY, JSON.stringify(items))
    else localStorage.removeItem(OUTBOX_KEY)
  } catch {}
}

function addPending(item: PendingMessage) {
  const items = readOutbox().filter((entry) => entry.clientId !== item.clientId)
  items.push(item)
  writeOutbox(items)
}

function removePending(clientId: string) {
  writeOutbox(readOutbox().filter((entry) => entry.clientId !== clientId))
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
        } catch {}
      }
      boundary = buffer.indexOf('\n\n')
    }
  }
}

function supportHeaders(contentType = false) {
  const headers = new Headers()
  if (contentType) headers.set('Content-Type', 'application/json')
  const token = getAccessToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return headers
}

async function supportFetch(input: string, init: RequestInit = {}) {
  return fetch(input, { ...init, headers: init.headers || supportHeaders(), credentials: 'same-origin', cache: 'no-store' })
}

export function SupportWidget({ placement = 'bottom', hideLauncher = false, embed = false }: { placement?: 'bottom' | 'side'; hideLauncher?: boolean; embed?: boolean }) {
  const [open, setOpen] = useState(false)
  const [bootstrapped, setBootstrapped] = useState(false)
  const [loading, setLoading] = useState(false)
  const [starting, setStarting] = useState(false)
  const [settings, setSettings] = useState<SupportSettings | null>(null)
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [streamState, setStreamState] = useState<'connecting' | 'open' | 'offline'>('connecting')
  const [typing, setTyping] = useState(false)
  const [agentReadSeq, setAgentReadSeq] = useState(0)
  const [csatDone, setCsatDone] = useState(false)
  const [csatComment, setCsatComment] = useState('')
  const [sendingCsat, setSendingCsat] = useState(false)
  const [locale, setLocale] = useState<'zh' | 'en' | 'de' | 'nl'>('zh')
  const strings = useMemo(() => getSupportStrings(locale), [locale])
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)
  const conversationRef = useRef<Conversation | null>(null)
  const messagesRef = useRef<Message[]>([])
  const lastTypingSent = useRef(0)
  const typingTimer = useRef<number | null>(null)

  conversationRef.current = conversation
  messagesRef.current = messages

  useEffect(() => {
    setLocale(resolveSupportLocale(document.documentElement.lang || navigator.language))
  }, [])

  const lastServerSeq = useCallback(
    () => messagesRef.current.reduce((max, message) => message.seq > 0 ? Math.max(max, message.seq) : max, 0),
    [],
  )

  const upsertServerMessage = useCallback((incoming: Message) => {
    setMessages((prev) => {
      const withoutSame = prev.filter((item) => item.id !== incoming.id && item.seq !== incoming.seq && item.clientId !== incoming.clientId)
      const serverMessages = withoutSame.filter((item) => item.seq > 0)
      const localMessages = withoutSame.filter((item) => item.seq <= 0)
      serverMessages.push(incoming)
      serverMessages.sort((a, b) => a.seq - b.seq)
      return [...serverMessages, ...localMessages]
    })
  }, [])

  const markRead = useCallback(async (conversationId: string, seq: number) => {
    if (!seq) return
    await supportFetch(`/api/support/conversations/${conversationId}/read`, {
      method: 'POST',
      headers: supportHeaders(true),
      body: JSON.stringify({ seq }),
    }).catch(() => {})
  }, [])

  const loadMessages = useCallback(async (conversationId: string, afterSeq: number) => {
    const response = await supportFetch(`/api/support/conversations/${conversationId}/messages?afterSeq=${afterSeq}`)
    if (!response.ok) return
    const data = await response.json()
    if (Array.isArray(data.messages)) {
      for (const message of data.messages) upsertServerMessage(message)
      const last = data.messages.at(-1)?.seq
      if (last) void markRead(conversationId, last)
    }
  }, [markRead, upsertServerMessage])

  const bootstrap = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await supportFetch('/api/support/bootstrap')
      if (!response.ok) throw new Error(strings.connectionError)
      const data = await response.json()
      setSettings(data.settings)
      setConversation(data.conversation)
      setMessages(Array.isArray(data.messages) ? data.messages : [])
      setBootstrapped(true)
      if (data.conversation) {
        setAgentReadSeq(0)
        const pending = readOutbox().filter((item) => item.conversationId === data.conversation.id)
        for (const item of pending) {
          setMessages((prev) => prev.some((message) => message.clientId === item.clientId) ? prev : [...prev, {
            id: `local-${item.clientId}`,
            seq: 0,
            senderType: 'VISITOR',
            body: item.body,
            kind: 'TEXT',
            createdAt: item.createdAt,
            clientId: item.clientId,
            localStatus: 'sending',
          }])
        }
        void markRead(data.conversation.id, data.messages?.at(-1)?.seq ?? 0)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : strings.connectionError)
    } finally {
      setLoading(false)
    }
  }, [markRead, strings.connectionError])

  useEffect(() => {
    if (!open || bootstrapped) return
    void bootstrap()
  }, [bootstrapped, bootstrap, open])

  useEffect(() => {
    const openWidget = () => setOpen(true)
    window.addEventListener('vidx-open-support', openWidget)
    return () => window.removeEventListener('vidx-open-support', openWidget)
  }, [])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => inputRef.current?.focus(), 120)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const conversationId = conversation?.id

  useEffect(() => {
    if (!open || !conversationId) return
    const controller = new AbortController()
    let cancelled = false
    let attempt = 0
    let lastSeq = lastServerSeq()
    const stream = async () => {
      while (!cancelled) {
        try {
          const response = await fetch(`/api/support/conversations/${conversationId}/stream?afterSeq=${lastSeq}`, {
            signal: controller.signal,
            cache: 'no-store',
            credentials: 'same-origin',
            headers: { Accept: 'text/event-stream' },
          })
          if (!response.ok) throw new Error(`stream ${response.status}`)
          setStreamState('open')
          attempt = 0
          await consumeSSE(response, (event, data) => {
            if (data?.conversationId && data.conversationId !== conversationId) return
            if (event === 'message.created' && data.message) {
              const incoming = data.message as Message
              if (incoming.visibility === 'INTERNAL') return
              lastSeq = Math.max(lastSeq, incoming.seq)
              upsertServerMessage(incoming)
              if (incoming.senderType === 'VISITOR') {
                removePending(incoming.clientId || '')
              } else {
                setTyping(false)
                void markRead(conversationId, incoming.seq)
              }
            } else if (event === 'typing' && data.senderType === 'AGENT') {
              setTyping(true)
              if (typingTimer.current) window.clearTimeout(typingTimer.current)
              typingTimer.current = window.setTimeout(() => setTyping(false), 4500)
            } else if (event === 'conversation.read' && data.readerType === 'AGENT') {
              setAgentReadSeq((value) => Math.max(value, Number(data.seq) || 0))
            } else if (event === 'conversation.updated') {
              setConversation((prev) => prev ? { ...prev, status: data.status || prev.status } : prev)
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
    }
    void stream()
    return () => {
      cancelled = true
      controller.abort()
      if (typingTimer.current) window.clearTimeout(typingTimer.current)
    }
  }, [conversationId, lastServerSeq, markRead, open, upsertServerMessage])

  useEffect(() => {
    if (!open || !conversationId || streamState === 'open') return
    const timer = window.setInterval(() => {
      void loadMessages(conversationId, lastServerSeq())
    }, 10_000)
    return () => window.clearInterval(timer)
  }, [conversationId, lastServerSeq, loadMessages, open, streamState])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, open])

  const conversationStatus = conversation?.status
  useEffect(() => {
    if (conversationStatus !== 'CLOSED') setCsatDone(false)
  }, [conversationStatus])

  const startConversation = async () => {
    if (starting) return
    setStarting(true)
    setError(null)
    try {
      const pathname = window.location.pathname
      const projectMatch = /\/studio\/projects\/([^/]+)/.exec(pathname)
      const response = await supportFetch('/api/support/conversations', {
        method: 'POST',
        headers: supportHeaders(true),
        body: JSON.stringify({
          consent: true,
          locale,
          source: pathname.startsWith('/share/') ? 'SHARE' : pathname.startsWith('/studio') ? 'STUDIO' : 'MARKETING',
          pagePath: pathname,
          teamId: getActiveTeamId() || undefined,
          projectId: projectMatch?.[1],
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error || strings.connectionError)
      setConversation(data.conversation)
      setSettings(data.settings)
      setMessages(Array.isArray(data.messages) ? data.messages : [])
      setBootstrapped(true)
      if (data.conversation) {
        await loadMessages(data.conversation.id, 0)
        void markRead(data.conversation.id, 0)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : strings.connectionError)
    } finally {
      setStarting(false)
    }
  }

  const send = async (bodyOverride?: string, clientIdOverride?: string) => {
    const body = (bodyOverride ?? draft).trim()
    if (!body || !conversation) return
    if (body.length > MAX_MESSAGE) {
      setError(strings.messageTooLong)
      return
    }
    const clientId = clientIdOverride || crypto.randomUUID()
    const existing = messagesRef.current.some((message) => message.clientId === clientId)
    if (!existing) {
      const local: Message = {
        id: `local-${clientId}`,
        seq: 0,
        senderType: 'VISITOR',
        body,
        kind: 'TEXT',
        createdAt: new Date().toISOString(),
        clientId,
        localStatus: 'sending',
      }
      setMessages((prev) => [...prev, local])
      addPending({ conversationId: conversation.id, clientId, body, createdAt: local.createdAt })
    }
    if (!clientIdOverride) setDraft('')
    try {
      const response = await supportFetch(`/api/support/conversations/${conversation.id}/messages`, {
        method: 'POST',
        headers: supportHeaders(true),
        body: JSON.stringify({ body, clientId }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error || strings.failed)
      if (data.message) upsertServerMessage(data.message)
      removePending(clientId)
      if (data.conversation) setConversation((prev) => prev ? { ...prev, ...data.conversation } : prev)
    } catch (cause) {
      setMessages((prev) => prev.map((message) => message.clientId === clientId ? { ...message, localStatus: 'failed' } : message))
      setError(cause instanceof Error ? cause.message : strings.failed)
    }
  }

  const retry = (message: Message) => {
    if (!message.clientId) return
    void send(message.body, message.clientId)
  }

  const notifyTyping = () => {
    if (!conversation) return
    const now = Date.now()
    if (now - lastTypingSent.current < 2500) return
    lastTypingSent.current = now
    void supportFetch(`/api/support/conversations/${conversation.id}/typing`, {
      method: 'POST',
      headers: supportHeaders(true),
      body: '{}',
    }).catch(() => {})
  }

  const submitCsat = async (score: number) => {
    if (!conversation || sendingCsat) return
    setSendingCsat(true)
    try {
      await supportFetch(`/api/support/conversations/${conversation.id}/csat`, {
        method: 'POST',
        headers: supportHeaders(true),
        body: JSON.stringify({ score, comment: csatComment.trim() || undefined }),
      })
      setCsatDone(true)
    } finally {
      setSendingCsat(false)
    }
  }

  const fallbackEmail = settings?.fallbackContacts?.email
  const fallbackFeishu = settings?.fallbackContacts?.feishu
  const wechatImage = settings?.fallbackContacts?.wechatImage

  const buttonClass = placement === 'side'
    ? 'fixed left-0 top-1/2 z-[60] -translate-y-1/2 rounded-r-lg bg-primary px-2 py-3 text-primary-foreground shadow-lg'
    : 'fixed bottom-4 right-4 z-[60] inline-flex h-12 items-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground shadow-lg'

  return (
    <>
      {!open && !hideLauncher && (
        <button type="button" onClick={() => setOpen(true)} className={buttonClass} aria-label={strings.open}>
          <MessageCircle className="h-4 w-4" />
          {placement === 'bottom' && <span>{strings.title}</span>}
        </button>
      )}

      {open && (
        <div
          className={embed ? 'fixed inset-0 z-[70] flex bg-popover' : `fixed inset-0 z-[70] flex items-end justify-end bg-black/20 p-3 sm:items-center sm:justify-end ${placement === 'side' ? 'sm:pl-12' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={strings.title}
          onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}
        >
          <section className={embed ? 'flex h-[100dvh] w-full flex-col overflow-hidden bg-popover pb-[env(safe-area-inset-bottom)]' : 'flex h-[min(640px,calc(100dvh-1.5rem))] w-full flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-2xl sm:ml-auto sm:w-[390px]'}
            <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border p-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold">{strings.title}</h2>
                  <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] ${settings?.online ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${settings?.online ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />
                    {settings?.online ? strings.online : strings.offline}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">{strings.subtitle}</p>
              </div>
              {!embed && <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1.5 hover:bg-accent" aria-label={strings.close}>
                <X className="h-4 w-4" />
              </button>}
            </header>

            <div className="flex min-h-0 flex-1 flex-col bg-background/40">
              {loading ? (
                <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />{strings.loading}</div>
              ) : !conversation ? (
                <div className="flex flex-1 flex-col justify-center gap-4 p-5">
                  <p className="text-sm leading-6 text-foreground">{strings.welcome}</p>
                  {settings && !settings.online && (
                    <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-200">{settings.offlineMessage[locale] || strings.offlineNotice}</p>
                  )}
                  <div>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">{strings.quickTitle}</p>
                    <div className="flex flex-wrap gap-2">
                      {strings.quickQuestions.map((question) => (
                        <button key={question} type="button" onClick={() => { setDraft(question); void startConversation() }} className="rounded-full border border-border bg-card px-3 py-1.5 text-left text-xs hover:bg-accent">
                          {question}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button type="button" onClick={() => void startConversation()} disabled={starting} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">
                    {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
                    {strings.start}
                  </button>
                  <p className="text-[11px] leading-4 text-muted-foreground">{strings.privacy}</p>
                  {(fallbackEmail || fallbackFeishu || wechatImage) && (
                    <div className="border-t border-border pt-3 text-[11px] text-muted-foreground">
                      <span className="mr-2">{strings.fallback}:</span>
                      {fallbackEmail && <a className="mr-3 underline" href={`mailto:${fallbackEmail}`}>{fallbackEmail}</a>}
                      {fallbackFeishu && <a className="mr-3 underline" href={fallbackFeishu} target="_blank" rel="noreferrer">飞书</a>}
                      {wechatImage && <a className="underline" href={wechatImage} target="_blank" rel="noreferrer">微信</a>}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="min-h-0 flex-1 overflow-y-auto p-3">
                    {messages.length === 0 ? (
                      <p className="py-8 text-center text-xs text-muted-foreground">{strings.empty}</p>
                    ) : (
                      <div className="space-y-2.5" aria-live="polite">
                        {messages.map((message) => {
                          const own = message.senderType === 'VISITOR'
                          return (
                            <div key={`${message.id}-${message.seq}`} className={`flex ${own ? 'justify-end' : 'justify-start'}`}>
                              <div className={`max-w-[84%] rounded-xl px-3 py-2 text-sm ${own ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-foreground'}`}>
                                <p className="whitespace-pre-wrap break-words">{message.body}</p>
                                <div className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${own ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                                  {message.localStatus === 'failed' ? (
                                    <button type="button" onClick={() => retry(message)} className="underline">{strings.retrySend}</button>
                                  ) : message.localStatus === 'sending' ? (
                                    <span>{strings.sending}</span>
                                  ) : own ? (
                                    <span>{agentReadSeq >= message.seq ? strings.read : strings.delivered}</span>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                        {typing && <p className="text-[11px] text-muted-foreground">{strings.typing}</p>}
                        <div ref={endRef} />
                      </div>
                    )}
                  </div>

                  {conversation.status === 'CLOSED' && settings?.csatEnabled !== false && conversation.csatScore == null && !csatDone && (
                    <div className="border-t border-border bg-card p-3">
                      <p className="text-xs font-medium">{strings.csatTitle}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {[1, 2, 3, 4, 5].map((score) => (
                          <button key={score} type="button" disabled={sendingCsat} onClick={() => void submitCsat(score)} className="h-8 w-8 rounded-md border border-border text-xs hover:bg-accent disabled:opacity-50">{score}</button>
                        ))}
                      </div>
                      <input value={csatComment} onChange={(event) => setCsatComment(event.target.value)} placeholder={strings.csatComment} className="mt-2 h-8 w-full rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring" />
                    </div>
                  )}

                  <div className="shrink-0 border-t border-border p-3">
                    {conversation.status === 'CLOSED' && <p className="mb-2 text-[11px] text-muted-foreground">{strings.closedNotice}</p>}
                    {error && <p className="mb-2 text-[11px] text-destructive">{error}</p>}
                    <div className="flex items-end gap-2">
                      <textarea
                        ref={inputRef}
                        value={draft}
                        onChange={(event) => { setDraft(event.target.value); notifyTyping() }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault()
                            void send()
                          }
                        }}
                        rows={2}
                        maxLength={MAX_MESSAGE}
                        placeholder={strings.placeholder}
                        className="min-h-[56px] min-w-0 flex-1 resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                      />
                      <button type="button" disabled={!draft.trim()} onClick={() => void send()} className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-3 text-primary-foreground disabled:opacity-50" aria-label={strings.send}>
                        <Send className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                      <span>{streamState === 'open' ? '' : streamState === 'connecting' ? strings.connecting : strings.reconnecting}</span>
                      <span>{strings.privacy}</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  )
}
