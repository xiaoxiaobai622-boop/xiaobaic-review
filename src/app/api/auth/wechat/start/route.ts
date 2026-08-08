import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { isWechatWebConfigured, safeWechatReturnUrl, WECHAT_RETURN_COOKIE, WECHAT_STATE_COOKIE } from '@/lib/wechat-auth'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const returnUrl = safeWechatReturnUrl(request.nextUrl.searchParams.get('returnUrl'))
  if (!isWechatWebConfigured()) {
    const target = new URL(returnUrl, request.nextUrl.origin)
    target.searchParams.set('wechat', 'not_configured')
    return NextResponse.redirect(target)
  }

  const state = crypto.randomBytes(24).toString('base64url')
  const callbackUrl = process.env.WECHAT_OAUTH_REDIRECT_URI
    || `${request.nextUrl.origin}/api/auth/wechat/callback`
  const authorizeUrl = new URL('https://open.weixin.qq.com/connect/qrconnect')
  authorizeUrl.searchParams.set('appid', process.env.WECHAT_WEB_APP_ID!)
  authorizeUrl.searchParams.set('redirect_uri', callbackUrl)
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('scope', 'snsapi_login')
  authorizeUrl.searchParams.set('state', state)

  const response = NextResponse.redirect(`${authorizeUrl.toString()}#wechat_redirect`)
  const secure = request.nextUrl.protocol === 'https:'
  response.cookies.set(WECHAT_STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 600 })
  response.cookies.set(WECHAT_RETURN_COOKIE, returnUrl, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 600 })
  return response
}
