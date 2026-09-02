import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { fetchFeishuProfileByOpenId } from '@/lib/feishu'
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
        createdAt: true,
      },
    })

    if (!binding) {
      return NextResponse.json({ bound: false })
    }

    let nickname = binding.nickname
    let avatarUrl = binding.avatarUrl
    if (new URL(request.url).searchParams.get('refresh') === '1') {
      try {
        const profile = await fetchFeishuProfileByOpenId(binding.openId)
        nickname = profile.name || nickname
        avatarUrl = profile.avatarUrl || avatarUrl
        if (nickname !== binding.nickname || avatarUrl !== binding.avatarUrl) {
          await prisma.feishuBinding.update({
            where: { id: binding.id },
            data: { nickname, avatarUrl },
          })
        }
      } catch {
        // Keep the cached OAuth profile when the optional refresh is unavailable.
      }
    }

    return NextResponse.json({
      bound: true,
      nickname,
      avatarUrl,
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
