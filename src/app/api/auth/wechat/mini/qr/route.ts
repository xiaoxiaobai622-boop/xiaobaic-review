import { NextRequest, NextResponse } from 'next/server'
import { getRedis } from '@/lib/redis'
import { safeWechatReturnUrl } from '@/lib/wechat-auth'
import { getCurrentUserFromRequest } from '@/lib/auth'
import {
  createWechatQrId,
  generateWechatMiniQrCode,
  getWechatQrKey,
  isWechatMiniConfigured,
  WECHAT_QR_COOKIE,
} from '@/lib/wechat-mini-login'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  if (!isWechatMiniConfigured()) {
    return NextResponse.json({ error: '微信小程序登录尚未配置' }, { status: 503 })
  }

  let body: Record<string, unknown> = {}
  try {
    body = await request.json()
  } catch {
    // Treat an empty body as no return URL.
  }

  const returnUrl = safeWechatReturnUrl(typeof body.returnUrl === 'string' ? body.returnUrl : null)
  const mode = body.mode === 'bind' ? 'bind' : 'login'

  // 绑定模式需要当前已登录用户
  let userId: string | null = null
  if (mode === 'bind') {
    const currentUser = await getCurrentUserFromRequest(request)
    if (!currentUser) {
      return NextResponse.json({ error: '绑定微信前请先登录' }, { status: 401 })
    }
    userId = currentUser.id
  }

  const qrId = createWechatQrId()
  const page = process.env.WECHAT_MINI_LOGIN_PAGE || 'pages/scan-login/scan-login'

  try {
    const png = await generateWechatMiniQrCode(qrId, page)
    const redis = getRedis()
    await redis.set(
      getWechatQrKey(qrId),
      JSON.stringify({ status: 'pending', returnUrl, mode, userId, createdAt: Date.now() }),
      'EX',
      300
    )

    const response = NextResponse.json({
      qrId,
      qrImage: `data:image/png;base64,${png.toString('base64')}`,
      expiresIn: 300,
      mode,
    })
    const secure = request.nextUrl.protocol === 'https:'
    response.cookies.set(WECHAT_QR_COOKIE, qrId, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: 300,
    })
    return response
  } catch (error) {
    logError('Wechat mini QR creation failed:', error)
    return NextResponse.json({ error: '微信小程序码生成失败，请稍后重试' }, { status: 502 })
  }
}
