import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { getFeishuAuthUrl } from '@/lib/feishu'
import { randomBytes } from 'crypto'
import jwt from 'jsonwebtoken'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/feishu/authorize
 *
 * Initiates Feishu OAuth flow. Redirects user to Feishu authorization page.
 * Only authenticated MLE6 users can bind Feishu.
 */
export async function GET(request: NextRequest) {
  try {
    // Try to get user from standard auth methods
    let user = await getCurrentUserFromRequest(request)

    // If not found, try to extract from admin_access cookie or Authorization header
    if (!user) {
      // Check for admin_access token in cookie (fallback)
      const adminAccessCookie = request.cookies.get('admin_access')?.value
      if (adminAccessCookie) {
        try {
          const payload = jwt.verify(adminAccessCookie, process.env.JWT_SECRET!) as any
          if (payload.userId) {
            const { prisma } = await import('@/lib/db')
            user = await prisma.user.findUnique({
              where: { id: payload.userId },
              select: {
                id: true,
                email: true,
                phone: true,
                name: true,
                avatarUrl: true,
                onboardingCompleted: true,
                role: true,
                projectAccessScope: true
              },
            })
          }
        } catch (e) {
          // Invalid token, continue
        }
      }
    }

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Generate random state token to prevent CSRF
    const state = randomBytes(32).toString('hex')

    // Store state in httpOnly cookie (expires in 10 minutes)
    const response = NextResponse.redirect(getFeishuAuthUrl(state))
    response.cookies.set('feishu_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600, // 10 minutes
      path: '/',
    })

    // Also store userId to complete binding after callback
    response.cookies.set('feishu_oauth_user_id', user.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600,
      path: '/',
    })

    return response
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to initiate Feishu authorization' },
      { status: 500 }
    )
  }
}
