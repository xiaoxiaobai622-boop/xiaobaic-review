import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getRedis } from '@/lib/redis'
import { issueAdminTokens } from '@/lib/auth'
import { exchangeMiniProgramCode, findOrCreateUserFromWechat } from '@/lib/wechat-mini-auth'
import { getWechatQrKey } from '@/lib/wechat-mini-login'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 20,
    message: 'Too many login attempts',
  }, 'wechat-mini-login')
  if (limited) return limited

  const body = await request.json().catch(() => null)
  const code = typeof body?.code === 'string' ? body.code.trim() : ''
  if (!code) return NextResponse.json({ error: 'Missing login code' }, { status: 400 })

  const qrId = typeof body?.qrId === 'string' ? body.qrId.trim() : ''
  const mode = body?.mode === 'bind' ? 'bind' : 'login'

  try {
    const identity = await exchangeMiniProgramCode(code)

    // ── 绑定模式：把微信身份关联到当前已登录用户 ─────────────────────
    if (mode === 'bind' && qrId) {
      const redis = getRedis()
      const raw = await redis.get(getWechatQrKey(qrId))
      if (!raw) {
        return NextResponse.json({ error: '二维码已过期，请重新获取' }, { status: 404 })
      }
      const session = JSON.parse(raw) as { status?: string; mode?: string; userId?: string | null }
      if (session.mode !== 'bind' || !session.userId) {
        return NextResponse.json({ error: '绑定会话无效' }, { status: 400 })
      }

      // 该微信身份是否已绑定其他账号
      const existing = await prisma.wechatIdentity.findUnique({
        where: { platform_openId: { platform: 'MINI_PROGRAM', openId: identity.openid } },
      })
      if (existing && existing.userId && existing.userId !== session.userId) {
        return NextResponse.json({ error: '该微信已绑定其他账号' }, { status: 409 })
      }

      await prisma.wechatIdentity.upsert({
        where: { platform_openId: { platform: 'MINI_PROGRAM', openId: identity.openid } },
        create: {
          platform: 'MINI_PROGRAM',
          openId: identity.openid,
          unionId: identity.unionid || null,
          nickname: typeof body?.nickname === 'string' ? body.nickname.slice(0, 100) : null,
          userId: session.userId,
        },
        update: {
          unionId: identity.unionid || null,
          nickname: typeof body?.nickname === 'string' ? body.nickname.slice(0, 100) : null,
          userId: session.userId,
        },
      })

      const ttl = await redis.ttl(getWechatQrKey(qrId))
      await redis.set(
        getWechatQrKey(qrId),
        JSON.stringify({ ...session, status: 'success', bound: true }),
        'EX',
        Math.max(ttl > 0 ? ttl : 300, 60),
      )

      return NextResponse.json({ status: 'bound' })
    }

    // ── 登录模式（原有逻辑）────────────────────────────────────────
    const user = await findOrCreateUserFromWechat({
      ...identity,
      nickname: typeof body?.nickname === 'string' ? body.nickname.slice(0, 100) : null,
    })
    const tokens = await issueAdminTokens({
      id: user.id,
      email: user.email,
      phone: user.phone,
      name: user.name,
      avatarUrl: user.avatarUrl,
      onboardingCompleted: user.onboardingCompleted,
      role: user.role,
      projectAccessScope: user.projectAccessScope,
    })

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        name: user.name,
        avatarUrl: user.avatarUrl,
        onboardingCompleted: user.onboardingCompleted,
        role: user.role,
      },
      needsOnboarding: user.onboardingCompleted === false,
      tokens,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Wechat login failed'
    if (message === 'WECHAT_MINI_NOT_CONFIGURED') {
      return NextResponse.json({ error: 'WeChat mini program is not configured' }, { status: 503 })
    }
    return NextResponse.json({ error: 'Wechat login failed' }, { status: 401 })
  }
}
