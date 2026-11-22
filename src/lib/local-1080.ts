import crypto from 'crypto'
import { prisma } from './db'
import { logMessage } from './logging'
import { teamProjectStorageKey } from './storage-keys'
import { s3GetPresignedOriginStreamUrl, s3GetPresignedPutUrl } from './s3-storage'

/**
 * Background 1080p MP4 rendition produced by the docs transcode server
 * (scripts/local-1080-worker.py).
 *
 * Only new uploads dispatch it, after MPS has already made the 720p HLS READY.
 * Nothing here may delay or undo that READY state: every failure path is
 * contained to `local1080Status` / `local1080Error`.
 */
export const LOCAL_1080_STATUSES = ['NONE', 'PENDING', 'PROCESSING', 'READY', 'ERROR'] as const
export type Local1080Status = (typeof LOCAL_1080_STATUSES)[number]

export const LOCAL_1080_CONTENT_TYPE = 'video/mp4'
export const LOCAL_1080_OUTPUT_FILE = 'preview-1080.mp4'
export const LOCAL_1080_ERROR_MAX_LENGTH = 500
const LOCAL_1080_SOURCE_URL_TTL_SECONDS = 60 * 60
const LOCAL_1080_UPLOAD_URL_TTL_SECONDS = 60 * 60
const LOCAL_1080_DISPATCH_TIMEOUT_MS = 15_000

export type Local1080DispatchOutcome = 'dispatched' | 'skipped' | 'failed'

export interface Local1080Config {
  workerUrl: string
  secret: string
}

/**
 * The source check is the same one the local 1080 preview path uses: the short
 * side has to reach 1080, otherwise the worker would only upscale.
 */
export function sourceSupportsLocal1080(width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false
  return height > width ? width >= 1080 : height >= 1080
}

/** Canonical key for the single 1080 MP4 rendition. Callback validation recomputes it. */
export function local1080OutputKey(teamId: string, projectId: string, videoId: string): string {
  return teamProjectStorageKey(teamId, projectId, 'videos', videoId, LOCAL_1080_OUTPUT_FILE)
}

export function local1080CallbackUrl(appUrl?: string | null): string {
  const base = (appUrl || process.env.NEXT_PUBLIC_APP_URL || 'https://vidx.cn').replace(/\/+$/, '')
  return `${base}/api/internal/local-1080/callback`
}

function normalizeBaseUrl(value: string | undefined | null): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return trimmed.replace(/\/+$/, '')
  } catch {
    return null
  }
}

/** Base URL → job endpoint. Accepts a base with or without `/jobs`. */
export function local1080JobsUrl(workerUrl: string): string {
  const base = workerUrl.replace(/\/+$/, '')
  return base.endsWith('/jobs') ? base : `${base}/jobs`
}

/** Null means "do not dispatch": disabled, or URL/secret missing or malformed. */
export function readLocal1080Config(env: NodeJS.ProcessEnv = process.env): Local1080Config | null {
  if (env.LOCAL_1080_ENABLED !== 'true') return null
  const workerUrl = normalizeBaseUrl(env.LOCAL_1080_WORKER_URL)
  const secret = env.LOCAL_1080_WORKER_SECRET?.trim()
  if (!workerUrl || !secret) return null
  return { workerUrl, secret }
}

/** Constant-time bearer check shared by the callback route and the worker dispatch. */
export function verifyBearerToken(
  authorizationHeader: string | null | undefined,
  secret: string | null | undefined,
): boolean {
  if (!authorizationHeader || !secret) return false
  if (!authorizationHeader.startsWith('Bearer ')) return false
  const provided = authorizationHeader.slice('Bearer '.length).trim()
  const expected = secret.trim()
  if (!provided || !expected) return false
  const providedBuffer = Buffer.from(provided, 'utf8')
  const expectedBuffer = Buffer.from(expected, 'utf8')
  if (providedBuffer.length !== expectedBuffer.length) return false
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer)
}

/**
 * Error text is shown in the admin row, so it is collapsed to one line and any
 * URL query string (which is where presigned credentials live) is dropped.
 */
export function sanitizeLocal1080Error(error: unknown, maxLength = LOCAL_1080_ERROR_MAX_LENGTH): string {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  const withoutQuery = raw.replace(/https?:\/\/[^\s"'<>]+/g, (url) => url.split('?')[0])
  const collapsed = withoutQuery.replace(/\s+/g, ' ').trim()
  const message = collapsed || 'Unknown error'
  return message.slice(0, maxLength)
}

export interface Local1080CallbackData {
  videoId: string
  status: 'READY' | 'ERROR'
  outputKey?: string
  error?: string
}

export type Local1080CallbackParseResult =
  | { ok: true; data: Local1080CallbackData }
  | { ok: false; error: string }

/** Wire-body validation. READY without an output key can never be accepted. */
export function parseLocal1080CallbackBody(value: unknown): Local1080CallbackParseResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'invalid body' }
  }
  const body = value as Record<string, unknown>
  const videoId = typeof body.videoId === 'string' ? body.videoId.trim() : ''
  if (!videoId || videoId.length > 200) return { ok: false, error: 'videoId is required' }

  if (body.status !== 'READY' && body.status !== 'ERROR') {
    return { ok: false, error: 'status must be READY or ERROR' }
  }

  const outputKey = typeof body.outputKey === 'string' ? body.outputKey.trim() : ''
  if (outputKey.length > 1024) return { ok: false, error: 'outputKey is too long' }
  if (body.status === 'READY' && !outputKey) {
    return { ok: false, error: 'outputKey is required when status is READY' }
  }

  const error = typeof body.error === 'string' ? body.error : ''
  return {
    ok: true,
    data: {
      videoId,
      status: body.status,
      ...(outputKey ? { outputKey } : {}),
      ...(error ? { error } : {}),
    },
  }
}

export interface Local1080JobPayload {
  videoId: string
  sourceUrl: string
  uploadUrl: string
  outputKey: string
  contentType: typeof LOCAL_1080_CONTENT_TYPE
  callbackUrl: string
}

export function buildLocal1080JobPayload(input: {
  videoId: string
  sourceUrl: string
  uploadUrl: string
  outputKey: string
  callbackUrl: string
}): Local1080JobPayload {
  return {
    videoId: input.videoId,
    sourceUrl: input.sourceUrl,
    uploadUrl: input.uploadUrl,
    outputKey: input.outputKey,
    contentType: LOCAL_1080_CONTENT_TYPE,
    callbackUrl: input.callbackUrl,
  }
}

export interface Local1080DispatchInput {
  videoId: string
  projectId: string
  teamId: string
  originalStoragePath: string
  width: number
  height: number
  preview1080Path: string | null
  env?: NodeJS.ProcessEnv
}

/**
 * Fire-and-forget dispatch. Never throws: the caller has already reported the
 * video READY, and a failed 1080 job must not turn into a video-level error.
 */
export async function dispatchLocal1080Rendition(
  input: Local1080DispatchInput,
): Promise<Local1080DispatchOutcome> {
  const config = readLocal1080Config(input.env ?? process.env)
  if (!config) return 'skipped'
  if (!sourceSupportsLocal1080(input.width, input.height)) return 'skipped'
  if (input.preview1080Path) return 'skipped'

  const { videoId } = input
  const outputKey = local1080OutputKey(input.teamId, input.projectId, videoId)

  try {
    await prisma.video.update({
      where: { id: videoId },
      data: { local1080Status: 'PROCESSING', local1080Error: null },
    })

    const [sourceUrl, uploadUrl] = await Promise.all([
      s3GetPresignedOriginStreamUrl(input.originalStoragePath, LOCAL_1080_SOURCE_URL_TTL_SECONDS),
      s3GetPresignedPutUrl(outputKey, LOCAL_1080_CONTENT_TYPE, LOCAL_1080_UPLOAD_URL_TTL_SECONDS),
    ])

    const payload = buildLocal1080JobPayload({
      videoId,
      sourceUrl,
      uploadUrl,
      outputKey,
      callbackUrl: local1080CallbackUrl(),
    })

    const response = await fetch(local1080JobsUrl(config.workerUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.secret}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(LOCAL_1080_DISPATCH_TIMEOUT_MS),
    })

    if (!response.ok) {
      throw new Error(`transcode worker responded HTTP ${response.status}`)
    }

    logMessage(`[WORKER] local-1080 job accepted for video ${videoId}`)
    return 'dispatched'
  } catch (error) {
    const message = sanitizeLocal1080Error(error)
    await prisma.video.update({
      where: { id: videoId },
      data: { local1080Status: 'ERROR', local1080Error: message },
    }).catch((updateError) => {
      logMessage(`[WORKER] local-1080 status update failed for video ${videoId}: ${sanitizeLocal1080Error(updateError)}`)
    })
    // Deliberately logs no signed URL and no secret.
    logMessage(`[WORKER] local-1080 dispatch failed for video ${videoId} (non-fatal): ${message}`)
    return 'failed'
  }
}
