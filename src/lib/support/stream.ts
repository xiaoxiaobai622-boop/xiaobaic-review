import { prisma } from '@/lib/db'
import { logError } from '@/lib/logging'
import { SUPPORT_INBOX_CHANNEL, SUPPORT_STREAM_HEARTBEAT_MS, supportConversationChannel } from './constants'
import { subscribeSupportChannel } from './pubsub'
import { toSupportMessageView } from './service'

type StreamEvent =
  | { type: 'message.created'; conversationId: string; message: unknown }
  | { type: 'conversation.read'; conversationId: string; readerType: string; seq: number }
  | { type: 'typing'; conversationId: string; senderType: string }
  | { type: 'conversation.updated'; conversationId: string; [key: string]: unknown }

function sseChunk(event: StreamEvent) {
  const id =
    event.type === 'message.created' && event.message && typeof event.message === 'object' && 'seq' in event.message
      ? String((event.message as { seq: number }).seq)
      : `${event.type}-${Date.now()}`
  return `id: ${id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

export function createSupportInboxStream(options: { signal: AbortSignal }) {
  const { signal } = options
  const encoder = new TextEncoder()
  let closed = false
  let cleanup = () => {}

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: inbox\ndata: ${payload}\n\n`))
        } catch {
          close()
        }
      }
      const off = await subscribeSupportChannel(SUPPORT_INBOX_CHANNEL, send)
      const heartbeat = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          close()
        }
      }, SUPPORT_STREAM_HEARTBEAT_MS)
      const close = () => {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        Promise.resolve(off()).catch(() => {})
        signal.removeEventListener('abort', close)
        try {
          controller.close()
        } catch {}
      }
      cleanup = close
      signal.addEventListener('abort', close, { once: true })
      controller.enqueue(encoder.encode(': connected\n\n'))
    },
    cancel() {
      if (!closed) {
        closed = true
        cleanup()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

export function createSupportStream(options: {
  conversationId: string
  afterSeq: number
  includeInternal: boolean
  signal: AbortSignal
}) {
  const { conversationId, afterSeq, includeInternal, signal } = options
  const channel = supportConversationChannel(conversationId)
  const encoder = new TextEncoder()
  let closed = false
  let cleanup = () => {}

  const stream = new ReadableStream({
    async start(controller) {
      let lastSent = afterSeq
      let ready = false
      const pending: StreamEvent[] = []

      const send = (event: StreamEvent) => {
        if (closed) return
        controller.enqueue(encoder.encode(sseChunk(event)))
      }

      const deliver = (event: StreamEvent) => {
        if (event.type === 'message.created') {
          const message = event.message as { seq?: number; visibility?: string } | null
          if (!message || typeof message.seq !== 'number' || message.seq <= lastSent) return
          if (!includeInternal && message.visibility === 'INTERNAL') return
          lastSent = message.seq
          send(event)
          return
        }
        send(event)
      }

      const off = await subscribeSupportChannel(channel, (payload) => {
        try {
          const event = JSON.parse(payload) as StreamEvent
          if (!ready) pending.push(event)
          else deliver(event)
        } catch {
          // ignore malformed pub/sub payloads; the database still has the message
        }
      })

      const heartbeat = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          close()
        }
      }, SUPPORT_STREAM_HEARTBEAT_MS)

      const close = () => {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        Promise.resolve(off()).catch(() => {})
        signal.removeEventListener('abort', close)
        try {
          controller.close()
        } catch {}
      }

      cleanup = close
      signal.addEventListener('abort', close, { once: true })

      try {
        const rows =
          afterSeq > 0
            ? await prisma.supportMessage.findMany({
                where: {
                  conversationId,
                  seq: { gt: afterSeq },
                  deletedAt: null,
                  ...(includeInternal ? {} : { visibility: 'PUBLIC' }),
                },
                orderBy: { seq: 'asc' },
                take: 500,
              })
            : (
                await prisma.supportMessage.findMany({
                  where: {
                    conversationId,
                    deletedAt: null,
                    ...(includeInternal ? {} : { visibility: 'PUBLIC' }),
                  },
                  orderBy: { seq: 'desc' },
                  take: 100,
                })
              ).reverse()

        for (const row of rows) {
          const view = toSupportMessageView(row, includeInternal)
          if (view) deliver({ type: 'message.created', conversationId, message: view })
        }

        ready = true
        for (const event of pending) deliver(event)
        pending.length = 0
        controller.enqueue(encoder.encode(': connected\n\n'))
      } catch (error) {
        logError('[SUPPORT] stream backlog failed:', error)
        close()
      }
    },
    cancel() {
      if (!closed) {
        closed = true
        cleanup()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
