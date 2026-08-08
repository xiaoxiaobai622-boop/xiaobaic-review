import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import {
  safeWechatReturnUrl,
  signWechatSession,
  WECHAT_RETURN_COOKIE,
  WECHAT_SESSION_COOKIE,
  WECHAT_STATE_COOKIE,
} from '@/lib/wechat-auth'

export const runtime = 'nodejs'

function redirectWithResult(request: NextRequest, returnUrl: string, result: 'success' | 'failed') {
  const target = new URL(safeWechatReturnUrl(returnUrl), request.nextUrl.origin)
  target.searchParams.set('wechat', result)
  const response = NextResponse.redirect(target)
  response.cookies.delete(WECHAT_STATE_COOKIE)
  response.cookies.delete(WECHAT_RETURN_COOKIE)
  return response
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const state = request.nextUrl.searchParams.get('state')
  const expectedState = request.cookies.get(WECHAT_STATE_COOKIE)?.value
  const returnUrl = request.cookies.get(WECHAT_RETURN_COOKIE)?.value || '/portal'

  if (!code || !state || !expectedState || state !== expectedState) {
    return redirectWithResult(request, returnUrl, 'failed')
  }

  try {
    const tokenUrl = new URL('https://api.weixin.qq.com/sns/oauth2/access_token')
    tokenUrl.searchParams.set('appid', process.env.WECHAT_WEB_APP_ID || '')
    tokenUrl.searchParams.set('secret', process.env.WECHAT_WEB_APP_SECRET || '')
    tokenUrl.searchParams.set('code', code)
    tokenUrl.searchParams.set('grant_type', 'authorization_code')
    const tokenResponse = await fetch(tokenUrl, { cache: 'no-store' })
    const tokenData = await tokenResponse.json()
    if (!tokenResponse.ok || !tokenData.access_token || !tokenData.openid) throw new Error('Wechat token exchange failed')

    const profileUrl = new URL('https://api.weixin.qq.com/sns/userinfo')
    profileUrl.searchParams.set('access_token', tokenData.access_token)
    profileUrl.searchParams.set('openid', tokenData.openid)
    profileUrl.searchParams.set('lang', 'zh_CN')
    const profileResponse = await fetch(profileUrl, { cache: 'no-store' })
    const profile = await profileResponse.json()
    if (!profileResponse.ok || profile.errcode) throw new Error('Wechat profile request failed')

    const identity = await prisma.wechatIdentity.upsert({
      where: { platform_openId: { platform: 'WEB', openId: tokenData.openid } },
      create: {
        platform: 'WEB',
        openId: tokenData.openid,
        unionId: profile.unionid || tokenData.unionid || null,
        nickname: typeof profile.nickname === 'string' ? profile.nickname.slice(0, 100) : null,
        avatarUrl: typeof profile.headimgurl === 'string' ? profile.headimgurl.slice(0, 1000) : null,
      },
      update: {
        unionId: profile.unionid || tokenData.unionid || null,
        nickname: typeof profile.nickname === 'string' ? profile.nickname.slice(0, 100) : null,
        avatarUrl: typeof profile.headimgurl === 'string' ? profile.headimgurl.slice(0, 1000) : null,
      },
    })

    const response = redirectWithResult(request, returnUrl, 'success')
    response.cookies.set(WECHAT_SESSION_COOKIE, signWechatSession(identity), {
      httpOnly: true,
      sameSite: 'lax',
      secure: request.nextUrl.protocol === 'https:',
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    })
    return response
  } catch {
    return redirectWithResult(request, returnUrl, 'failed')
  }
}
