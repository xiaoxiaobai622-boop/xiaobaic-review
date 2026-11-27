import { NextResponse } from 'next/server'
import { Readable } from 'node:stream'
import { downloadFile } from '@/lib/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KEY_PATTERN = /^[a-f0-9]{32}\.webp$/

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params
  if (!KEY_PATTERN.test(key)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    const stream = await downloadFile(`project-covers/${key}`)
    return new NextResponse(Readable.toWeb(stream) as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}