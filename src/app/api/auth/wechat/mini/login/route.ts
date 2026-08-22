import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { issueAdminTokens } from '@/lib/auth'
import { signWechatSession } from '@/lib/wechat-auth'
import { logError } from '@/lib/logging'
import { getRedis } from '@/lib/redis'
import { getWechatQrKey } from '@/lib/wechat-mini-login'
import { findOrCreateUserFromWechat } from '@/lib/wechat-mini-auth'

export const runtime = 'nodejs'

interface CodeSessionResponse {
  openid?: string
  unionid?: string
  session_key?: string
  errcode?: number
  errmsg?: string
}

function safeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().slice(0, maxLength)
  return trimmed || null
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
  const qrId = typeof body.qrId === 'string' ? body.qrId.trim() : ''
  const nickname = safeText(body.nickname, 100)
  const avatarUrl = safeText(body.avatarUrl, 1000)

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
      where: { platform_openId: { platform: 'MINI_PROGRAM', openId: data.openid } },
      create: {
        platform: 'MINI_PROGRAM',
        openId: data.openid,
        unionId: data.unionid || null,
        nickname,
        avatarUrl,
      },
      update: {
        unionId: data.unionid || undefined,
        nickname: nickname ?? undefined,
        avatarUrl: avatarUrl ?? undefined,
      },
      select: { id: true, nickname: true, avatarUrl: true, unionId: true },
    })

    const token = signWechatSession(identity)
    const user = {
      id: identity.id,
      nickname: identity.nickname,
      avatarUrl: identity.avatarUrl,
      linked: Boolean(identity.unionId),
    }

    let adminTokens: Awaited<ReturnType<typeof issueAdminTokens>> | null = null
    let needsOnboarding = false
    let qrSession: { returnUrl?: string; mode?: string; userId?: string | null } | null = null

    if (qrId && /^[A-Za-z0-9_-]{16,64}$/.test(qrId)) {
      const raw = await getRedis().get(getWechatQrKey(qrId))
      if (!raw) {
        return NextResponse.json({ error: '二维码已过期，请返回网页重新获取' }, { status: 404 })
      }
      try {
        qrSession = JSON.parse(raw) as { returnUrl?: string; mode?: string; userId?: string | null }
      } catch {
        qrSession = null
      }
      if (!qrSession) {
        return NextResponse.json({ error: '二维码状态读取失败，请重新获取' }, { status: 400 })
      }

      // ── 绑定模式：把微信身份关联到当前已登录用户 ─────────────────
      if (qrSession.mode === 'bind' && qrSession.userId) {
        const existing = await prisma.wechatIdentity.findUnique({
          where: { platform_openId: { platform: 'MINI_PROGRAM', openId: data.openid } },
        })
        if (existing && existing.userId && existing.userId !== qrSession.userId) {
          return NextResponse.json({ error: '该微信已绑定其他账号' }, { status: 409 })
        }
        await prisma.wechatIdentity.update({
          where: { id: identity.id },
          data: { userId: qrSession.userId },
        })
        await getRedis().set(
          getWechatQrKey(qrId),
          JSON.stringify({ status: 'success', returnUrl: qrSession.returnUrl || '', bound: true, token, user }),
          'EX',
          120
        )
        return NextResponse.json({ status: 'bound', token, user })
      }

      const adminUser = await findOrCreateUserFromWechat({
        openid: data.openid,
        unionid: data.unionid || null,
        nickname: nickname || '微信用户',
      })

      adminTokens = await issueAdminTokens({
        id: adminUser.id,
        email: adminUser.email,
        phone: adminUser.phone,
        name: adminUser.name,
        avatarUrl: adminUser.avatarUrl,
        onboardingCompleted: adminUser.onboardingCompleted,
        role: adminUser.role,
        projectAccessScope: adminUser.projectAccessScope,
      })
      needsOnboarding = adminUser.onboardingCompleted === false
      await prisma.wechatIdentity.update({
        where: { id: identity.id },
        data: { userId: adminUser.id },
      })
    }

    if (qrId && /^[A-Za-z0-9_-]{16,64}$/.test(qrId)) {
      const redis = getRedis()
      await redis.set(
        getWechatQrKey(qrId),
        JSON.stringify({
          status: 'success',
          returnUrl: qrSession?.returnUrl || '',
          token,
          user,
          adminTokens,
          needsOnboarding,
        }),
        'EX',
        120
      )
    }

    return NextResponse.json({
      token,
      user,
      adminTokens,
      needsOnboarding,
    })
  } catch (error) {
    logError('Wechat mini login error:', error)
    return NextResponse.json({ error: '微信登录服务暂时不可用' }, { status: 502 })
  }
}
