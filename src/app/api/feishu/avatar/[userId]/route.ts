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

// Bounds the wait for Feishu to answer. It is cleared as soon as headers arrive so the
// image itself streams without a cap — a slow but healthy download must not be cut off.
const AVATAR_CONNECT_TIMEOUT_MS = 10_000

/** Every rejection answers as the same bare 404, so probes cannot tell why it failed. */
function avatarUnavailable(): NextResponse {
  return new NextResponse(null, { status: 404 })
}

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
  if (!binding?.avatarUrl) return avatarUnavailable()

  let avatarUrl: URL
  try {
    avatarUrl = new URL(binding.avatarUrl)
  } catch {
    return avatarUnavailable()
  }
  const isFeishuCdn = avatarUrl.hostname.endsWith('.feishucdn.com')
    || avatarUrl.hostname.endsWith('.larksuitecdn.com')
  if (avatarUrl.protocol !== 'https:' || (!FEISHU_IMAGE_HOSTS.has(avatarUrl.hostname) && !isFeishuCdn)) {
    return avatarUnavailable()
  }

  try {
    const controller = new AbortController()
    const connectTimer = setTimeout(() => controller.abort(), AVATAR_CONNECT_TIMEOUT_MS)
    const response = await fetch(avatarUrl, {
      cache: 'no-store',
      redirect: 'manual',
      signal: controller.signal,
    }).finally(() => clearTimeout(connectTimer))
    if (!response.ok) return avatarUnavailable()

    const contentType = response.headers.get('content-type') || ''
    if (!contentType.startsWith('image/')) return avatarUnavailable()

    return new NextResponse(response.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=300, stale-while-revalidate=3600',
      },
    })
  } catch {
    return avatarUnavailable()
  }
}
