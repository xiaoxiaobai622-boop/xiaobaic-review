import { NextRequest } from 'next/server'
import { requirePlatformAuth } from '@/lib/auth'
import { createSupportInboxStream } from '@/lib/support/stream'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = await requirePlatformAuth(request)
  if (auth instanceof Response) return auth
  return createSupportInboxStream({ signal: request.signal })
}
