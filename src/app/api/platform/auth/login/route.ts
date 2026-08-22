import { NextRequest, NextResponse } from 'next/server'
import { issuePlatformTokens, verifyCredentials } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { getAdminDeviceFingerprint } from '@/lib/studio-device'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 10,
    message: '登录尝试过于频繁，请稍后再试',
  }, 'platform-login')
  if (limited) return limited

  const body = await request.json().catch(() => null)
  const identifier = typeof body?.identifier === 'string' ? body.identifier.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!identifier || !password) {
    return NextResponse.json({ error: '请输入账号和密码' }, { status: 400 })
  }

  const user = await verifyCredentials(identifier, password)
  if (!user || !user.isPlatformAdmin) {
    return NextResponse.json({ error: '平台账号或密码错误，或该账号不是平台管理员' }, { status: 401 })
  }

  const fingerprint = getAdminDeviceFingerprint(request)
  const tokens = await issuePlatformTokens(user, fingerprint || undefined)

  return NextResponse.json({ user, tokens })
}
