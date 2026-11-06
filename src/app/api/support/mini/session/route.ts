import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getSupportSettings, supportPublicSettings } from '@/lib/support/settings'
import { findActiveVisitorConversation, toSupportConversationView } from '@/lib/support/service'
import { resolveMiniVisitor } from '@/lib/support/mini'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/support/mini/session — 小程序端建立/恢复客服会话（Bearer 鉴权，无 cookie）。 */
export async function POST(request: NextRequest) {
  const authResult = await requireApiUser(request)
  if (authResult instanceof Response) return authResult

  try {
    const settings = await getSupportSettings()
    if (!settings.enabled) {
      return NextResponse.json(
        { error: '在线客服暂时关闭，请使用邮件联系', code: 'SUPPORT_DISABLED' },
        { status: 503 },
      )
    }

    const user = await prisma.user.findUnique({
      where: { id: authResult.id },
      select: { id: true, name: true, email: true },
    })
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const visitor = await resolveMiniVisitor(user)
    const conversation = await findActiveVisitorConversation(visitor.id)

    return NextResponse.json(
      {
        visitor: { id: visitor.id },
        conversation: conversation ? toSupportConversationView(conversation, 'visitor') : null,
        settings: supportPublicSettings(settings),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '客服会话初始化失败' },
      { status: 500 },
    )
  }
}
