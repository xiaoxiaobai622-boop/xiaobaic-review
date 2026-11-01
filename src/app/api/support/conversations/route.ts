import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { attachSupportCookie, isSameOriginSupportRequest, resolveSupportVisitor, sanitizeSupportPagePath } from '@/lib/support/session'
import { resolveSupportLocale } from '@/lib/support/i18n'
import { getSupportSettings, supportPublicSettings } from '@/lib/support/settings'
import { findActiveVisitorConversation, toSupportConversationView, visitorPrincipal } from '@/lib/support/service'
import { noStoreJson, supportErrorResponse } from '@/lib/support/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SOURCES = new Set(['MARKETING', 'STUDIO', 'SHARE', 'WEB'])

type Context = { teamId: string | null; projectId: string | null }

async function verifiedContext(userId: string | undefined, body: Record<string, unknown>): Promise<Context> {
  if (!userId) return { teamId: null, projectId: null }

  let teamId = typeof body.teamId === 'string' ? body.teamId.trim() : null
  const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : null

  if (projectId) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, teamId: true },
    })
    if (!project) return { teamId: null, projectId: null }
    if (teamId && project.teamId !== teamId) return { teamId: null, projectId: null }
    teamId = project.teamId
  }

  if (!teamId) return { teamId: null, projectId: null }

  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
    select: { status: true },
  })
  if (!membership || membership.status !== 'ACTIVE') return { teamId: null, projectId: null }

  return { teamId, projectId }
}

/** POST /api/support/conversations — create (or resume) the visitor's current chat. */
export async function POST(request: NextRequest) {
  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 10,
    message: '会话创建过于频繁，请稍后再试',
  }, 'support-conversation-create')
  if (limited) return limited
  if (!isSameOriginSupportRequest(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { visitor, user, token } = await resolveSupportVisitor(request)
    const settings = await getSupportSettings()
    if (!settings.enabled) {
      return noStoreJson({ error: '在线客服暂时关闭，请使用微信或邮件联系', code: 'SUPPORT_DISABLED' }, { status: 503 })
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    if (!visitor.consentAt && body.consent !== true) {
      return NextResponse.json({ error: '请先同意隐私提示', code: 'CONSENT_REQUIRED' }, { status: 400 })
    }

    const locale = resolveSupportLocale(typeof body.locale === 'string' ? body.locale : visitor.locale)
    const source = typeof body.source === 'string' && SOURCES.has(body.source) ? body.source : 'WEB'
    const pagePath = sanitizeSupportPagePath(body.pagePath)
    const context = await verifiedContext(user?.id ?? visitor.userId ?? undefined, body)

    const updatedVisitor = await prisma.supportVisitor.update({
      where: { id: visitor.id },
      data: {
        locale,
        ...(body.consent === true && !visitor.consentAt
          ? { consentAt: new Date(), consentVersion: 'support-v1' }
          : {}),
      },
    })

    const existing = await findActiveVisitorConversation(visitor.id)
    if (existing) {
      const response = noStoreJson({
        conversation: toSupportConversationView(existing, 'visitor'),
        settings: supportPublicSettings(settings),
        visitor: { id: updatedVisitor.id, locale: updatedVisitor.locale },
      })
      if (token) attachSupportCookie(response, token, request)
      return response
    }

    const conversation = await prisma.$transaction(async (tx) => {
      const created = await tx.supportConversation.create({
        data: {
          visitorId: visitor.id,
          userId: user?.id ?? visitor.userId ?? null,
          teamId: context.teamId,
          projectId: context.projectId,
          source,
          pagePath,
          locale,
        },
      })
      await tx.supportParticipant.create({
        data: {
          conversationId: created.id,
          principalKey: visitorPrincipal(visitor.id),
          role: 'VISITOR',
          visitorId: visitor.id,
        },
      })
      await tx.supportEvent.create({
        data: {
          conversationId: created.id,
          actorType: 'VISITOR',
          actorId: visitor.id,
          type: 'CONVERSATION_CREATED',
          metadata: { source, pagePath },
        },
      })
      return created
    })

    const hydrated = await prisma.supportConversation.findUnique({
      where: { id: conversation.id },
      include: { visitor: true },
    })

    const response = noStoreJson({
      conversation: hydrated ? toSupportConversationView(hydrated, 'visitor') : null,
      settings: supportPublicSettings(settings),
      visitor: { id: updatedVisitor.id, locale: updatedVisitor.locale },
    })
    if (token) attachSupportCookie(response, token, request)
    return response
  } catch (error) {
    return supportErrorResponse(error)
  }
}
