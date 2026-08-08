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
    select: { id: true, nickname: true, avatarUrl: true, unionId: true },
  })
  if (!identity) return NextResponse.json({ configured: isWechatWebConfigured(), authenticated: false })

  return NextResponse.json({
    configured: isWechatWebConfigured(),
    authenticated: true,
    user: { id: identity.id, name: identity.nickname, avatarUrl: identity.avatarUrl, linkedForMiniProgram: Boolean(identity.unionId) },
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
