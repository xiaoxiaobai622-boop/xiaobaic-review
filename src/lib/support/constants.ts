export const SUPPORT_COOKIE = 'vidx_support_session'
export const SUPPORT_COOKIE_MAX_AGE = 60 * 60 * 24 * 180
export const SUPPORT_SESSION_TOKEN_BYTES = 32
export const SUPPORT_MESSAGE_MAX_LENGTH = 4000
export const SUPPORT_PREVIEW_MAX_LENGTH = 140
export const SUPPORT_STREAM_HEARTBEAT_MS = 15_000
export const SUPPORT_STREAM_MAX_BACKFILL = 100
export const SUPPORT_STREAM_RECONNECT_MAX_MS = 30_000

export const SUPPORT_LOCALES = ['zh', 'en', 'de', 'nl'] as const
export type SupportLocale = (typeof SUPPORT_LOCALES)[number]

export const SUPPORT_INBOX_CHANNEL = 'support:inbox'
export function supportConversationChannel(conversationId: string) {
  return `support:conversation:${conversationId}`
}

export type SupportRealtimeEvent =
  | { type: 'message.created'; conversationId: string; message: unknown }
  | { type: 'conversation.read'; conversationId: string; readerType: 'VISITOR' | 'AGENT'; seq: number; userId?: string }
  | { type: 'typing'; conversationId: string; senderType: 'VISITOR' | 'AGENT'; userId?: string }
  | { type: 'conversation.updated'; conversationId: string; status?: string; unreadForAgent?: number; unreadForVisitor?: number }
