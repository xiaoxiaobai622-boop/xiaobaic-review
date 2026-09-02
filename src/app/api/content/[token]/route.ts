import { NextRequest, NextResponse } from 'next/server'
import { verifyVideoAccessToken, detectHotlinking, trackVideoAccess, logSecurityEvent, getSecuritySettings } from '@/lib/video-access'
import { getRedis } from '@/lib/redis'
import { prisma } from '@/lib/db'
import { createReadStream, existsSync, statSync } from 'fs'
import { getFilePath, sanitizeFilenameForHeader, getVideoContentType, isS3Mode, createWebReadableStream } from '@/lib/storage'
import { s3GetPresignedDownloadUrl, s3GetPresignedStreamUrl, s3FileExists, s3DownloadFile } from '@/lib/s3-storage'
import { rateLimit } from '@/lib/rate-limit'
import { getClientIpAddress } from '@/lib/utils'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import { logError } from '@/lib/logging'
import {
  STREAM_CHUNK_SIZE_BYTES,
  STREAM_HIGH_WATER_MARK_BYTES,
  parseBoundedRangeHeader,
  parseDownloadRangeHeader,
} from '@/lib/transfer-tuning'


export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CONTENT_SESSION_WINDOW_SECONDS = 60
const HLS_MANIFEST_CACHE_TTL_SECONDS = 300
// A VOD playlist is parsed once and hls.js keeps using its segment URLs while
// playback continues. Match the progressive stream lifetime so a review that
// lasts longer than 15 minutes does not turn valid later segments into 403s.
const HLS_SEGMENT_URL_TTL_SECONDS = 4 * 60 * 60
const HLS_MANIFEST_QUERY_PARAM = 'manifest'

// In filesystem mode every browser seek can result in another authenticated
// Range request. The token and hotlink checks still run per request, but the
// immutable media metadata does not need to be fetched from Prisma each time.
// Keep this cache deliberately short so a completed transcode or rollback is
// reflected promptly while coalescing bursts of Range requests.
const VIDEO_METADATA_CACHE_TTL_MS = 5_000
type VideoMetadata = {
  id: string
  projectId: string
  originalFileName: string
  originalStoragePath: string
  hlsPath: string | null
  cleanPreview2160Path: string | null
  cleanPreview1080Path: string | null
  cleanPreview720Path: string | null
  preview2160Path: string | null
  preview1080Path: string | null
  preview720Path: string | null
  thumbnailPath: string | null
  approved: boolean
  status: string
  project: {
    title: string
    allowAssetDownload: boolean
  }
}

const videoMetadataCache = new Map<string, { value: VideoMetadata; expiresAt: number }>()
const videoMetadataInflight = new Map<string, Promise<VideoMetadata | null>>()

// Error messages are needed only when a request is rejected, but this route is
// also used for every local Range request. Cache the merged locale messages so
// those hot-path requests do not repeatedly deep-merge the JSON dictionaries.
const contentShareMessagesCache = new Map<string, Promise<Record<string, any>>>()

function getContentShareMessages(locale: string): Promise<Record<string, any>> {
  const cached = contentShareMessagesCache.get(locale)
  if (cached) return cached

  const loadPromise = loadLocaleMessages(locale).then((messages) => messages?.share || {})
  contentShareMessagesCache.set(locale, loadPromise)
  void loadPromise.catch(() => {
    if (contentShareMessagesCache.get(locale) === loadPromise) contentShareMessagesCache.delete(locale)
  })
  return loadPromise
}

async function getVideoMetadata(videoId: string, projectId: string): Promise<VideoMetadata | null> {
  const cacheKey = `${projectId}:${videoId}`
  const now = Date.now()
  const cached = videoMetadataCache.get(cacheKey)
  if (cached && cached.expiresAt > now) return cached.value
  if (cached) videoMetadataCache.delete(cacheKey)

  const existing = videoMetadataInflight.get(cacheKey)
  if (existing) return existing

  const lookup = prisma.video.findFirst({
    where: {
      id: videoId,
      projectId,
      // A token can outlive a rollback for a few minutes. Do not serve the
      // superseded file while its access token remains in Redis.
      status: { not: 'ROLLED_BACK' },
    },
    select: {
      id: true,
      projectId: true,
      originalFileName: true,
      originalStoragePath: true,
      hlsPath: true,
      cleanPreview2160Path: true,
      cleanPreview1080Path: true,
      cleanPreview720Path: true,
      preview2160Path: true,
      preview1080Path: true,
      preview720Path: true,
      thumbnailPath: true,
      approved: true,
      status: true,
      project: { select: { title: true, allowAssetDownload: true } },
    },
  }).then((video) => video as VideoMetadata | null)

  videoMetadataInflight.set(cacheKey, lookup)
  try {
    const value = await lookup
    if (value) {
      videoMetadataCache.set(cacheKey, { value, expiresAt: Date.now() + VIDEO_METADATA_CACHE_TTL_MS })
      // Bound memory in long-lived Node workers serving many projects.
      if (videoMetadataCache.size > 1_000) videoMetadataCache.clear()
    }
    return value
  } finally {
    if (videoMetadataInflight.get(cacheKey) === lookup) videoMetadataInflight.delete(cacheKey)
  }
}

// A page can mount more than one player (or issue duplicate manifest loads
// while the first response is still in flight). Coalesce those requests in a
// process so COS and URL-signing work is done once per manifest cache miss.
const hlsManifestInflight = new Map<string, Promise<string | null>>()

const hlsManifestHeaders = {
  'Content-Type': 'application/vnd.apple.mpegurl',
  // The manifest contains short-lived signed segment URLs. Keep it private,
  // but allow the browser to reuse it for the same review session.
  'Cache-Control': 'private, max-age=300, stale-while-revalidate=30',
  'Access-Control-Allow-Origin': '*',
}

function hlsManifestResponse(manifest: string): NextResponse {
  return new NextResponse(manifest, { headers: hlsManifestHeaders })
}

function normalizeHlsObjectKey(candidate: string): string | null {
  const segments: string[] = []
  for (const segment of candidate.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) return null
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return segments.length > 0 ? segments.join('/') : null
}

/**
 * Resolve a URI from an HLS playlist against that playlist's object key.
 * Playlist files are trusted server output, but normalizing here keeps a
 * malformed or encoded `..` path from escaping the bucket namespace.
 */
function resolveHlsObjectKey(manifestPath: string, uri: string): string | null {
  const rawUri = uri.trim()
  if (!rawUri || /^https?:\/\//i.test(rawUri) || /^data:/i.test(rawUri) || rawUri.startsWith('//')) {
    return null
  }

  let decodedUri = rawUri
  try {
    decodedUri = decodeURIComponent(rawUri)
  } catch {
    // Keep the original path when a provider returns a malformed escape.
  }
  const pathOnly = decodedUri.split(/[?#]/, 1)[0]
  const basePath = manifestPath.slice(0, manifestPath.lastIndexOf('/') + 1)
  const candidate = pathOnly.startsWith('/')
    ? pathOnly.slice(1)
    : `${basePath}${pathOnly}`
  return normalizeHlsObjectKey(candidate)
}

function resolveHlsManifestPath(rootPath: string, requestedPath: string | null): string | null {
  if (!requestedPath) return rootPath

  let decodedPath = requestedPath
  try {
    decodedPath = decodeURIComponent(requestedPath)
  } catch {
    // URLSearchParams normally decodes this already; retain the raw value.
  }
  if (!decodedPath || decodedPath.includes('\0')) return null

  const rootDirectory = rootPath.slice(0, rootPath.lastIndexOf('/') + 1)
  const candidate = decodedPath === rootPath
    ? rootPath
    : decodedPath.startsWith(rootDirectory)
      ? normalizeHlsObjectKey(decodedPath)
    : resolveHlsObjectKey(rootPath, decodedPath)
  if (!candidate || !candidate.toLowerCase().endsWith('.m3u8')) return null
  if (candidate !== rootPath && !candidate.startsWith(rootDirectory)) return null
  return candidate
}

function isHlsObjectWithinRoot(rootPath: string, objectKey: string): boolean {
  const rootDirectory = rootPath.slice(0, rootPath.lastIndexOf('/') + 1)
  // HLS objects are normally stored alongside the root playlist. If a legacy
  // key has no directory component, only allow other objects at that same
  // bucket level rather than permitting a path traversal into a subdirectory.
  return rootDirectory ? objectKey.startsWith(rootDirectory) : !objectKey.includes('/')
}

async function buildHlsManifest(
  hlsPath: string,
  redis: ReturnType<typeof getRedis>,
  manifestCacheKey: string,
  accessToken: string,
): Promise<string | null> {
  const cachedManifest = await redis.get(manifestCacheKey)
  if (cachedManifest) return cachedManifest

  const existing = hlsManifestInflight.get(manifestCacheKey)
  if (existing) return existing

  const buildPromise = (async () => {
    // hlsPath is persisted as soon as MPS reports success, but COS can take a
    // short moment to expose the object. Preserve the existing 409 response for
    // that transient state while avoiding this HEAD request on cache hits.
    if (!(await s3FileExists(hlsPath))) return null

    const manifestStream = await s3DownloadFile(hlsPath)
    const chunks: Buffer[] = []
    for await (const chunk of manifestStream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }

    const manifest = Buffer.concat(chunks).toString('utf8')
    const signedUriPromises = new Map<string, Promise<string>>()

    const signUri = (uri: string): Promise<string> => {
      const objectKey = resolveHlsObjectKey(hlsPath, uri)
      if (!objectKey || !isHlsObjectWithinRoot(hlsPath, objectKey)) {
        return Promise.resolve(uri)
      }

      // A master playlist can reference a media playlist. Route that request
      // back through this authenticated endpoint so its own segment URIs are
      // rewritten as well; a direct COS URL would leave them relative/unsigned.
      if (objectKey.toLowerCase().endsWith('.m3u8')) {
        const nestedUrl = `/api/content/${encodeURIComponent(accessToken)}?${HLS_MANIFEST_QUERY_PARAM}=${encodeURIComponent(objectKey)}`
        return Promise.resolve(nestedUrl)
      }

      const existingPromise = signedUriPromises.get(objectKey)
      if (existingPromise) return existingPromise

      const signedPromise = s3GetPresignedStreamUrl(
        objectKey,
        HLS_SEGMENT_URL_TTL_SECONDS,
        'video/mp2t',
      )
      signedUriPromises.set(objectKey, signedPromise)
      return signedPromise
    }

    const rewriteUriAttributes = async (line: string): Promise<string> => {
      const uriPattern = /URI=(['"])(.*?)\1/gi
      const matches = Array.from(line.matchAll(uriPattern))
      if (matches.length === 0) return line

      const replacements = await Promise.all(matches.map((match) => signUri(match[2])))
      let rewrittenLine = line
      for (let index = matches.length - 1; index >= 0; index -= 1) {
        const match = matches[index]
        const replacement = replacements[index]
        const valueStart = match.index! + match[0].indexOf(match[2])
        rewrittenLine = `${rewrittenLine.slice(0, valueStart)}${replacement}${rewrittenLine.slice(valueStart + match[2].length)}`
      }
      return rewrittenLine
    }

    const rewritten = await Promise.all(manifest.split(/\r?\n/).map(async (line) => {
      const trimmed = line.trim()
      if (!trimmed || /^https?:\/\//i.test(trimmed)) {
        return line
      }
      if (trimmed.startsWith('#')) return rewriteUriAttributes(line)
      return signUri(trimmed)
    }))
    const rewrittenManifest = rewritten.join('\n')

    // Cache is an optimization; a transient Redis write failure must not turn
    // an otherwise valid manifest into a playback error.
    await redis.setex(
      manifestCacheKey,
      HLS_MANIFEST_CACHE_TTL_SECONDS,
      rewrittenManifest,
    ).catch(() => undefined)

    return rewrittenManifest
  })()

  hlsManifestInflight.set(manifestCacheKey, buildPromise)
  try {
    return await buildPromise
  } finally {
    if (hlsManifestInflight.get(manifestCacheKey) === buildPromise) {
      hlsManifestInflight.delete(manifestCacheKey)
    }
  }
}


/**
 * Content delivery endpoint - streams video/thumbnail content with security checks
 * Handles both admin and share token authentication with rate limiting and hotlink protection
 * Supports range requests for video streaming and direct downloads
 *
 * @param request - NextRequest with authorization header and optional range header
 * @param params - Route params containing the video access token
 * @returns Video/thumbnail stream with appropriate headers, or error response
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const locale = await getConfiguredLocale()
    const shareMessages = await getContentShareMessages(locale)

    const { token } = await params
    const { searchParams } = request.nextUrl
    const isDownload = searchParams.get('download') === 'true'
    const assetId = searchParams.get('assetId')
    const requestedManifestPath = searchParams.get(HLS_MANIFEST_QUERY_PARAM)

    const securitySettings = await getSecuritySettings()

    const ipRateLimitResult = await rateLimit(request, {
      windowMs: 60 * 1000,
      maxRequests: securitySettings.ipRateLimit,
      message: shareMessages.tooManyNetworkRequests || 'Too many requests from your network. Please slow down and try again later.'
    }, 'content-stream-ip')

    if (ipRateLimitResult) {
      await logSecurityEvent({
        type: 'RATE_LIMIT_HIT',
        severity: 'WARNING',
        ipAddress: getClientIpAddress(request),
        details: { limit: 'IP-based', window: '1 minute' },
        wasBlocked: true
      })

      return ipRateLimitResult
    }

    const redis = getRedis()
    const tokenKey = `video_access:${token}`
    const rawTokenData = await redis.get(tokenKey)

    if (!rawTokenData) {
  return NextResponse.json({ error: shareMessages.accessDenied || 'Access denied' }, { status: 403 })
    }

    const preliminaryTokenData = JSON.parse(rawTokenData)

    const sessionId = preliminaryTokenData.sessionId

    if (!sessionId) {
  return NextResponse.json({ error: shareMessages.accessDenied || 'Access denied' }, { status: 401 })
    }

    const verifiedToken = await verifyVideoAccessToken(token, request, sessionId, rawTokenData)
    if (!verifiedToken) {
      return NextResponse.json({ error: shareMessages.accessDenied || 'Access denied' }, { status: 403 })
    }
    const isAdminRequest = verifiedToken.isAdmin === true

    // Session-based content rate limiting.
    // Range requests (video scrubbing/seeking) are normal browser behaviour and are
    // already guarded by the IP rate limit, hotlink detection, and the per-video
    // frequency counter in detectHotlinking (>3000 req / 5 min). Only count
    // non-range requests (initial video loads, downloads, thumbnails) against the
    // session budget so that scrubbing never triggers a 429.
    const rangeHeader = request.headers.get('range')
    const isRangeRequest = !!rangeHeader

    if (!isRangeRequest) {
      const sessionCounterKey = `content-session-count:${sessionId}`
      const sessionCount = await redis.incr(sessionCounterKey)
      if (sessionCount === 1) {
        await redis.expire(sessionCounterKey, CONTENT_SESSION_WINDOW_SECONDS)
      }

      const sessionRateLimit = isAdminRequest
        ? securitySettings.sessionRateLimit
        : securitySettings.shareSessionRateLimit

      if (sessionCount > sessionRateLimit) {
        await logSecurityEvent({
          type: 'RATE_LIMIT_HIT',
          severity: 'INFO',
          projectId: preliminaryTokenData.projectId,
          sessionId,
          ipAddress: getClientIpAddress(request),
          details: {
            limit: isAdminRequest ? 'Admin session-based' : 'Share session-based',
            window: '1 minute'
          },
          wasBlocked: true
        })

        return NextResponse.json({
          error: shareMessages.videoStreamingRateLimitExceeded || 'Video streaming rate limit exceeded. Please wait a moment.'
        }, { status: 429, headers: { 'Retry-After': String(CONTENT_SESSION_WINDOW_SECONDS) } })
      }
    }

    const hotlinkCheck = await detectHotlinking(
      request,
      sessionId,
      verifiedToken.videoId,
      verifiedToken.projectId
    )

    if (hotlinkCheck.isHotlinking) {
      if (securitySettings.hotlinkProtection === 'BLOCK_STRICT') {
        await logSecurityEvent({
          type: 'HOTLINK_BLOCKED',
          severity: hotlinkCheck.severity || 'WARNING',
          projectId: verifiedToken.projectId,
          videoId: verifiedToken.videoId,
          sessionId,
          ipAddress: getClientIpAddress(request),
          referer: request.headers.get('referer') || undefined,
          details: { reason: hotlinkCheck.reason },
          wasBlocked: true
        })
        
        return NextResponse.json({
          error: shareMessages.accessDenied || 'Access denied'
        }, { status: 403 })
      }
    }

    const video = await getVideoMetadata(verifiedToken.videoId, verifiedToken.projectId)

    if (!video) {
  return NextResponse.json({ error: shareMessages.accessDenied || 'Access denied' }, { status: 404 })
    }

    const originalPath = video.originalStoragePath
    const requestedQuality = verifiedToken.quality
    const hlsPath = (video as any).hlsPath as string | null | undefined

    // HLS manifests are served through the authenticated token endpoint. Each
    // media URI is rewritten to a short-lived COS/CDN URL so segment requests
    // do not need a second application token.
    if (requestedQuality === 'hls' && hlsPath && isS3Mode()) {
      const manifestPath = resolveHlsManifestPath(hlsPath, requestedManifestPath)
      if (!manifestPath) {
        return NextResponse.json({ error: shareMessages.accessDenied || 'Access denied' }, { status: 400 })
      }

      // Cache the rewritten manifest to avoid repeated S3 downloads and
      // presigning overhead during scrubbing/seeking, where the player may
      // re-request the manifest several times in quick succession.
      // Nested playlist URLs carry the caller's access token. Keep the cache
      // token-scoped so one viewer never receives another viewer's URL.
      const manifestCacheKey = `hls_manifest:${manifestPath}:${token}`
      const rewrittenManifest = await buildHlsManifest(manifestPath, redis, manifestCacheKey, token)
      if (!rewrittenManifest) {
        return NextResponse.json(
          { error: '视频正在处理，请稍后再试', code: 'HLS_NOT_READY' },
          { status: 409, headers: { 'Retry-After': '10' } },
        )
      }
      return hlsManifestResponse(rewrittenManifest)
    }

    const getPreferredPreviewPath = (preferClean: boolean): string | null => {
      const clean2160 = (video as any).cleanPreview2160Path as string | null | undefined
      const clean1080 = video.cleanPreview1080Path
      const clean720 = video.cleanPreview720Path
      const wm2160 = (video as any).preview2160Path as string | null | undefined
      const wm1080 = video.preview1080Path
      const wm720 = video.preview720Path

      const pick = (...paths: Array<string | null | undefined>): string | null => {
        return paths.find((p): p is string => Boolean(p)) || null
      }

      if (requestedQuality === '2160p') {
        return preferClean
          ? pick(clean2160, wm2160, clean1080, wm1080, clean720, wm720)
          : pick(wm2160, wm1080, wm720)
      }

      if (requestedQuality === '1080p') {
        return preferClean
          ? pick(clean1080, wm1080, clean720, wm720, clean2160, wm2160)
          : pick(wm1080, wm720, wm2160)
      }

      return preferClean
        ? pick(clean720, wm720, clean1080, wm1080, clean2160, wm2160)
        : pick(wm720, wm1080, wm2160)
    }

    let filePath: string | null = null
    let filename: string | null = null
    let contentType = getVideoContentType(video.originalFileName || '')

    if (assetId && isDownload) {
      const asset = await prisma.videoAsset.findUnique({
        where: { id: assetId }
      })

      if (!asset || asset.videoId !== video.id) {
  return NextResponse.json({ error: shareMessages.assetNotFound || 'Asset not found' }, { status: 404 })
      }

      // Check permissions (skip for admins and client-uploaded comment attachments)
      if (!isAdminRequest && asset.uploadedBy !== 'client') {
        if (!video.project.allowAssetDownload) {
          return NextResponse.json({ error: shareMessages.assetDownloadsNotAllowed || 'Asset downloads not allowed' }, { status: 403 })
        }

        if (!video.approved) {
          return NextResponse.json({ error: shareMessages.assetsOnlyAvailableForApprovedVideos || 'Assets only available for approved videos' }, { status: 403 })
        }
      }

      filePath = asset.storagePath
      filename = asset.fileName
      contentType = asset.fileType
    } else {
      if (verifiedToken.quality === 'thumbnail') {
        filePath = video.thumbnailPath
      } else if (isDownload && isAdminRequest && originalPath) {
        // Admin downloads should always use the original file, even before approval
        filePath = originalPath
      } else if (isDownload && video.approved && originalPath) {
        filePath = originalPath
      } else {
        // Playback is preview-only. Originals are retained exclusively for explicit downloads.
        filePath = getPreferredPreviewPath(video.approved)
        if (!filePath) {
          // MPS videos have a playable HLS rendition but no local MP4 preview.
          // Never silently substitute the original here: an HLS networking error
          // must remain recoverable rather than causing a large original upload
          // to be streamed as playback.
          if (hlsPath && requestedQuality !== 'thumbnail') {
            return NextResponse.json(
              { error: 'HLS playback is temporarily unavailable', code: 'HLS_PLAYBACK_UNAVAILABLE' },
              { status: 503, headers: { 'Retry-After': '10' } },
            )
          }

          // Browser-compatible MP4 uploads can intentionally be READY without a
          // generated preview. In that case the original is the playback source.
          if (video.status === 'READY' && originalPath) {
            filePath = originalPath
          } else {
            return NextResponse.json(
              { error: '视频正在处理，请稍后再试', code: 'PREVIEW_NOT_READY' },
              { status: 409, headers: { 'Retry-After': '10' } }
            )
          }
        }
      }
    }

    if (!filePath) {
  return NextResponse.json({ error: shareMessages.accessDenied || 'Access denied' }, { status: 404 })
    }

    // ── S3 mode: redirect browser directly to MinIO ───────────────────────────
    if (isS3Mode()) {
      const fileExistsOnS3 = await s3FileExists(filePath)
      if (!fileExistsOnS3) {
        return NextResponse.json({ error: shareMessages.accessDenied || 'Access denied' }, { status: 404 })
      }

      // Track non-range access fire-and-forget — must not delay the 302 redirect
      // back to the browser, otherwise the native download dialog stalls.
      if (!isRangeRequest && !isAdminRequest) {
        void trackVideoAccess({
          videoId: verifiedToken.videoId,
          projectId: verifiedToken.projectId,
          sessionId,
          tokenId: token,
          request,
          quality: verifiedToken.quality,
          bandwidth: 0,
          eventType: isDownload ? 'DOWNLOAD_COMPLETE' : 'PAGE_VISIT',
          assetId: assetId || undefined,
        }).catch(() => {})
      }

      if (isDownload) {
        const rawFilename = filename || (video.approved
          ? video.originalFileName
          : `${video.project.title.replace(/[^a-z0-9]/gi, '_')}_${verifiedToken.quality}${(video.originalFileName || '.mp4').slice((video.originalFileName || '.mp4').lastIndexOf('.'))}`)
        const sanitizedFilename = sanitizeFilenameForHeader(rawFilename)
        const ct = assetId ? contentType : getVideoContentType(video.originalFileName || '')
        const presignedUrl = await s3GetPresignedDownloadUrl(filePath, 3600, sanitizedFilename, ct)
        return NextResponse.redirect(presignedUrl, {
          status: 302,
          headers: { 'Cache-Control': 'no-store' },
        })
      } else if (verifiedToken.quality === 'thumbnail') {
        const presignedUrl = await s3GetPresignedStreamUrl(filePath, 86400, 'image/jpeg')
        return NextResponse.redirect(presignedUrl, {
          status: 302,
          headers: { 'Cache-Control': 'public, max-age=86400, immutable' },
        })
      } else {
        // Streaming (video player): long-lived presigned URL so range requests hit S3 directly
        const ct = getVideoContentType(video.originalFileName || '')
        const presignedUrl = await s3GetPresignedStreamUrl(filePath, 14400, ct)
        return NextResponse.redirect(presignedUrl, {
          status: 302,
          headers: { 'Cache-Control': 'public, max-age=3600' },
        })
      }
    }
    // ── End S3 mode ───────────────────────────────────────────────────────────

    const fullPath = getFilePath(filePath)
    
    if (!existsSync(fullPath)) {
  return NextResponse.json({ error: shareMessages.accessDenied || 'Access denied' }, { status: 404 })
    }

    const stat = statSync(fullPath)

    if (isDownload && verifiedToken.quality === 'thumbnail') {
  return NextResponse.json({ error: shareMessages.thumbnailsCannotBeDownloaded || 'Thumbnails cannot be downloaded directly' }, { status: 403 })
    }

    const range = request.headers.get('range')

    const isThumbnail = verifiedToken.quality === 'thumbnail'
    const cacheControl = isThumbnail
      ? 'public, max-age=86400, immutable'
      : 'public, max-age=3600'

    if (isDownload) {
      // Use asset filename if available, otherwise generate from video info
      const rawFilename = filename || (video.approved
        ? video.originalFileName
        : `${video.project.title.replace(/[^a-z0-9]/gi, '_')}_${verifiedToken.quality}${(video.originalFileName || '.mp4').slice((video.originalFileName || '.mp4').lastIndexOf('.'))}`)
      const sanitizedFilename = sanitizeFilenameForHeader(rawFilename)

      if (!assetId) {
        contentType = isThumbnail ? 'image/jpeg' : getVideoContentType(video.originalFileName || '')
      }

      // Fire-and-forget — must NOT block the first response byte. The browser's
      // download dialog only appears after Content-Disposition headers are sent,
      // so any await here would visibly delay the "save as" prompt.
      const trackDownloadOnce = () => {
        if (!isAdminRequest) {
          void trackVideoAccess({
            videoId: verifiedToken.videoId,
            projectId: verifiedToken.projectId,
            sessionId,
            tokenId: token,
            request,
            quality: verifiedToken.quality,
            bandwidth: stat.size,
            eventType: 'DOWNLOAD_COMPLETE',
            assetId: assetId || undefined,
          }).catch(() => {})
        }
      }

      // If no Range header, stream entire file with 200 so downloads aren't truncated
      if (!range) {
        trackDownloadOnce()

        const fileStream = createReadStream(fullPath, { highWaterMark: STREAM_HIGH_WATER_MARK_BYTES })
        const readableStream = createWebReadableStream(fileStream)

        return new NextResponse(readableStream, {
          headers: {
            'Content-Type': contentType,
            'Content-Length': stat.size.toString(),
            'Accept-Ranges': 'bytes',
            'Content-Disposition': `attachment; filename="${sanitizedFilename}"`,
            'Cache-Control': 'private, no-cache',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'SAMEORIGIN',
            'Referrer-Policy': 'strict-origin-when-cross-origin',
          },
        })
      }

      // For downloads, honor the client's range as given. Open-ended
      // (bytes=0-) means "stream the rest" — capping it forced download
      // managers into many sequential round-trips through Prisma and
      // crippled throughput.
      const parsedRange = parseDownloadRangeHeader(range || 'bytes=0-', stat.size)
      if (!parsedRange) {
        return new NextResponse(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${stat.size}` },
        })
      }
      const { start, end } = parsedRange
      const chunksize = (end - start) + 1

      if (start === 0) {
        trackDownloadOnce()
      }

      const fileStream = createReadStream(fullPath, { start, end, highWaterMark: STREAM_HIGH_WATER_MARK_BYTES })
      const readableStream = createWebReadableStream(fileStream)

      return new NextResponse(readableStream, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize.toString(),
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${sanitizedFilename}"`,
          'Cache-Control': 'private, no-cache',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'SAMEORIGIN',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
        },
      })
    }

    if (range) {
      const parsedRange = parseBoundedRangeHeader(range, stat.size, STREAM_CHUNK_SIZE_BYTES)
      if (!parsedRange) {
        return new NextResponse(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${stat.size}` },
        })
      }
      const { start, end } = parsedRange
      const chunksize = (end - start) + 1

      const fileStream = createReadStream(fullPath, { start, end, highWaterMark: STREAM_HIGH_WATER_MARK_BYTES })
      const readableStream = createWebReadableStream(fileStream)

      if (!assetId) {
        if (isThumbnail) {
          contentType = 'image/jpeg'
        } else if (filePath === originalPath) {
          contentType = getVideoContentType(video.originalFileName || '')
        } else {
          contentType = 'video/mp4' // transcoded previews are always mp4
        }
      }

      return new NextResponse(readableStream, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize.toString(),
          'Content-Type': contentType,
          'Cache-Control': cacheControl,
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'SAMEORIGIN',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
          'CF-Cache-Status': 'DYNAMIC',
        },
      })
    }

    const fileStream = createReadStream(fullPath, { highWaterMark: STREAM_HIGH_WATER_MARK_BYTES })
    const readableStream = createWebReadableStream(fileStream)

    if (!assetId) {
      if (isThumbnail) {
        contentType = 'image/jpeg'
      } else if (filePath === originalPath) {
        contentType = getVideoContentType(video.originalFileName || '')
      } else {
        contentType = 'video/mp4' // transcoded previews are always mp4
      }
    }

    return new NextResponse(readableStream, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': stat.size.toString(),
        'Accept-Ranges': 'bytes',
        'Cache-Control': cacheControl,
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'CF-Cache-Status': 'DYNAMIC',
      },
    })
  } catch (error) {
    // Stream errors are technical issues, not security events
    logError('[STREAM] Video streaming error:', error)

    const locale = await getConfiguredLocale().catch(() => 'en')
    const messages = await loadLocaleMessages(locale).catch(() => null)
    const shareMessages = messages?.share || {}
    return NextResponse.json({ error: shareMessages.failedToStreamVideo || 'Failed to stream video' }, { status: 500 })
  }
}
