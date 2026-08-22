import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { handleWechatMediaCheckCallback } from '@/lib/wechat-content-security'
import { logWarn } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function validWechatSignature(
  signature: string | null,
  timestamp: string | null,
  nonce: string | null,
): boolean {
  const token = process.env.WECHAT_MINI_MSG_TOKEN?.trim()
  if (!token || !signature || !timestamp || !nonce) return false

  const expected = crypto
    .createHash('sha1')
    .update([token, timestamp, nonce].sort().join(''))
    .digest('hex')
  if (expected.length !== signature.length) return false
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signature),
  )
}

function extractXmlValue(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))
  return match?.[1]?.trim() || ''
}

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams
  if (!validWechatSignature(search.get('signature'), search.get('timestamp'), search.get('nonce'))) {
    return new NextResponse('Invalid signature', { status: 403 })
  }
  return new NextResponse(search.get('echostr') || '')
}

export async function POST(request: NextRequest) {
  const search = request.nextUrl.searchParams
  if (!validWechatSignature(search.get('signature'), search.get('timestamp'), search.get('nonce'))) {
    return new NextResponse('Invalid signature', { status: 403 })
  }

  const xml = await request.text()
  const traceId = extractXmlValue(xml, 'trace_id')
  if (!traceId) {
    logWarn('Wechat media check callback missing trace_id')
    return new NextResponse('success')
  }

  const errcode = Number(extractXmlValue(xml, 'errcode') || '0')
  const suggest = extractXmlValue(xml, 'suggest')
  const isrisky = Number(extractXmlValue(xml, 'isrisky') || '0')

  await handleWechatMediaCheckCallback({ traceId, errcode, suggest, isrisky })
  return new NextResponse('success')
}
