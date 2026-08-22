import { NextRequest, NextResponse } from 'next/server'
import { getRedis } from '@/lib/redis'
import { WECHAT_SESSION_COOKIE } from '@/lib/wechat-auth'
import { getWechatQrKey, WECHAT_QR_COOKIE } from '@/lib/wechat-mini-login'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'

interface QrSession {
  status: 'pending' | 'confirming' | 'success'
  returnUrl: string
  mode?: 'login' | 'bind'
  bound?: boolean
  token?: string
  adminTokens?: {
    accessToken: string
    refreshToken: string
    accessExpiresAt: number
    refreshExpiresAt: number
    sessionId: string
  } | null
  user?: {
    id: string
    nickname?: string | null
    avatarUrl?: string | null
    linked?: boolean
  }
  needsOnboarding?: boolean
}

export async function GET(request: NextRequest) {
  const cookieQrId = request.cookies.get(WECHAT_QR_COOKIE)?.value
  const queryQrId = request.nextUrl.searchParams.get('qrId') || ''
  const qrId = cookieQrId || queryQrId
  if (!qrId || !/^[A-Za-z0-9_-]{16,64}$/.test(qrId)) {
    return NextResponse.json({ status: 'missing' }, { status: 404 })
  }

  try {
    const redis = getRedis()
    const raw = await redis.get(getWechatQrKey(qrId))
    if (!raw) return NextResponse.json({ status: 'expired' }, { status: 404 })

    const session = JSON.parse(raw) as QrSession
    if (session.status === 'pending' || session.status === 'confirming') {
      return NextResponse.json({ status: session.status })
    }

    // ── 绑定模式成功：返回 bound，不写登录 cookie ──────────────────
    if (session.status === 'success' && session.bound === true) {
      const response = NextResponse.json({ status: 'bound' })
      response.cookies.delete(WECHAT_QR_COOKIE)
      await redis.del(getWechatQrKey(qrId))
      return response
    }

    if (session.status === 'success' && session.token) {
      const response = NextResponse.json({
        status: 'success',
        user: session.user || null,
        returnUrl: session.returnUrl,
        adminTokens: session.adminTokens || null,
        needsOnboarding: session.needsOnboarding === true,
      })
      const secure = request.nextUrl.protocol === 'https:'
      response.cookies.set(WECHAT_SESSION_COOKIE, session.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        path: '/',
        maxAge: 30 * 24 * 60 * 60,
      })
      response.cookies.delete(WECHAT_QR_COOKIE)
      await redis.del(getWechatQrKey(qrId))
      return response
    }

    return NextResponse.json({ status: 'expired' }, { status: 404 })
  } catch (error) {
    logError('Wechat mini QR status failed:', error)
    return NextResponse.json({ status: 'error' }, { status: 502 })
  }
}
