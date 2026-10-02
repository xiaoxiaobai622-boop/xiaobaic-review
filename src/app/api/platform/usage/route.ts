import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAuth } from '@/lib/auth'
import { USAGE_DEFAULT_DAYS, USAGE_MAX_DAYS, getPlatformUsage } from '@/lib/platform-usage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const user = await requirePlatformAuth(request)
  if (user instanceof Response) return user

  const raw = request.nextUrl.searchParams.get('days')
  const parsed = raw === null ? Number.NaN : Number(raw)
  const days = Number.isInteger(parsed)
    ? Math.min(Math.max(parsed, 1), USAGE_MAX_DAYS)
    : USAGE_DEFAULT_DAYS

  return NextResponse.json(await getPlatformUsage(days))
}
