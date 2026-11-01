import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { attachSupportCookie, resolveSupportVisitor } from '@/lib/support/session'
import { getSupportSettings, supportPublicSettings } from '@/lib/support/settings'
import { findActiveVisitorConversation, listVisitorMessages, toSupportConversationView } from '@/lib/support/service'
import { noStoreJson, supportErrorResponse } from '@/lib/support/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/support/bootstrap — widget startup: settings + the current conversation. */
export async function GET(request: NextRequest) {
  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 90,
    message: '请求过于频繁，请稍后再试',
  }, 'support-bootstrap')
  if (limited) return limited

  try {
    const { visitor, token } = await resolveSupportVisitor(request)
    const settings = await getSupportSettings()
    const conversation = await findActiveVisitorConversation(visitor.id)
    const messages = conversation
      ? (await listVisitorMessages(conversation.id, null, 50)).messages
      : []

    const response = noStoreJson({
      visitor: { id: visitor.id, locale: visitor.locale, hasConsent: Boolean(visitor.consentAt) },
      settings: supportPublicSettings(settings),
      conversation: conversation ? toSupportConversationView(conversation, 'visitor') : null,
      messages,
    })
    if (token) attachSupportCookie(response, token, request)
    return response
  } catch (error) {
    return supportErrorResponse(error)
  }
}
