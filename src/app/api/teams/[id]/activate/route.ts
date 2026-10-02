import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Retired with the card-key system: the beta grants every team its entitlement
 * directly, so there is nothing left to activate with a code. 410 rather than
 * removing the route so an already-shipped client page hears "this is gone",
 * not "this never existed".
 */
export async function POST() {
  return NextResponse.json(
    { error: '卡密已下线，内测期无需激活' },
    { status: 410 },
  )
}
