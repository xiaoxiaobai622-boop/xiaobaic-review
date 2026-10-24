import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getRedis } from '@/lib/redis'
import { issueAdminTokens } from '@/lib/auth'
import { bindWechatPhone, exchangeMiniProgramCode, findOrCreateUserFromWechat } from '@/lib/wechat-mini-auth'
import { getWechatQrKey } from '@/lib/wechat-mini-login'
import { rateLimit } from '@/lib/rate-limit'
import { logError } from '@/lib/logging'
import { exchangeWechatPhoneCode, WechatPhoneError } from '@/lib/wechat-mini-phone'
import { bindPhoneToWechatUser } from '@/lib/wechat-account-merge'

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
  const nickname = typeof body?.nickname === 'string' ? body.nickname.slice(0, 100) : null
  const avatarUrl = typeof body?.avatarUrl === 'string' ? body.avatarUrl.slice(0, 1000) : null
  // 小程序「手机号快速验证组件」的 code；登录模式没有它且账号无手机号时，要求先授权。
  const phoneCode = typeof body?.phoneCode === 'string' ? body.phoneCode.trim().slice(0, 512) : ''

  try {
    const identity = await exchangeMiniProgramCode(code)

    // ── 绑定模式：把微信身份关联到当前已登录用户 ─────────────────────
    if (mode === 'bind' && qrId) {
      const redis = getRedis()
      const qrKey = getWechatQrKey(qrId)
      const raw = await redis.get(qrKey)
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
          nickname,
          userId: session.userId,
        },
        update: {
          unionId: identity.unionid || null,
          nickname,
          userId: session.userId,
        },
      })

      if (phoneCode) {
        const phoneResult = await bindWechatPhone(session.userId, phoneCode)
        if (phoneResult === 'conflict') {
          return NextResponse.json({ error: '该手机号已绑定其他账号', code: 'PHONE_ACCOUNT_CONFLICT' }, { status: 409 })
        }
      }

      const ttl = await redis.ttl(qrKey)
      await redis.set(
        qrKey,
        JSON.stringify({ ...session, status: 'success', bound: true }),
        'EX',
        Math.max(ttl > 0 ? ttl : 300, 60),
      )

      return NextResponse.json({ status: 'bound' })
    }

    // ── 登录模式：手机号是账号主键；号码已有账号就合并到那个账号 ──────
    const wechatUser = await findOrCreateUserFromWechat({
      ...identity,
      nickname,
    })

    let user = wechatUser
    let merged = false
    if (phoneCode) {
      const phone = await exchangeWechatPhoneCode(phoneCode)
      const bound = await bindPhoneToWechatUser({
        userId: wechatUser.id,
        phone,
        nickname,
        avatarUrl,
      })
      user = bound.user
      merged = bound.merged
    } else if (!wechatUser.phone) {
      return NextResponse.json({ needsPhone: true })
    }

    if (user.phone && (!user.onboardingCompleted || !user.name)) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          ...(user.onboardingCompleted ? {} : { onboardingCompleted: true }),
          ...(user.name ? {} : { name: user.phone.slice(-4) }),
        },
      })
    }

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
      accountMerged: merged,
      tokens,
    })
  } catch (error) {
    if (error instanceof WechatPhoneError) {
      const messages: Record<string, string> = {
        PHONE_CODE_MISSING: '需要授权手机号',
        PHONE_CODE_INVALID: '手机号授权已失效，请重试',
        PHONE_UNSUPPORTED_REGION: '暂不支持中国大陆以外的手机号',
        PHONE_INVALID: '手机号格式无效',
        PHONE_EXCHANGE_FAILED: '手机号获取失败，请稍后重试',
      }
      return NextResponse.json({
        error: messages[error.code] || '手机号获取失败，请稍后重试',
        code: error.code,
      }, { status: 400 })
    }

    const message = error instanceof Error ? error.message : 'Wechat login failed'
    if (message === 'WECHAT_MINI_NOT_CONFIGURED') {
      return NextResponse.json({ error: 'WeChat mini program is not configured' }, { status: 503 })
    }
    logError('Wechat mini program login failed:', error)
    return NextResponse.json({ error: 'Wechat login failed' }, { status: 401 })
  }
}
