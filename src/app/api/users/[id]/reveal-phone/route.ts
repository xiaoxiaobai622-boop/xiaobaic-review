import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePlatformAdmin } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { getClientIpAddress } from '@/lib/utils'
import { revealPhoneNumber } from '@/lib/personal-data-reveal'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/users/[id]/reveal-phone — 名单里只给掩码，看全号要走这里：每次展开都留一条审计。
// 配额与「换绑手机号」同级（15 分钟 20 次），按操作人计数，不是按 IP。
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requirePlatformAdmin(request)
  if (authResult instanceof Response) return authResult

  const limited = await rateLimit(request, {
    windowMs: 15 * 60 * 1000,
    maxRequests: 20,
    message: '查看次数过多，请稍后再试',
  }, 'reveal-user-phone', authResult.id)
  if (limited) return limited

  const { id } = await params

  try {
    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, phone: true },
    })
    if (!target) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const phone = await revealPhoneNumber({
      kind: 'user',
      subjectId: target.id,
      stored: target.phone,
      actorId: authResult.id,
      ipAddress: getClientIpAddress(request),
    })

    const response = NextResponse.json({ phone })
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    response.headers.set('Pragma', 'no-cache')
    response.headers.set('Expires', '0')
    return response
  } catch (error) {
    logError('[PERSONAL_DATA] Failed to reveal a user phone number:', error)
    return NextResponse.json({ error: '无法获取手机号，请稍后重试' }, { status: 500 })
  }
}
