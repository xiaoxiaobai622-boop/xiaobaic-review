import { NextRequest, NextResponse } from 'next/server'
import { prisma, LIVE_VIDEO } from '@/lib/db'
import { getRedis, consumeTokenAtomically } from '@/lib/redis'
import { downloadFile } from '@/lib/storage'
import { buildZipEntryName, contentDispositionAttachment } from '@/lib/download-names'
import { ZipArchive } from 'archiver'
import { Readable } from 'stream'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const redis = getRedis()
    const tokenKey = `video_zip_download:${token}`
    const raw = await redis.get(tokenKey)
    if (!raw) return NextResponse.json({ error: 'Invalid or expired download link' }, { status: 403 })

    const tokenData = JSON.parse(raw) as {
      projectId: string
      videos: Array<{ id: string; name: string; versionLabel: string; path: string; fileName: string }>
    }
    const project = await prisma.project.findFirst({
      where: { id: tokenData.projectId },
      select: { title: true },
    })
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const consumed = await consumeTokenAtomically(redis, tokenKey, raw)
    if (!consumed) return NextResponse.json({ error: 'Invalid or expired download link' }, { status: 403 })

    // A video trashed after the token was issued must not leak into the archive.
    const liveIds = new Set((await prisma.video.findMany({
      where: {
        id: { in: tokenData.videos.map((video) => video.id) },
        projectId: tokenData.projectId,
        ...LIVE_VIDEO,
      },
      select: { id: true },
    })).map((video) => video.id))

    const archive = new ZipArchive({ store: true })
    archive.on('error', (error) => logError('[DOWNLOAD] Selection ZIP archive error:', error))
    const takenEntryNames = new Set<string>()
    let appendedCount = 0
    for (const video of tokenData.videos) {
      if (!liveIds.has(video.id)) continue
      try {
        const stream = await downloadFile(video.path)
        archive.append(stream, { name: buildZipEntryName(takenEntryNames, video.name, video.versionLabel, video.fileName) })
        appendedCount += 1
      } catch (error) {
        logError(`[DOWNLOAD] Failed to add selected video ${video.id}:`, error)
      }
    }
    if (appendedCount === 0) return NextResponse.json({ error: 'No downloadable videos found' }, { status: 404 })
    void archive.finalize()

    const readableStream = Readable.toWeb(archive as any) as ReadableStream
    const zipName = `${project.title}.zip`
    return new NextResponse(readableStream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': contentDispositionAttachment(zipName),
        'Cache-Control': 'private, no-cache',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    logError('[DOWNLOAD] Selection ZIP download error:', error)
    return NextResponse.json({ error: 'Download failed' }, { status: 500 })
  }
}
