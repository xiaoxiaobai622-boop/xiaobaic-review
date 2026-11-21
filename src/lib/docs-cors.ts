import { NextRequest, NextResponse } from 'next/server'

export const DOCS_APP_ORIGIN = 'https://docs.vidx.cn'
const HEADERS = {
  'Access-Control-Allow-Origin': DOCS_APP_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-ViTransfer-Device-ID',
  'Access-Control-Max-Age': '600',
  Vary: 'Origin',
}

export function isDocsOriginAllowed(request: NextRequest) {
  return request.headers.get('origin') === DOCS_APP_ORIGIN
}

export function docsPreflight(request: NextRequest) {
  if (request.method !== 'OPTIONS') return null
  if (!isDocsOriginAllowed(request)) return new NextResponse(null, { status: 403 })
  return new NextResponse(null, { status: 204, headers: HEADERS })
}

export function withDocsCors(response: NextResponse) {
  for (const [key, value] of Object.entries(HEADERS)) response.headers.set(key, value)
  return response
}
