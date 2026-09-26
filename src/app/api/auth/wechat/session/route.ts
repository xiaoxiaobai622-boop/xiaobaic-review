import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { isWechatWebConfigured, verifyWechatSession, WECHAT_SESSION_COOKIE } from '@/lib/wechat-auth'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const token = request.cookies.get(WECHAT_SESSION_COOKIE)?.value
  const payload = token ? verifyWechatSession(token) : null
  if (!payload) return NextResponse.json({ configured: isWechatWebConfigured(), authenticated: false })

  const identity = await prisma.wechatIdentity.findUnique({
    where: { id: payload.identityId },
    select: { id: true, nickname: true, avatarUrl: true, unionId: true, user: { select: { name: true, phone: true } } },
  })
  if (!identity) return NextResponse.json({ configured: isWechatWebConfigured(), authenticated: false })

  // A scan that granted no nickname still has the linked account's name — the
  // mini-program flow writes 微信用户 there. Without this the reviewer identity
  // reaching the upload panel is null and 上传者 falls back to 匿名.
  const displayName = identity.nickname || identity.user?.name || identity.user?.phone || '微信用户'

  return NextResponse.json({
    configured: isWechatWebConfigured(),
    authenticated: true,
    user: { id: identity.id, name: displayName, avatarUrl: identity.avatarUrl, linkedForMiniProgram: Boolean(identity.unionId) },
  })
}

export async function DELETE(request: NextRequest) {
  const response = NextResponse.json({ success: true })
  response.cookies.set(WECHAT_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: request.nextUrl.protocol === 'https:',
    path: '/',
    maxAge: 0,
  })
  return response
}
