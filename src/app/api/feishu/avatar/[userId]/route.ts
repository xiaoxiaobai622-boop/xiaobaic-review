import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FEISHU_IMAGE_HOSTS = new Set([
  'open.feishu.cn',
  'open.larksuite.com',
  'sf3-cn.feishucdn.com',
  'sf3-sg.feishucdn.com',
])

/** Proxy the OAuth-provided Feishu avatar through our own origin for CSP. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const user = await getCurrentUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { userId } = await params
  const binding = await prisma.feishuBinding.findUnique({
    where: { userId },
    select: { avatarUrl: true },
  })
  if (!binding?.avatarUrl) return new NextResponse(null, { status: 404 })

  let avatarUrl: URL
  try {
    avatarUrl = new URL(binding.avatarUrl)
  } catch {
    return new NextResponse(null, { status: 404 })
  }
  const isFeishuCdn = avatarUrl.hostname.endsWith('.feishucdn.com')
    || avatarUrl.hostname.endsWith('.larksuitecdn.com')
  if (avatarUrl.protocol !== 'https:' || (!FEISHU_IMAGE_HOSTS.has(avatarUrl.hostname) && !isFeishuCdn)) {
    return new NextResponse(null, { status: 404 })
  }

  try {
    const response = await fetch(avatarUrl, { cache: 'no-store', redirect: 'manual' })
    if (!response.ok) return new NextResponse(null, { status: 404 })

    const contentType = response.headers.get('content-type') || ''
    if (!contentType.startsWith('image/')) return new NextResponse(null, { status: 404 })

    return new NextResponse(response.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=300, stale-while-revalidate=3600',
      },
    })
  } catch {
    return new NextResponse(null, { status: 404 })
  }
}
