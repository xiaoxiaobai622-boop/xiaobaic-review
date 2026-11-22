/**
 * Focused checks for the background 1080p MP4 path. No worker and no database:
 * every assertion is a pure helper or a callback-route rejection that returns
 * before touching Prisma.
 *
 *   node --import tsx scripts/check-local-1080.mts
 */
import { POST as local1080Callback } from '../src/app/api/internal/local-1080/callback/route'
import {
  LOCAL_1080_ERROR_MAX_LENGTH,
  buildLocal1080JobPayload,
  local1080CallbackUrl,
  local1080JobsUrl,
  local1080OutputKey,
  parseLocal1080CallbackBody,
  readLocal1080Config,
  sanitizeLocal1080Error,
  sourceSupportsLocal1080,
  verifyBearerToken,
} from '../src/lib/local-1080'

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function equal(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

// --- Config gating -----------------------------------------------------------
const enabledEnv = {
  LOCAL_1080_ENABLED: 'true',
  LOCAL_1080_WORKER_URL: 'https://transcode.example.com/',
  LOCAL_1080_WORKER_SECRET: '  shared-secret  ',
} as unknown as NodeJS.ProcessEnv
equal(readLocal1080Config(enabledEnv)?.workerUrl, 'https://transcode.example.com', 'worker URL is normalized')
equal(readLocal1080Config(enabledEnv)?.secret, 'shared-secret', 'secret is trimmed')
equal(readLocal1080Config({ ...enabledEnv, LOCAL_1080_ENABLED: 'false' }), null, 'disabled config skips')
equal(readLocal1080Config({ ...enabledEnv, LOCAL_1080_WORKER_SECRET: '' }), null, 'missing secret skips')
equal(readLocal1080Config({ ...enabledEnv, LOCAL_1080_WORKER_URL: '' }), null, 'missing URL skips')
equal(readLocal1080Config({ ...enabledEnv, LOCAL_1080_WORKER_URL: 'ftp://transcode' }), null, 'non-http URL skips')

equal(local1080JobsUrl('https://transcode.example.com'), 'https://transcode.example.com/jobs', 'jobs URL from base')
equal(local1080JobsUrl('https://transcode.example.com/'), 'https://transcode.example.com/jobs', 'jobs URL from base with slash')
equal(local1080JobsUrl('https://transcode.example.com/jobs'), 'https://transcode.example.com/jobs', 'jobs URL is not doubled')

// --- Keys / URLs / payload ---------------------------------------------------
const key = local1080OutputKey('team 1', 'project/2', 'video3')
equal(key, 'teams/team 1/projects/project/2/videos/video3/preview-1080.mp4', 'canonical output key')

equal(local1080CallbackUrl('https://vidx.cn/'), 'https://vidx.cn/api/internal/local-1080/callback', 'callback URL trims slash')

const payload = buildLocal1080JobPayload({
  videoId: 'v1',
  sourceUrl: 'https://s3.example/source?sig=1',
  uploadUrl: 'https://s3.example/out?sig=2',
  outputKey: key,
  callbackUrl: 'https://vidx.cn/api/internal/local-1080/callback',
})
equal(payload.contentType, 'video/mp4', 'payload content type')

// --- Source support (same short-side >= 1080 rule as local previews) ---------
const sourceCases: Array<[number, number, boolean, string]> = [
  [1920, 1080, true, '1080p landscape'],
  [3840, 2160, true, '4K landscape'],
  [2560, 1440, true, '1440p landscape'],
  [1080, 1920, true, '1080x1920 portrait'],
  [2160, 3840, true, '2160x3840 portrait'],
  [1280, 720, false, '720p landscape'],
  [720, 1280, false, '720x1280 portrait'],
  [1920, 800, false, 'ultrawide below 1080 short side'],
  [0, 1080, false, 'zero dimension'],
]
for (const [width, height, expected, label] of sourceCases) {
  equal(sourceSupportsLocal1080(width, height), expected, `source support: ${label}`)
}

// --- Bearer auth -------------------------------------------------------------
check(verifyBearerToken('Bearer shared-secret', 'shared-secret'), 'correct bearer accepted')
check(!verifyBearerToken('Bearer wrong-secret', 'shared-secret'), 'wrong bearer rejected')
check(!verifyBearerToken('bearer shared-secret', 'shared-secret'), 'scheme is case-sensitive')
check(!verifyBearerToken('Basic shared-secret', 'shared-secret'), 'wrong scheme rejected')
check(!verifyBearerToken('Bearer shared-secret', ''), 'empty secret rejects')
check(!verifyBearerToken('Bearer short', 'shared-secret-long'), 'length mismatch rejects')
check(!verifyBearerToken(null, 'shared-secret'), 'missing header rejects')

// --- Error sanitising --------------------------------------------------------
const sanitized = sanitizeLocal1080Error(
  new Error('GET https://s3.example/object.mp4?X-Amz-Signature=leak&X-Amz-Credential=leak failed\nsecond line'),
)
check(!sanitized.includes('X-Amz-Signature'), 'error text drops presigned query')
check(!sanitized.includes('\n'), 'error text collapses newlines')
equal(sanitizeLocal1080Error('x'.repeat(2000)).length, LOCAL_1080_ERROR_MAX_LENGTH, 'error text is truncated')

// --- Callback body validation ------------------------------------------------
const ready = parseLocal1080CallbackBody({ videoId: 'v1', status: 'READY', outputKey: key })
check(ready.ok, 'READY body accepted')
const missingKey = parseLocal1080CallbackBody({ videoId: 'v1', status: 'READY' })
check(!missingKey.ok, 'READY without outputKey rejected')
const errorBody = parseLocal1080CallbackBody({ videoId: 'v1', status: 'ERROR', error: 'boom' })
check(errorBody.ok, 'ERROR body accepted')
const badStatus = parseLocal1080CallbackBody({ videoId: 'v1', status: 'PROCESSING' })
check(!badStatus.ok, 'unknown status rejected')
const notObject = parseLocal1080CallbackBody([])
check(!notObject.ok, 'array body rejected')

// --- Callback route auth (all rejections happen before Prisma) ---------------
function callbackRequest(body: unknown, authorization?: string) {
  return new Request('http://localhost/api/internal/local-1080/callback', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify(body),
  })
}

const originalSecret = process.env.LOCAL_1080_WORKER_SECRET
try {
  delete process.env.LOCAL_1080_WORKER_SECRET
  const unconfigured = await local1080Callback(callbackRequest({}) as never)
  equal(unconfigured.status, 503, 'unconfigured secret returns 503')

  process.env.LOCAL_1080_WORKER_SECRET = 'check-secret'
  const unauthorized = await local1080Callback(callbackRequest({}) as never)
  equal(unauthorized.status, 401, 'missing bearer returns 401')

  const wrongBearer = await local1080Callback(callbackRequest({}, 'Bearer nope') as never)
  equal(wrongBearer.status, 401, 'wrong bearer returns 401')

  const invalidBody = await local1080Callback(callbackRequest({ videoId: 'v1', status: 'READY' }, 'Bearer check-secret') as never)
  equal(invalidBody.status, 400, 'READY without outputKey returns 400')
} finally {
  if (originalSecret === undefined) delete process.env.LOCAL_1080_WORKER_SECRET
  else process.env.LOCAL_1080_WORKER_SECRET = originalSecret
}

console.log('local-1080 checks passed')
