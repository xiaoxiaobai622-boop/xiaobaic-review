import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { logMessage } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/feishu/unbind
 *
 * Unbind the current user's Feishu account. Historical notification records
 * are intentionally preserved (V1 requirement §25).
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    await prisma.feishuBinding.deleteMany({
      where: { userId: user.id },
    })

    logMessage(`User ${user.id} unbound Feishu account`)

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to unbind Feishu account' },
      { status: 500 }
    )
  }
}
