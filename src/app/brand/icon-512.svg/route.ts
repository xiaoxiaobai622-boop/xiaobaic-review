import { NextResponse } from 'next/server'
import { buildFaviconSvg } from '@/lib/brand'

export const runtime = 'nodejs'
export const revalidate = 0

export async function GET() {
  return new NextResponse(buildFaviconSvg(512), {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=0, s-maxage=0',
    },
  })
}
