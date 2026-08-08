import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { signWechatSession } from '@/lib/wechat-auth'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'

interface CodeSessionResponse {
  openid?: string
  unionid?: string
  session_key?: string
  errcode?: number
  errmsg?: string
}

export async function POST(request: NextRequest) {
  if (!process.env.WECHAT_MINI_APP_ID || !process.env.WECHAT_MINI_APP_SECRET) {
    return NextResponse.json({ error: '微信小程序登录尚未配置' }, { status: 503 })
  }
  const limited = await rateLimit(request, { windowMs: 60_000, maxRequests: 10, message: '登录请求过于频繁' }, 'wechat-mini-login')
  if (limited) return limited

  const body = await request.json().catch(() => ({}))
  const code = typeof body.code === 'string' ? body.code.trim() : ''
  if (!code || code.length > 128) return NextResponse.json({ error: '微信登录 code 无效' }, { status: 400 })

  try {
    const params = new URLSearchParams({
      appid: process.env.WECHAT_MINI_APP_ID,
      secret: process.env.WECHAT_MINI_APP_SECRET,
      js_code: code,
      grant_type: 'authorization_code',
    })
    const response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${params}`, { cache: 'no-store' })
    const data = await response.json() as CodeSessionResponse
    if (!response.ok || !data.openid || data.errcode) {
      logError('Wechat mini code2Session failed:', data.errmsg || data.errcode)
      return NextResponse.json({ error: '微信登录失败，请重试' }, { status: 401 })
    }

    const identity = await prisma.wechatIdentity.upsert({
      where: { platform_openId: { platform: 'MINI', openId: data.openid } },
      create: { platform: 'MINI', openId: data.openid, unionId: data.unionid || null },
      update: { unionId: data.unionid || undefined },
      select: { id: true, nickname: true, avatarUrl: true, unionId: true },
    })
    return NextResponse.json({
      token: signWechatSession(identity),
      user: { id: identity.id, nickname: identity.nickname, avatarUrl: identity.avatarUrl, linked: Boolean(identity.unionId) },
    })
  } catch (error) {
    logError('Wechat mini login error:', error)
    return NextResponse.json({ error: '微信登录服务暂时不可用' }, { status: 502 })
  }
}
