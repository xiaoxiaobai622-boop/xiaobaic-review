import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { generatePasskeyAuthenticationOptions } from '@/lib/passkey'
import { verifyPlatformTwoFactor } from '@/lib/platform-2fa'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 20,
    message: '请求过于频繁，请稍后再试',
  }, 'platform-passkey-options')
  if (limited) return limited

  const body = (await request.json().catch(() => ({}))) as { twoFactorToken?: string }
  const payload = verifyPlatformTwoFactor(body.twoFactorToken || '')
  if (!payload) return NextResponse.json({ error: '二次验证已过期，请重新输入密码' }, { status: 401 })

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { email: true, isPlatformAdmin: true, passkeys: { select: { id: true } } },
  })
  if (!user?.isPlatformAdmin || user.passkeys.length === 0) {
    return NextResponse.json({ error: '该账号没有可用的通行密钥' }, { status: 400 })
  }

  const options = await generatePasskeyAuthenticationOptions(user.email)
  return NextResponse.json({ options: options.options })
}
