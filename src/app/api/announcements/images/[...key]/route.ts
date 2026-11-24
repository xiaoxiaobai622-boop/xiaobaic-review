import { NextRequest, NextResponse } from 'next/server'
import { downloadFile, fileExists } from '@/lib/storage'
import {
  announcementImageContentType,
  announcementImageStorageKey,
  isAnnouncementImagePublicKey,
} from '@/lib/announcements/image'
import type { Readable } from 'node:stream'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

/**
 * GET /api/announcements/images/[...key] — intentionally anonymous.
 * Release cards are shown to signed-in users and must also open directly in a
 * fresh/private window, so the bytes are served by the app from the existing
 * storage provider instead of exposing a private bucket or a presigned URL.
 * Only generated `whats-new/*` keys are readable; everything else is 404.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key } = await params
  const publicKey = key.join('/')
  if (!isAnnouncementImagePublicKey(publicKey)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const contentType = announcementImageContentType(publicKey)
  if (!contentType) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const storageKey = announcementImageStorageKey(publicKey)
  try {
    if (!(await fileExists(storageKey))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const data = await readAll(await downloadFile(storageKey))
    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(data.byteLength),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}