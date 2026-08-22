import { prisma } from '@/lib/db'
import { hashPassword } from '@/lib/encryption'
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

  const response = await fetch(url, { cache: 'no-store' })
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
