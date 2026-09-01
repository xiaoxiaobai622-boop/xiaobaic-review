import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  ListMultipartUploadsCommand,
  HeadObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  NotFound,
  type CompletedPart,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createHash } from 'crypto'
import { Readable } from 'stream'

let _s3Client: S3Client | null = null

function getS3Client(): S3Client {
  if (_s3Client) return _s3Client

  const endpoint = process.env.S3_ENDPOINT?.trim()
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim()
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim()

  if (!endpoint) throw new Error('S3_ENDPOINT is not configured')
  if (!accessKeyId) throw new Error('S3_ACCESS_KEY_ID is not configured')
  if (!secretAccessKey) throw new Error('S3_SECRET_ACCESS_KEY is not configured')

  // Validate S3 endpoint is a proper HTTP(S) URL to prevent SSRF via misconfiguration
  try {
    const parsed = new URL(endpoint)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`S3_ENDPOINT must use http or https (got ${parsed.protocol})`)
    }
  } catch (e) {
    if (e instanceof TypeError) {
      throw new Error(`S3_ENDPOINT is not a valid URL: ${endpoint}`)
    }
    throw e
  }

  // forcePathStyle: true for MinIO/Ceph. Set S3_FORCE_PATH_STYLE=false for AWS virtual-hosted buckets.
  const forcePathStyle = process.env.S3_FORCE_PATH_STYLE !== 'false'

  _s3Client = new S3Client({
    endpoint,
    region: process.env.S3_REGION?.trim() || 'us-east-1',
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle,
    // SDK >= 3.729.0 defaults to sending x-amz-checksum-* headers on all requests.
    // MinIO (and Cloudflare R2, DigitalOcean Spaces, Backblaze B2) return 400/501
    // for these headers. WHEN_REQUIRED disables that default for all request types.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })

  return _s3Client
}

function getS3Bucket(): string {
  const bucket = process.env.S3_BUCKET
  if (!bucket) throw new Error('S3_BUCKET is not configured')
  return bucket
}

const cdnUrlCache = new Map<string, { url: string; expiresAt: number }>()

// Content requests can check the same preview several times while a player is
// starting or seeking. A short process-local cache avoids a HEAD round trip on
// every request without making object availability a long-lived assumption.
const S3_FILE_EXISTS_CACHE_TTL_MS = 15_000
const S3_FILE_MISSING_CACHE_TTL_MS = 2_000
const S3_FILE_EXISTS_CACHE_MAX_ENTRIES = 2_048
type S3FileExistsCacheEntry = { value: boolean; expiresAt: number }
const s3FileExistsCache = new Map<string, S3FileExistsCacheEntry>()
const s3FileExistsInflight = new Map<string, Promise<boolean>>()
const s3FileExistsGenerations = new Map<string, number>()

function setS3FileExistsCache(key: string, value: boolean, ttlMs: number): void {
  // Map iteration order is insertion order, so remove the oldest entry when
  // the bounded cache is full. This keeps a long-lived server process from
  // retaining one entry for every historical object key.
  if (!s3FileExistsCache.has(key) && s3FileExistsCache.size >= S3_FILE_EXISTS_CACHE_MAX_ENTRIES) {
    const oldestKey = s3FileExistsCache.keys().next().value
    if (oldestKey !== undefined) s3FileExistsCache.delete(oldestKey)
  }
  s3FileExistsCache.set(key, { value, expiresAt: Date.now() + ttlMs })
}

function invalidateS3FileExistsCache(key: string): void {
  s3FileExistsCache.delete(key)
  if (s3FileExistsInflight.has(key)) {
    s3FileExistsGenerations.set(key, (s3FileExistsGenerations.get(key) ?? 0) + 1)
  } else {
    // No request can observe a generation change once there is no in-flight
    // check, so avoid retaining a generation entry for every written key.
    s3FileExistsGenerations.delete(key)
  }
}

function markS3FileExistsCache(key: string, value: boolean, ttlMs: number): void {
  invalidateS3FileExistsCache(key)
  setS3FileExistsCache(key, value, ttlMs)
}

function isS3NotFoundError(err: unknown): boolean {
  if (err instanceof NotFound) return true
  const e = err as { $metadata?: { httpStatusCode?: number } }
  return e?.$metadata?.httpStatusCode === 404
}

function getCdnStreamUrl(key: string, expirySeconds: number): string | null {
  if (process.env.MEDIA_CDN_ENABLED !== 'true') return null

  const baseUrl = process.env.MEDIA_CDN_BASE_URL?.trim().replace(/\/$/, '')
  const authKey = process.env.MEDIA_CDN_AUTH_KEY?.trim()
  if (!baseUrl || !authKey) {
    throw new Error('MEDIA_CDN_BASE_URL and MEDIA_CDN_AUTH_KEY are required when MEDIA_CDN_ENABLED=true')
  }

  const encodedPath = `/${key.split('/').map(encodeURIComponent).join('/')}`
  const now = Math.floor(Date.now() / 1000)
  const cacheKey = `${encodedPath}:${expirySeconds}`
  const cached = cdnUrlCache.get(cacheKey)
  if (cached && cached.expiresAt > now + 60) {
    return cached.url
  }

  const timestamp = now + expirySeconds
  const rand = '0'
  const uid = '0'
  const digest = createHash('md5')
    .update(`${encodedPath}-${timestamp}-${rand}-${uid}-${authKey}`)
    .digest('hex')

  const url = `${baseUrl}${encodedPath}?auth_key=${timestamp}-${rand}-${uid}-${digest}`
  cdnUrlCache.set(cacheKey, { url, expiresAt: timestamp })
  return url
}

function formatS3Error(operation: string, key: string, err: unknown): Error {
  const e = err as { $metadata?: { httpStatusCode?: number }; message?: string; name?: string }
  const status = e?.$metadata?.httpStatusCode
  const msg = e?.message ?? String(err)
  const name = e?.name ? `${e.name}: ` : ''
  return new Error(`[S3 ${operation}] key="${key}"${status ? ` HTTP ${status}` : ''} ${name}${msg}`)
}

/** Upload a buffer or stream — used by the worker for processed outputs.
 * For files >= 100MB (or unknown-size streams), uses parallel multipart
 * upload. Smaller buffers go via a single PUT. Streams of unknown size are
 * always multipart so we never have to buffer the whole file in RAM.
 */
const MULTIPART_THRESHOLD = 100 * 1024 * 1024
const PART_SIZE = 25 * 1024 * 1024
const THUMBNAIL_CACHE_CONTROL = 'public, max-age=86400, immutable'
const VIDEO_CACHE_CONTROL = 'public, max-age=3600'

function getMediaCacheControl(key: string): string | undefined {
  if (key.includes('/thumbnail.') || key.includes('/thumbs/')) {
    return THUMBNAIL_CACHE_CONTROL
  }
  if (key.includes('/preview-') && key.endsWith('.mp4')) {
    return VIDEO_CACHE_CONTROL
  }
  return undefined
}

export async function s3UploadFile(
  key: string,
  body: Readable | Buffer,
  contentType: string = 'application/octet-stream',
  size?: number
): Promise<void> {
  // A write supersedes both positive and negative HEAD results. Invalidate
  // before starting so an in-flight check cannot repopulate stale state.
  invalidateS3FileExistsCache(key)

  if (Buffer.isBuffer(body)) {
    if (body.length >= MULTIPART_THRESHOLD) {
      return s3UploadFileMultipart(key, body, contentType, body.length, PART_SIZE)
    }
    try {
      await getS3Client().send(
        new PutObjectCommand({
          Bucket: getS3Bucket(),
          Key: key,
          Body: body,
          ContentType: contentType,
          ...(getMediaCacheControl(key) ? { CacheControl: getMediaCacheControl(key) } : {}),
        })
      )
      markS3FileExistsCache(key, true, S3_FILE_EXISTS_CACHE_TTL_MS)
    } catch (err) {
      throw formatS3Error('PUT', key, err)
    }
    return
  }

  // Known size and below threshold → single PUT (SDK handles streaming the body)
  if (size !== undefined && size < MULTIPART_THRESHOLD) {
    try {
      await getS3Client().send(
        new PutObjectCommand({
          Bucket: getS3Bucket(),
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentLength: size,
          ...(getMediaCacheControl(key) ? { CacheControl: getMediaCacheControl(key) } : {}),
        })
      )
      markS3FileExistsCache(key, true, S3_FILE_EXISTS_CACHE_TTL_MS)
    } catch (err) {
      throw formatS3Error('PUT', key, err)
    }
    return
  }

  // Known-large or unknown-size stream → multipart, streaming chunk-by-chunk.
  // No upfront buffering; memory use stays bounded to ~PART_SIZE × concurrency.
  return s3UploadFileMultipart(key, body, contentType, size ?? 0, PART_SIZE)
}

const SERVER_MULTIPART_CONCURRENCY = (() => {
  const v = Number(process.env.S3_SERVER_MULTIPART_CONCURRENCY)
  return Number.isFinite(v) && v >= 1 && v <= 16 ? Math.floor(v) : 4
})()

/** Upload a file using multipart upload. Internal helper for large files. */
async function s3UploadFileMultipart(
  key: string,
  body: Readable | Buffer,
  contentType: string,
  totalSize: number,
  partSize: number = 25 * 1024 * 1024 // 25MB default (matches presign endpoint)
): Promise<void> {
  let uploadId: string | undefined
  const completedParts: CompletedPart[] = []

  async function uploadPart(partNumber: number, chunk: Buffer): Promise<void> {
    const res = await getS3Client().send(
      new UploadPartCommand({
        Bucket: getS3Bucket(),
        Key: key,
        UploadId: uploadId!,
        PartNumber: partNumber,
        Body: chunk,
      })
    )
    if (!res.ETag) throw new Error(`Missing ETag for part ${partNumber}`)
    completedParts.push({ ETag: res.ETag, PartNumber: partNumber })
  }

  try {
    uploadId = await s3InitiateMultipartUpload(key, contentType)

    if (Buffer.isBuffer(body)) {
      // Pre-known size — slice into part chunks and parallelise.
      const partCount = Math.ceil(body.length / partSize)
      let nextPart = 1
      const queue = Array.from({ length: partCount }, (_, i) => i + 1)

      const workers = Array.from(
        { length: Math.min(SERVER_MULTIPART_CONCURRENCY, partCount) },
        async () => {
          while (queue.length > 0) {
            const partNumber = queue.shift()!
            const offset = (partNumber - 1) * partSize
            const end = Math.min(offset + partSize, body.length)
            await uploadPart(partNumber, body.subarray(offset, end))
          }
        }
      )
      void nextPart
      await Promise.all(workers)
    } else {
      // Stream input — read part-sized chunks sequentially, then dispatch
      // each to one of N concurrent upload slots so we don't hold more than
      // SERVER_MULTIPART_CONCURRENCY parts in RAM at a time.
      let partNumber = 1
      const inFlight = new Set<Promise<void>>()
      let pending: Buffer[] = []
      let pendingSize = 0

      const flushPart = async () => {
        const partBody = pending.length === 1 ? pending[0] : Buffer.concat(pending, pendingSize)
        pending = []
        pendingSize = 0
        const myPart = partNumber++
        // Throttle: if we already have N parts in flight, wait for one.
        while (inFlight.size >= SERVER_MULTIPART_CONCURRENCY) {
          await Promise.race(inFlight)
        }
        const promise = uploadPart(myPart, partBody).finally(() => inFlight.delete(promise))
        inFlight.add(promise)
      }

      for await (const chunk of body) {
        const buf: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        pending.push(buf)
        pendingSize += buf.length
        if (pendingSize >= partSize) {
          await flushPart()
        }
      }
      if (pendingSize > 0) {
        await flushPart()
      }
      await Promise.all(inFlight)
    }

    // CompleteMultipartUpload requires PartNumber-ordered parts.
    completedParts.sort((a, b) => (a.PartNumber ?? 0) - (b.PartNumber ?? 0))
    await s3CompleteMultipartUpload(key, uploadId, completedParts)
  } catch (err) {
    if (uploadId) {
      try { await s3AbortMultipartUpload(key, uploadId) } catch { /* swallow abort errors */ }
    }
    throw formatS3Error('PUT', key, err)
  }
}

/** Download an object as a readable stream — used by the worker. */
export async function s3DownloadFile(key: string): Promise<Readable> {
  let res
  try {
    res = await getS3Client().send(new GetObjectCommand({ Bucket: getS3Bucket(), Key: key }))
  } catch (err) {
    throw formatS3Error('GET', key, err)
  }
  if (!res.Body) throw new Error(`S3 object body missing for key: ${key}`)
  return res.Body as Readable
}

/** Move an object within the bucket by copying then deleting the source. */
export async function s3MoveFile(sourceKey: string, destKey: string): Promise<void> {
  const client = getS3Client()
  const bucket = getS3Bucket()
  const encodedSource = sourceKey.split('/').map(encodeURIComponent).join('/')

  invalidateS3FileExistsCache(sourceKey)
  invalidateS3FileExistsCache(destKey)

  try {
    await client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        Key: destKey,
        CopySource: `${bucket}/${encodedSource}`,
      })
    )
    markS3FileExistsCache(destKey, true, S3_FILE_EXISTS_CACHE_TTL_MS)
  } catch (err) {
    throw formatS3Error('COPY', destKey, err)
  }

  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: sourceKey }))
    markS3FileExistsCache(sourceKey, false, S3_FILE_MISSING_CACHE_TTL_MS)
  } catch (err) {
    throw formatS3Error('DELETE', sourceKey, err)
  }
}

/** Delete a single object. */
export async function s3DeleteFile(key: string): Promise<void> {
  invalidateS3FileExistsCache(key)
  try {
    await getS3Client().send(new DeleteObjectCommand({ Bucket: getS3Bucket(), Key: key }))
    markS3FileExistsCache(key, false, S3_FILE_MISSING_CACHE_TTL_MS)
  } catch (err) {
    throw formatS3Error('DELETE', key, err)
  }
}

/** Delete all objects under a key prefix (paginated). */
export async function s3DeleteDirectory(prefix: string): Promise<void> {
  const client = getS3Client()
  const bucket = getS3Bucket()
  const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`
  let continuationToken: string | undefined

  do {
    const res = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: normalizedPrefix, ContinuationToken: continuationToken })
    )
    const objects = res.Contents ?? []
    if (objects.length > 0) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: objects.map((o) => ({ Key: o.Key! })), Quiet: true },
        })
      )
      for (const object of objects) {
        if (object.Key) markS3FileExistsCache(object.Key, false, S3_FILE_MISSING_CACHE_TTL_MS)
      }
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (continuationToken)
}

/** Return true if the object exists; false on 404; rethrows on any other error. */
export async function s3FileExists(key: string): Promise<boolean> {
  // Validate the configured bucket even when a cached result is available,
  // preserving the original configuration-error behavior.
  const bucket = getS3Bucket()
  const now = Date.now()
  const cached = s3FileExistsCache.get(key)
  if (cached) {
    if (cached.expiresAt > now) return cached.value
    s3FileExistsCache.delete(key)
  }

  const existing = s3FileExistsInflight.get(key)
  if (existing) return existing

  const requestGeneration = s3FileExistsGenerations.get(key) ?? 0
  const checkPromise = (async () => {
    try {
      await getS3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
      if ((s3FileExistsGenerations.get(key) ?? 0) === requestGeneration) {
        setS3FileExistsCache(key, true, S3_FILE_EXISTS_CACHE_TTL_MS)
      }
      return true
    } catch (err: unknown) {
      // HeadObject throws NotFound (not NoSuchKey) per AWS SDK v3 spec. Some
      // S3-compatible providers surface 404 through the response metadata.
      if (isS3NotFoundError(err)) {
        if ((s3FileExistsGenerations.get(key) ?? 0) === requestGeneration) {
          setS3FileExistsCache(key, false, S3_FILE_MISSING_CACHE_TTL_MS)
        }
        return false
      }
      const e = err as { $metadata?: { httpStatusCode?: number }; message?: string }
      const status = e?.$metadata?.httpStatusCode
      // Do not cache provider/network failures: the next request should be
      // able to recover immediately when the backend becomes available.
      throw new Error(`S3 HeadObject failed for key "${key}"${status ? ` (HTTP ${status})` : ''}: ${e?.message ?? String(err)}`)
    }
  })()

  s3FileExistsInflight.set(key, checkPromise)
  try {
    return await checkPromise
  } finally {
    if (s3FileExistsInflight.get(key) === checkPromise) {
      s3FileExistsInflight.delete(key)
      s3FileExistsGenerations.delete(key)
    }
  }
}

// ─── Multipart upload ────────────────────────────────────────────────────────

/** Start a multipart upload and return the UploadId. */
export async function s3InitiateMultipartUpload(
  key: string,
  contentType: string = 'application/octet-stream'
): Promise<string> {
  const res = await getS3Client().send(
    new CreateMultipartUploadCommand({
      Bucket: getS3Bucket(),
      Key: key,
      ContentType: contentType,
      ...(getMediaCacheControl(key) ? { CacheControl: getMediaCacheControl(key) } : {}),
    })
  )
  if (!res.UploadId) throw new Error('Failed to initiate multipart upload')
  return res.UploadId
}

/** Return a presigned PUT URL for one part of a multipart upload. */
export async function s3GetPresignedPartUrl(
  key: string,
  uploadId: string,
  partNumber: number,
  expirySeconds: number = 3600
): Promise<string> {
  return getSignedUrl(
    getS3Client(),
    new UploadPartCommand({ Bucket: getS3Bucket(), Key: key, UploadId: uploadId, PartNumber: partNumber }),
    { expiresIn: expirySeconds }
  )
}

/** Assemble a completed multipart upload from its parts. */
export async function s3CompleteMultipartUpload(
  key: string,
  uploadId: string,
  parts: CompletedPart[]
): Promise<void> {
  invalidateS3FileExistsCache(key)
  await getS3Client().send(
    new CompleteMultipartUploadCommand({
      Bucket: getS3Bucket(),
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    })
  )
  markS3FileExistsCache(key, true, S3_FILE_EXISTS_CACHE_TTL_MS)
}

/** Abort an incomplete multipart upload to free storage. */
export async function s3AbortMultipartUpload(key: string, uploadId: string): Promise<void> {
  await getS3Client().send(
    new AbortMultipartUploadCommand({ Bucket: getS3Bucket(), Key: key, UploadId: uploadId })
  )
}

/** Abort all multipart uploads in the bucket that were initiated before cutoffDate. */
export async function s3AbortIncompleteMultipartUploadsOlderThan(cutoffDate: Date): Promise<number> {
  const client = getS3Client()
  const bucket = getS3Bucket()

  let abortedCount = 0
  let keyMarker: string | undefined
  let uploadIdMarker: string | undefined

  do {
    const listRes = await client.send(
      new ListMultipartUploadsCommand({
        Bucket: bucket,
        KeyMarker: keyMarker,
        UploadIdMarker: uploadIdMarker,
      })
    )

    const uploads = listRes.Uploads ?? []
    for (const upload of uploads) {
      if (!upload.Key || !upload.UploadId || !upload.Initiated) {
        continue
      }

      if (upload.Initiated.getTime() >= cutoffDate.getTime()) {
        continue
      }

      await client.send(
        new AbortMultipartUploadCommand({
          Bucket: bucket,
          Key: upload.Key,
          UploadId: upload.UploadId,
        })
      )
      abortedCount++
    }

    keyMarker = listRes.IsTruncated ? listRes.NextKeyMarker : undefined
    uploadIdMarker = listRes.IsTruncated ? listRes.NextUploadIdMarker : undefined
  } while (keyMarker)

  return abortedCount
}

// ─── Presigned GET URLs ───────────────────────────────────────────────────────

/** Presigned download URL. Adds Content-Disposition when filename is provided. */
export async function s3GetPresignedDownloadUrl(
  key: string,
  expirySeconds: number = 3600,
  filename?: string,
  _contentType?: string
): Promise<string> {
  return getSignedUrl(
    getS3Client(),
    new GetObjectCommand({
      Bucket: getS3Bucket(),
      Key: key,
      ...(filename && {
        ResponseContentDisposition:
          `attachment; filename="${filename.replace(/["\\]/g, '')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      }),
    }),
    { expiresIn: expirySeconds }
  )
}

/** Presigned streaming URL (no Content-Disposition — browser plays inline). */
export async function s3GetPresignedStreamUrl(
  key: string,
  expirySeconds: number = 14400,
  _contentType?: string
): Promise<string> {
  const cdnUrl = getCdnStreamUrl(key, expirySeconds)
  if (cdnUrl) return cdnUrl

  return getSignedUrl(
    getS3Client(),
    new GetObjectCommand({
      Bucket: getS3Bucket(),
      Key: key,
    }),
    { expiresIn: expirySeconds }
  )
}

/** Presigned origin URL for server-side probing. This deliberately bypasses CDN routing. */
export async function s3GetPresignedOriginStreamUrl(
  key: string,
  expirySeconds: number = 600
): Promise<string> {
  return getSignedUrl(
    getS3Client(),
    new GetObjectCommand({
      Bucket: getS3Bucket(),
      Key: key,
    }),
    { expiresIn: expirySeconds }
  )
}
