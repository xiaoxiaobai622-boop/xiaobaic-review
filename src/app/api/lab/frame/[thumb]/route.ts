import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { downloadFile, fileExists } from '@/lib/storage'
import { logError } from '@/lib/logging'

// Local-only: /lab renders real frames for the videos the dev database has.
// Production keeps thumbnails behind the signed-token content routes.
const DEV_ONLY = process.env.NODE_ENV !== 'production'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ thumb: string }> }) {
  if (!DEV_ONLY) return new NextResponse('Not found', { status: 404 })

  const { thumb } = await params
  const index = Number.parseInt(thumb, 10)
  if (!Number.isInteger(index) || index < 0 || index > 99) return new NextResponse('Bad request', { status: 400 })

  try {
    const videos = await prisma.video.findMany({
      where: { thumbnailPath: { not: null } },
      select: { thumbnailPath: true },
      orderBy: { createdAt: 'asc' },
      take: 100,
    })
    const pick = videos[index % videos.length]
    if (!pick?.thumbnailPath || !(await fileExists(pick.thumbnailPath))) {
      return new NextResponse('Missing', { status: 404 })
    }
    const stream = await downloadFile(pick.thumbnailPath)
    return new NextResponse(stream as unknown as ReadableStream, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-store',
        'X-Frame-Options': 'SAMEORIGIN',
      },
    })
  } catch (err) {
    logError('lab frame failed:', err)
    return new NextResponse('Error', { status: 500 })
  }
}
