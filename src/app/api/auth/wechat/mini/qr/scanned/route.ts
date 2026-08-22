import { NextRequest, NextResponse } from 'next/server'
import { getRedis } from '@/lib/redis'
import { getWechatQrKey } from '@/lib/wechat-mini-login'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 60,
    message: '操作过于频繁，请稍后再试',
  }, 'wechat-qr-scanned')
  if (limited) return limited

  const body = await request.json().catch(() => ({}))
  const qrId = typeof body?.qrId === 'string' ? body.qrId.trim() : ''
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(qrId)) {
    return NextResponse.json({ error: '二维码无效或已过期' }, { status: 400 })
  }

  const redis = getRedis()
  const key = getWechatQrKey(qrId)
  const raw = await redis.get(key)
  if (!raw) {
    return NextResponse.json({ error: '二维码已过期，请重新获取' }, { status: 404 })
  }

  try {
    const session = JSON.parse(raw) as Record<string, unknown>
    if (session.status !== 'pending') {
      return NextResponse.json({ status: 'confirming' })
    }

    const ttl = await redis.ttl(key)
    await redis.set(
      key,
      JSON.stringify({ ...session, status: 'confirming' }),
      'EX',
      Math.max(ttl > 0 ? ttl : 300, 60),
    )
    return NextResponse.json({ status: 'confirming' })
  } catch {
    return NextResponse.json({ error: '二维码状态读取失败' }, { status: 400 })
  }
}
