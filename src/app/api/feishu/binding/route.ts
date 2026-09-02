import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/db'
import {
  fetchFeishuProfileByOpenId,
  fetchFeishuProfileByUserAccessToken,
  refreshFeishuUserAccessToken,
} from '@/lib/feishu'
import { decrypt, encrypt } from '@/lib/encryption'
import { logMessage } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/feishu/binding
 *
 * Get current user's Feishu binding status.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const binding = await prisma.feishuBinding.findUnique({
      where: { userId: user.id },
      select: {
        id: true,
        openId: true,
        nickname: true,
        avatarUrl: true,
        userAccessTokenEncrypted: true,
        refreshTokenEncrypted: true,
        tokenExpiresAt: true,
        createdAt: true,
      },
    })

    if (!binding) {
      return NextResponse.json({ bound: false })
    }

    let nickname = binding.nickname
    let avatarUrl = binding.avatarUrl
    let profileSyncError: string | undefined
    if (new URL(request.url).searchParams.get('refresh') === '1') {
      try {
        let accessToken = binding.userAccessTokenEncrypted
          ? decrypt(binding.userAccessTokenEncrypted)
          : null
        let refreshToken = binding.refreshTokenEncrypted
          ? decrypt(binding.refreshTokenEncrypted)
          : null
        let tokenExpiresAt = binding.tokenExpiresAt

        if ((!accessToken || !tokenExpiresAt || tokenExpiresAt.getTime() <= Date.now() + 60_000) && refreshToken) {
          const refreshed = await refreshFeishuUserAccessToken(refreshToken)
          accessToken = refreshed.accessToken
          refreshToken = refreshed.refreshToken || refreshToken
          tokenExpiresAt = refreshed.expiresIn ? new Date(Date.now() + refreshed.expiresIn * 1000) : null
          await prisma.feishuBinding.update({
            where: { id: binding.id },
            data: {
              userAccessTokenEncrypted: encrypt(accessToken),
              refreshTokenEncrypted: encrypt(refreshToken),
              tokenExpiresAt,
            },
          })
        }

        const profile = accessToken
          ? await fetchFeishuProfileByUserAccessToken(accessToken)
          : await fetchFeishuProfileByOpenId(binding.openId)
        nickname = profile.name || nickname
        avatarUrl = profile.avatarUrl || avatarUrl
        if (nickname !== binding.nickname || avatarUrl !== binding.avatarUrl) {
          await prisma.feishuBinding.update({
            where: { id: binding.id },
            data: { nickname, avatarUrl },
          })
        }
      } catch (error) {
        profileSyncError = error instanceof Error && /Access denied|99991672/i.test(error.message)
          ? '飞书应用未开通通讯录读取权限，请重新绑定飞书以更新资料。'
          : '飞书资料暂时无法同步，请稍后重试。'
      }
    }

    return NextResponse.json({
      bound: true,
      nickname,
      avatarUrl,
      profileSyncError,
      boundAt: binding.createdAt.toISOString(),
    })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch binding status' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/feishu/binding
 *
 * Unbind current user's Feishu account.
 */
export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    await prisma.feishuBinding.delete({
      where: { userId: user.id },
    })

    logMessage(`User ${user.id} unbound Feishu account`)

    return NextResponse.json({ success: true })
  } catch (error) {
    // Not found is also success (already unbound)
    if ((error as any).code === 'P2025') {
      return NextResponse.json({ success: true })
    }

    return NextResponse.json(
      { error: 'Failed to unbind Feishu account' },
      { status: 500 }
    )
  }
}
