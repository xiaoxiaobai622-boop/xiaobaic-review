/**
 * Focused checks for the background 1080p MP4 path. No worker and no database:
 * every assertion is a pure helper or a callback-route rejection that returns
 * before touching Prisma.
 *
 *   node --import tsx scripts/check-local-1080.mts
 */
import { POST as local1080Callback } from '../src/app/api/internal/local-1080/callback/route'
import {
  clipPreferredQuality,
  isLocal1080Ready,
  local1080MenuState,
  resolvePlaybackSource,
} from '../src/lib/playback-quality'
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

// --- Player quality menu (pure selection helpers) ---------------------------
// PENDING/PROCESSING stay disabled with the "transcoding" label; READY only
// counts once the token-minted MP4 URL exists; every other state is not usable.
equal(local1080MenuState('PENDING', false), 'processing', 'PENDING menu row is transcoding')
equal(local1080MenuState('PROCESSING', false), 'processing', 'PROCESSING menu row is transcoding')
equal(local1080MenuState('READY', true), 'ready', 'READY with a stream enables 1080')
equal(local1080MenuState('READY', false), 'unavailable', 'READY without a stream is unavailable')
equal(local1080MenuState('ERROR', false), 'unavailable', 'ERROR menu row is unavailable')
equal(local1080MenuState('NONE', false), 'unavailable', 'NONE menu row is unavailable')
equal(local1080MenuState(undefined, false), 'unavailable', 'missing status menu row is unavailable')

check(isLocal1080Ready({ local1080Status: 'READY', streamUrl1080p: '/api/content/t' }), 'READY + URL is playable')
check(!isLocal1080Ready({ local1080Status: 'READY', streamUrl1080p: '' }), 'READY without URL is not playable')
check(!isLocal1080Ready({ local1080Status: 'PROCESSING', streamUrl1080p: '/api/content/t' }), 'PROCESSING is not playable')

equal(
  clipPreferredQuality('1080p', { local1080Status: 'PROCESSING', streamUrl1080p: '' }),
  '720p',
  'preferred 1080 clips to 720 while transcoding',
)
equal(
  clipPreferredQuality('1080p', { local1080Status: 'READY', streamUrl1080p: '/api/content/t' }),
  '1080p',
  'preferred 1080 survives a READY rendition',
)
equal(
  clipPreferredQuality('1080p', { local1080Status: 'READY', streamUrl1080p: '' }),
  '720p',
  'preferred 1080 clips when no URL was minted',
)
equal(
  clipPreferredQuality('1080p', { local1080Status: undefined, streamUrl1080p: '/api/content/t' }),
  '1080p',
  'share payloads without status keep their 1080 default',
)
equal(
  clipPreferredQuality('1080p', { local1080Status: null, streamUrl1080p: '' }),
  '1080p',
  'null status keeps legacy behaviour',
)
equal(
  clipPreferredQuality('720p', { local1080Status: 'READY', streamUrl1080p: '/api/content/t' }),
  '720p',
  '720 stays 720',
)
equal(
  clipPreferredQuality('2160p', { local1080Status: 'PROCESSING', streamUrl1080p: '' }),
  '2160p',
  'other qualities are untouched',
)

const menuVideo = {
  id: 'v1',
  streamUrl720p: '/api/content/720',
  streamUrl1080p: '/api/content/1080',
  hlsUrl720p: '/api/content/hls',
}
const chosen1080 = resolvePlaybackSource(menuVideo, '1080p', false)
equal(chosen1080.url, '/api/content/1080', '1080 preference plays the MP4 URL')
equal(chosen1080.hlsUrl, '', '1080 preference does not attach HLS')
equal(chosen1080.quality, '1080p', '1080 preference reports 1080')
const legacy1080 = resolvePlaybackSource(menuVideo, '1080p', true)
equal(legacy1080.hlsUrl, '/api/content/hls', 'HLS still wins when supportsHls is true')
equal(legacy1080.quality, '720p', 'HLS playback still reports 720')
const chosen720 = resolvePlaybackSource(menuVideo, '720p', true)
equal(chosen720.url, '/api/content/720', '720 preference keeps the progressive 720 URL')
equal(chosen720.hlsUrl, '/api/content/hls', '720 preference keeps HLS')
const fallback720 = resolvePlaybackSource(
  { id: 'v1', streamUrl720p: '/api/content/720', hlsUrl720p: '/api/content/hls' },
  '1080p',
  false,
)
equal(fallback720.url, '/api/content/720', 'missing 1080 stream falls back to 720 MP4')
equal(fallback720.quality, '720p', 'missing 1080 stream reports 720')
const sourcePreferred = resolvePlaybackSource(
  { id: 'v1', sourceUrl: '/api/content/source', streamUrl1080p: '/api/content/1080' },
  '1080p',
  false,
  true,
)
equal(sourcePreferred.url, '/api/content/source', 'source quality still wins over 1080')

console.log('local-1080 checks passed')
