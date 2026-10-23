import { prisma } from '@/lib/db'
import { hashPassword } from '@/lib/encryption'
import { logError } from '@/lib/logging'
import { normalizePhone, phoneStoreFields, wherePhone } from '@/lib/phone-field'
import { getWechatMiniAccessToken } from '@/lib/wechat-mini-login'
import { randomBytes } from 'crypto'

export interface MiniWechatIdentity {
  openid: string
  unionid?: string | null
  nickname?: string | null
}

export async function exchangeMiniProgramCode(code: string): Promise<MiniWechatIdentity> {
  const appId = process.env.WECHAT_MINI_APP_ID?.trim()
  const secret = process.env.WECHAT_MINI_APP_SECRET?.trim()
  if (!appId || !secret) throw new Error('WECHAT_MINI_NOT_CONFIGURED')

  const url = new URL('https://api.weixin.qq.com/sns/jscode2session')
  url.searchParams.set('appid', appId)
  url.searchParams.set('secret', secret)
  url.searchParams.set('js_code', code)
  url.searchParams.set('grant_type', 'authorization_code')

  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
  const data = await response.json()
  if (!response.ok || !data.openid) {
    throw new Error(data.errmsg || 'WECHAT_CODE_EXCHANGE_FAILED')
  }

  return {
    openid: data.openid,
    unionid: data.unionid || null,
    nickname: null,
  }
}

function localEmailForOpenid(openid: string) {
  return `wechat-${openid.slice(0, 24)}@wechat.local`
}

function localUsernameForOpenid(openid: string) {
  return `wx_${openid.slice(0, 20)}`
}

export async function findOrCreateUserFromWechat(identity: MiniWechatIdentity) {
  const existingIdentity = await prisma.wechatIdentity.findUnique({
    where: { platform_openId: { platform: 'MINI_PROGRAM', openId: identity.openid } },
    include: { user: true },
  })
  if (existingIdentity?.user) return existingIdentity.user

  const linkedByIdentity = identity.unionid
    ? await prisma.wechatIdentity.findFirst({
        where: { unionId: identity.unionid, userId: { not: null } },
        include: { user: true },
        orderBy: { createdAt: 'asc' },
      })
    : null
  if (linkedByIdentity?.user) return linkedByIdentity.user

  const email = localEmailForOpenid(identity.openid)
  const username = localUsernameForOpenid(identity.openid)
  const password = await hashPassword(randomBytes(24).toString('hex'))

  const user = await prisma.$transaction(async (tx) => {
    const existingByEmail = await tx.user.findUnique({ where: { email } })
    if (existingByEmail) return existingByEmail

    const created = await tx.user.create({
      data: {
        email,
        username,
        password,
        name: identity.nickname || null,
        role: 'MEMBER',
        projectAccessScope: 'ASSIGNED_ONLY',
        onboardingCompleted: false,
      },
    })

    await tx.wechatIdentity.upsert({
      where: { platform_openId: { platform: 'MINI_PROGRAM', openId: identity.openid } },
      create: {
        platform: 'MINI_PROGRAM',
        openId: identity.openid,
        unionId: identity.unionid || null,
        nickname: identity.nickname || null,
        userId: created.id,
      },
      update: {
        unionId: identity.unionid || null,
        nickname: identity.nickname || null,
        userId: created.id,
      },
    })

    return created
  })

  return user
}

/**
 * 微信「手机号快速验证组件」给的是另一枚 code（不是登录 code）：
 * 小程序端 <button open-type="getPhoneNumber"> 回调里的 `e.detail.code`，拿它来这里换真实号码。
 * 失败一律返回 null——绑定不了不该把登录一起弄挂。
 */
export async function exchangeMiniProgramPhoneCode(code: string): Promise<string | null> {
  const trimmed = code.trim()
  if (!trimmed) return null
  try {
    const accessToken = await getWechatMiniAccessToken()
    const response = await fetch(
      `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: trimmed }),
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      },
    )
    const data = await response.json().catch(() => null) as
      | { errcode?: number; errmsg?: string; phone_info?: { purePhoneNumber?: string; phoneNumber?: string } }
      | null
    if (!response.ok || !data || data.errcode) {
      logError('Wechat phone exchange failed:', data?.errmsg || data?.errcode || response.status)
      return null
    }
    return normalizePhone(data.phone_info?.purePhoneNumber || data.phone_info?.phoneNumber || null)
  } catch (error) {
    logError('Wechat phone exchange crashed:', error)
    return null
  }
}

/**
 * 把微信授权的号码绑到这个账号。已有号码不覆盖（改号走个人中心那套双验证）；
 * 号码已被别的账号占用时返回 conflict，由路由回 409 让小程序提示。
 */
export async function bindWechatPhone(
  userId: string,
  phoneCode: string,
): Promise<'bound' | 'conflict' | 'failed' | 'skipped'> {
  const phone = await exchangeMiniProgramPhoneCode(phoneCode)
  if (!phone) return 'failed'

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true } })
  if (!user) return 'failed'
  if (user.phone) return 'skipped'

  const phoneWhere = wherePhone(phone)
  if (!phoneWhere) return 'failed'
  const taken = await prisma.user.findFirst({
    where: { ...phoneWhere, NOT: { id: userId } },
    select: { id: true },
  })
  if (taken) return 'conflict'

  await prisma.user.update({ where: { id: userId }, data: phoneStoreFields(phone) })
  return 'bound'
}
