import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiAdmin } from '@/lib/auth'
import { canAccessProject } from '@/lib/project-access'
import { rateLimit } from '@/lib/rate-limit'
import { getClientIpAddress } from '@/lib/utils'
import { revealPhoneNumber } from '@/lib/personal-data-reveal'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/projects/[id]/recipients/[rid]/reveal-phone — 收件人列表只给掩码，需要联系客户时
// 到这里展开。守卫与列名单一致（同一个人本来就读得到这条记录），配额按操作人计。
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; rid: string }> },
) {
  const authResult = await requireApiAdmin(request)
  if (authResult instanceof Response) return authResult

  const limited = await rateLimit(request, {
    windowMs: 15 * 60 * 1000,
    maxRequests: 20,
    message: '查看次数过多，请稍后再试',
  }, 'reveal-recipient-phone', authResult.id)
  if (limited) return limited

  const { id: projectId, rid: recipientId } = await params
  if (!(await canAccessProject(prisma, authResult, projectId))) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  try {
    // 归属校验和 PATCH 一样带 projectId：拿一枚别的项目的 rid 换不到号码。
    const recipient = await prisma.projectRecipient.findFirst({
      where: { id: recipientId, projectId },
      select: { id: true, phone: true },
    })
    if (!recipient) {
      return NextResponse.json({ error: 'Recipient not found' }, { status: 404 })
    }

    const phone = await revealPhoneNumber({
      kind: 'recipient',
      subjectId: recipient.id,
      stored: recipient.phone,
      actorId: authResult.id,
      projectId,
      ipAddress: getClientIpAddress(request),
    })

    const response = NextResponse.json({ phone })
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    response.headers.set('Pragma', 'no-cache')
    response.headers.set('Expires', '0')
    return response
  } catch (error) {
    logError('[PERSONAL_DATA] Failed to reveal a recipient phone number:', error)
    return NextResponse.json({ error: '无法获取手机号，请稍后重试' }, { status: 500 })
  }
}
