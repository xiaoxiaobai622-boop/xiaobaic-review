import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logError, logMessage } from '@/lib/logging'
import {
  local1080OutputKey,
  parseLocal1080CallbackBody,
  sanitizeLocal1080Error,
  verifyBearerToken,
} from '@/lib/local-1080'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Callback from the docs transcode worker (scripts/local-1080-worker.py).
 *
 * This route only ever touches the 1080 rendition columns. The video's main
 * `status` and its 720p HLS path belong to the MPS pipeline and must not be
 * changed by a late or failed background job.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.LOCAL_1080_WORKER_SECRET?.trim()
  if (!secret) {
    return NextResponse.json({ error: 'local 1080 callback is not configured' }, { status: 503 })
  }
  if (!verifyBearerToken(request.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const parsed = parseLocal1080CallbackBody(body)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  const { videoId, status, outputKey, error } = parsed.data

  try {
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      select: {
        id: true,
        projectId: true,
        project: { select: { teamId: true } },
      },
    })
    if (!video) {
      return NextResponse.json({ error: 'video not found' }, { status: 404 })
    }

    if (status === 'READY') {
      // Never trust a key from the wire: recompute the one key this video owns.
      const expectedKey = local1080OutputKey(video.project.teamId, video.projectId, video.id)
      if (!outputKey || outputKey !== expectedKey) {
        return NextResponse.json({ error: 'outputKey does not match this video' }, { status: 400 })
      }

      await prisma.video.update({
        where: { id: video.id },
        data: {
          preview1080Path: expectedKey,
          local1080Status: 'READY',
          local1080Error: null,
        },
      })
      logMessage(`[WORKER] local-1080 ready for video ${video.id}: ${expectedKey}`)
    } else {
      const message = sanitizeLocal1080Error(error || 'local 1080 transcode failed')
      await prisma.video.update({
        where: { id: video.id },
        data: { local1080Status: 'ERROR', local1080Error: message },
      })
      logMessage(`[WORKER] local-1080 failed for video ${video.id} (non-fatal): ${message}`)
    }

    return NextResponse.json({ ok: true })
  } catch (callbackError) {
    logError('[WORKER] local-1080 callback failed', callbackError)
    return NextResponse.json({ error: 'callback failed' }, { status: 500 })
  }
}
