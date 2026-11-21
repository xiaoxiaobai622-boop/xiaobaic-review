import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth'
import { createSsoCode } from '@/lib/docs-sso'
import { docsPreflight, withDocsCors } from '@/lib/docs-cors'

export const runtime = 'nodejs'

export async function OPTIONS(request: NextRequest) {
  return docsPreflight(request) ?? new NextResponse(null, { status: 204 })
}

export async function POST(request: NextRequest) {
  const auth = await requireApiUser(request)
  if (auth instanceof Response) return auth
  const body = await request.json().catch(() => ({}))
  const redirectUri = typeof body.redirectUri === 'string' ? body.redirectUri : ''
  const state = typeof body.state === 'string' ? body.state : ''
  try {
    const code = await createSsoCode(auth.id, state, redirectUri)
    return withDocsCors(NextResponse.json({ code }))
  } catch (error) {
    return withDocsCors(NextResponse.json({ error: error instanceof Error ? error.message : 'invalid request' }, { status: 400 }))
  }
}
