import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { issueAdminTokens } from '@/lib/auth'
import { signWechatSession } from '@/lib/wechat-auth'
import { logError } from '@/lib/logging'
import { getRedis } from '@/lib/redis'
import { getWechatQrKey } from '@/lib/wechat-mini-login'
import { findOrCreateUserFromWechat } from '@/lib/wechat-mini-auth'
import { exchangeWechatPhoneCode, WechatPhoneError } from '@/lib/wechat-mini-phone'
import { bindPhoneToWechatUser } from '@/lib/wechat-account-merge'

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
  // 小程序「手机号快速验证组件」的 code；没有就跳过，不影响登录。
  const phoneCode = safeText(body.phoneCode, 512) || ''
  const avatarUrl = safeText(body.avatarUrl, 1000)

  try {
    const params = new URLSearchParams({
      appid: process.env.WECHAT_MINI_APP_ID,
      secret: process.env.WECHAT_MINI_APP_SECRET,
      js_code: code,
      grant_type: 'authorization_code',
    })
    const response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${params}`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
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
    let qrUser = user
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

      // ── 登录模式：手机号是账号主键；号码已有账号就合并到那个账号 ──
      const wechatUser = await findOrCreateUserFromWechat({
        openid: data.openid,
        unionid: data.unionid || null,
        nickname: nickname || '微信用户',
      })

      let adminUser = wechatUser
      if (phoneCode) {
        const phone = await exchangeWechatPhoneCode(phoneCode)
        const bound = await bindPhoneToWechatUser({
          userId: wechatUser.id,
          phone,
          nickname,
          avatarUrl,
        })
        adminUser = bound.user
      } else if (!wechatUser.phone) {
        return NextResponse.json({ error: '需要授权手机号', code: 'PHONE_REQUIRED' }, { status: 400 })
      }

      if (adminUser.phone && (!adminUser.onboardingCompleted || !adminUser.name)) {
        adminUser = await prisma.user.update({
          where: { id: adminUser.id },
          data: { name: adminUser.phone.slice(-4), onboardingCompleted: true },
        })
      }

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
      qrUser = {
        id: identity.id,
        nickname: adminUser.name || identity.nickname,
        avatarUrl: adminUser.avatarUrl || identity.avatarUrl,
        linked: Boolean(identity.unionId),
      }
      await prisma.wechatIdentity.update({
        where: { id: identity.id },
        data: { userId: adminUser.id },
      })

      const redis = getRedis()
      await redis.set(
        getWechatQrKey(qrId),
        JSON.stringify({
          status: 'success',
          returnUrl: qrSession?.returnUrl || '',
          token,
          user: qrUser,
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
    if (error instanceof WechatPhoneError) {
      const messages: Record<string, string> = {
        PHONE_CODE_MISSING: '需要授权手机号',
        PHONE_CODE_INVALID: '手机号授权已失效，请重新扫码',
        PHONE_UNSUPPORTED_REGION: '暂不支持中国大陆以外的手机号',
        PHONE_INVALID: '手机号格式无效',
        PHONE_EXCHANGE_FAILED: '手机号获取失败，请重试',
      }
      return NextResponse.json({
        error: messages[error.code] || '手机号获取失败，请重试',
        code: error.code,
      }, { status: 400 })
    }
    logError('Wechat mini login error:', error)
    return NextResponse.json({ error: '微信登录服务暂时不可用' }, { status: 502 })
  }
}
