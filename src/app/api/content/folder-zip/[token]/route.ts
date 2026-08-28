import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getRedis, consumeTokenAtomically } from '@/lib/redis'
import { downloadFile, sanitizeFilenameForHeader } from '@/lib/storage'
import { ZipArchive } from 'archiver'
import { Readable } from 'stream'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const redis = getRedis()
    const tokenKey = `folder_zip_download:${token}`
    const raw = await redis.get(tokenKey)
    if (!raw) return NextResponse.json({ error: 'Invalid or expired download link' }, { status: 403 })

    const tokenData = JSON.parse(raw) as {
      projectId: string
      folderId: string
      videos: Array<{ id: string; name: string; versionLabel: string; path: string; fileName: string }>
    }
    const folder = await prisma.projectFolder.findFirst({ where: { id: tokenData.folderId, projectId: tokenData.projectId } })
    if (!folder) return NextResponse.json({ error: 'Folder not found' }, { status: 404 })
    const consumed = await consumeTokenAtomically(redis, tokenKey, raw)
    if (!consumed) return NextResponse.json({ error: 'Invalid or expired download link' }, { status: 403 })

    const archive = new ZipArchive({ store: true })
    archive.on('error', (error) => logError('[DOWNLOAD] Folder ZIP archive error:', error))
    let appendedCount = 0
    for (const video of tokenData.videos) {
      try {
        const stream = await downloadFile(video.path)
        const extension = video.fileName?.match(/\.[^.]+$/)?.[0] || '.mp4'
        archive.append(stream, { name: `${video.name}_${video.versionLabel}${extension}` })
        appendedCount += 1
      } catch (error) {
        logError(`[DOWNLOAD] Failed to add folder video ${video.id}:`, error)
      }
    }
    if (appendedCount === 0) return NextResponse.json({ error: 'No downloadable videos found' }, { status: 404 })
    void archive.finalize()
    const readableStream = Readable.toWeb(archive as any) as ReadableStream
    const filename = sanitizeFilenameForHeader(`${folder.name}.zip`)
    return new NextResponse(readableStream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-cache',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    logError('[DOWNLOAD] Folder ZIP download error:', error)
    return NextResponse.json({ error: 'Download failed' }, { status: 500 })
  }
}
