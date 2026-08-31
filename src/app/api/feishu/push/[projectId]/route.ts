import { NextRequest } from 'next/server'
import { POST as executePush } from '../route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Backwards-compatible POST endpoint for clients released before the push
 * endpoint was consolidated at /api/feishu/push.
 */
export async function POST(request: NextRequest) {
  const url = new URL(request.url)
  const pathParts = url.pathname.split('/').filter(Boolean)
  const projectId = pathParts[pathParts.length - 1]
  const videoId = url.searchParams.get('videoId') || undefined
  const body = await request.json().catch(() => ({}))

  const forwardedHeaders = new Headers(request.headers)
  forwardedHeaders.delete('content-length')

  const forwardedRequest = new NextRequest(request.url, {
    method: 'POST',
    headers: forwardedHeaders,
    body: JSON.stringify({
      ...body,
      scope: videoId ? 'video' : 'project',
      projectId,
      ...(videoId ? { videoId } : {}),
    }),
  })

  return executePush(forwardedRequest)
}
