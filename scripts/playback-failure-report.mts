/**
 * Playback failure report / alert probe.
 *
 *   npx tsx scripts/playback-failure-report.mts --hours=24
 *   npx tsx scripts/playback-failure-report.mts --buckets=2026110309,2026110317
 *   npx tsx scripts/playback-failure-report.mts --failed-threshold=5 --auth-threshold=3 --video-threshold=6 --cause-threshold=5
 *
 * Counters come from POST /api/playback/failure (7-day TTL). Exit code 1 when
 * any hour crosses the failure threshold, auth refusals cross their own
 * threshold, a single cause crosses its threshold, or one video crosses its
 * per-video threshold, so a cron/webhook (or the scheduled GitHub workflow)
 * can alert on it.
 */
import 'dotenv/config'
import { getRedis } from '../src/lib/redis'

const args = new Map<string, string>()
for (const arg of process.argv.slice(2)) {
  const [key, value = 'true'] = arg.replace(/^--/, '').split('=')
  args.set(key, value)
}

const hours = Math.max(1, Math.min(168, Number(args.get('hours') || 24)))
// Real traffic is a handful of reviewers, not a stadium: the 11-03 incident
// peaked at 8 failed/hour. The internal acceptance automation opens one video
// about 4 times/hour, so the thresholds sit two events above that noise but
// below the 8/h incident: total 6, per-cause 6, per-video 6. The incident is
// then caught by total/cause; a single automated video alone never trips the
// per-video alarm.
const failedThreshold = Math.max(1, Number(args.get('failed-threshold') || 6))
const authThreshold = Math.max(1, Number(args.get('auth-threshold') || 3))
const videoThreshold = Math.max(1, Number(args.get('video-threshold') || 6))
const causeThreshold = Math.max(1, Number(args.get('cause-threshold') || 6))

const explicitBuckets = (args.get('buckets') || '')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => /^\d{10}$/.test(value))

function bucketNow(): string {
  return new Date().toISOString().slice(0, 13).replace(/[-T]/g, '')
}

function shiftBucket(bucket: string, deltaHours: number): string {
  const date = new Date(Date.UTC(
    Number(bucket.slice(0, 4)),
    Number(bucket.slice(4, 6)) - 1,
    Number(bucket.slice(6, 8)),
    Number(bucket.slice(8, 10)) + deltaHours,
  ))
  return date.toISOString().slice(0, 13).replace(/[-T]/g, '')
}

// The scheduled workflow is delayed by GitHub and can run 5-8 hours apart.
// A one-hour window therefore misses the hour that triggered the alert before
// the previous run even started. The cursor window covers every complete hour
// since the last successful evaluation, and leaves the current partial hour
// for the next run so a late event cannot fall through the gap.
const nowBucketArg = args.get('now-bucket')
const nowBucket = nowBucketArg && /^\d{10}$/.test(nowBucketArg) ? nowBucketArg : bucketNow()
const lastCompleteBucket = shiftBucket(nowBucket, -1)
function bucketFor(offsetHours: number): string {
  return shiftBucket(nowBucket, -offsetHours)
}

const useCursor = args.get('cursor') === 'true' && explicitBuckets.length === 0
const cursorKey = args.get('cursor-key') || 'playback_failure:report:last_evaluated_bucket'

const redis = getRedis()
const storedCursor = useCursor ? await redis.get(cursorKey) : null
const cursor = storedCursor && /^\d{10}$/.test(storedCursor) ? storedCursor : null

const earliestBucket = shiftBucket(lastCompleteBucket, -167)
let windowStart: string | null = null
let wantedBucketList: string[]
if (explicitBuckets.length > 0) {
  wantedBucketList = explicitBuckets
} else if (useCursor) {
  const fallbackStart = shiftBucket(lastCompleteBucket, -(hours - 1))
  // A valid cursor wins even when the outage is longer than the fallback
  // window; the 168-hour cap matches the Redis counter TTL.
  let start = cursor ? shiftBucket(cursor, 1) : fallbackStart
  if (start < earliestBucket) start = earliestBucket
  windowStart = start
  wantedBucketList = []
  if (start <= lastCompleteBucket) {
    for (let bucket = start; bucket <= lastCompleteBucket && wantedBucketList.length < 168; bucket = shiftBucket(bucket, 1)) {
      wantedBucketList.push(bucket)
    }
  }
} else {
  wantedBucketList = Array.from({ length: hours }, (_, index) => bucketFor(index))
}
const wantedBuckets = new Set(wantedBucketList)
if (useCursor) {
  console.log(`cursor=${cursor ?? 'none'} window=${wantedBucketList[0] ?? '-'}..${lastCompleteBucket}`)
}

const keys: string[] = []
let scanCursor = '0'
do {
  const [next, batch] = await redis.scan(scanCursor, 'MATCH', 'playback_failure:*', 'COUNT', 500)
  scanCursor = next
  keys.push(...batch)
} while (scanCursor !== '0')

type Row = {
  total: number
  failed: number
  recovered: number
  fallback: number
  causes: Map<string, number>
  qualities: Map<string, number>
  sourceQuality: Map<string, number>
}

const emptyRow = (): Row => ({
  total: 0,
  failed: 0,
  recovered: 0,
  fallback: 0,
  causes: new Map(),
  qualities: new Map(),
  sourceQuality: new Map(),
})

const rows = new Map<string, Row>()
const videoTotals = new Map<string, number>()
const failedVideoTotals = new Map<string, number>()
// A multi-hour window must not turn 4 failures/hour of automation into a
// 96-failure "video" and trip the threshold. The per-video alarm is about one
// hour, so keep the maximum single-bucket count, not the window sum.
const failedVideoMaxPerBucket = new Map<string, number>()

const wanted = keys.filter((key) => {
  const parts = key.split(':')
  if (parts[1] === 'hour') return Boolean(parts[2] && wantedBuckets.has(parts[2]))
  if (parts[1] === 'video' || parts[1] === 'video_failed') {
    return Boolean(parts[3] && wantedBuckets.has(parts[3]))
  }
  return false
})

const values = wanted.length > 0 ? await redis.mget(...wanted) : []

wanted.forEach((key, index) => {
  const parts = key.split(':')
  const value = Number(values[index] || 0)
  if (!Number.isFinite(value) || value <= 0) return

  if (parts[1] === 'video' || parts[1] === 'video_failed') {
    const videoId = parts[2]
    if (!videoId) return
    const totals = parts[1] === 'video_failed' ? failedVideoTotals : videoTotals
    totals.set(videoId, (totals.get(videoId) || 0) + value)
    if (parts[1] === 'video_failed') {
      failedVideoMaxPerBucket.set(videoId, Math.max(failedVideoMaxPerBucket.get(videoId) || 0, value))
    }
    return
  }

  const bucket = parts[2]
  if (!bucket || !wantedBuckets.has(bucket)) return
  const row = rows.get(bucket) || emptyRow()
  if (parts[3] === 'total') row.total += value
  else if (parts[3] === 'failed') row.failed += value
  else if (parts[3] === 'recovered') row.recovered += value
  else if (parts[3] === 'fallback') row.fallback += value
  else if (parts[3] === 'cause' && parts[4]) row.causes.set(parts[4], (row.causes.get(parts[4]) || 0) + value)
  else if (parts[3] === 'quality' && parts[4]) row.qualities.set(parts[4], (row.qualities.get(parts[4]) || 0) + value)
  else if (parts[3] === 'source_quality' && parts[4]) row.sourceQuality.set(parts[4], (row.sourceQuality.get(parts[4]) || 0) + value)
  rows.set(bucket, row)
})

const allCauses = ['auth', 'network', 'decode', 'unsupported', 'unavailable', 'unknown']
const allQualities = ['hls', '720p', '1080p', '2160p', 'source', 'unknown']
const ordered = [...rows.entries()].sort(([a], [b]) => a.localeCompare(b))
const scope = explicitBuckets.length > 0
  ? `buckets ${explicitBuckets.join(',')}`
  : useCursor
    ? `window ${wantedBucketList[0] ?? '-'}..${lastCompleteBucket} (cursor ${cursor ?? 'none'})`
    : `last ${hours}h`

console.log(`playback failures — ${scope} (failed ${failedThreshold}/h, auth ${authThreshold}/h, video ${videoThreshold}/h, cause ${causeThreshold}/h)`)
console.log(['hour', 'total', 'failed', 'recovered', 'fallback', ...allCauses].join('\t'))
let totalFailed = 0
let totalAuth = 0
let totalFallback = 0
let breached = false
const causeTotals = new Map<string, number>()

for (const [bucket, row] of ordered) {
  const auth = row.causes.get('auth') || 0
  totalFailed += row.failed
  totalAuth += auth
  totalFallback += row.fallback
  for (const [cause, count] of row.causes) {
    causeTotals.set(cause, (causeTotals.get(cause) || 0) + count)
  }
  // A single cause crossing its own threshold is the earliest usable signal:
  // a CDN/refusal burst stays visible even when the total is still small.
  const highestCause = Math.max(0, ...row.causes.values())
  if (row.failed >= failedThreshold || auth >= authThreshold || highestCause >= causeThreshold) breached = true
  console.log([
    bucket,
    row.total,
    row.failed,
    row.recovered,
    row.fallback,
    ...allCauses.map((cause) => row.causes.get(cause) || 0),
  ].join('\t'))
}

console.log('\nquality/sourceQuality distribution (all events):')
console.log(['hour', ...allQualities, 'sourceQ=true', 'sourceQ=false'].join('\t'))
for (const [bucket, row] of ordered) {
  console.log([
    bucket,
    ...allQualities.map((quality) => row.qualities.get(quality) || 0),
    row.sourceQuality.get('true') || 0,
    row.sourceQuality.get('false') || 0,
  ].join('\t'))
}

const topVideos = [...videoTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
const failedVideoAlerts = [...failedVideoMaxPerBucket.entries()]
  .filter(([, count]) => count >= videoThreshold)
  .sort((a, b) => b[1] - a[1])
if (failedVideoAlerts.length > 0) breached = true

console.log(`\nfailed=${totalFailed} auth=${totalAuth} fallback=${totalFallback}`)
if (topVideos.length > 0) {
  console.log('top videos (all events):')
  for (const [videoId, count] of topVideos) console.log(`  ${videoId}\t${count}`)
}
if (failedVideoAlerts.length > 0) {
  console.log(`videos over ${videoThreshold} failed in one hour: ${failedVideoAlerts.length}`)
  for (const [videoId, maxCount] of failedVideoAlerts.slice(0, 10)) {
    console.log(`  failed ${videoId}\tmax/hour=${maxCount}\ttotal=${failedVideoTotals.get(videoId) || 0}`)
  }
}

// Advance even when this run alerts: the cursor is an "already evaluated"
// marker, not an "all clear" marker. Without that, a wide window would report
// the same old bucket on every delayed schedule run. If the process dies
// before this point, the cursor stays put and the next run covers the gap.
if (useCursor && lastCompleteBucket && (!cursor || lastCompleteBucket > cursor)) {
  await redis.set(cursorKey, lastCompleteBucket, 'EX', 30 * 24 * 60 * 60).catch(() => undefined)
  console.log(`cursor advanced: ${cursor ?? 'none'} -> ${lastCompleteBucket}`)
}

redis.disconnect()

if (breached) {
  const causeSummary = [...causeTotals.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([cause, count]) => `${cause}:${count}`)
    .join(',')
  console.error(
    `\nALERT: failure rate crossed a threshold (failed=${totalFailed}, auth=${totalAuth}, fallback=${totalFallback}, causes=${causeSummary || 'none'})`,
  )
  process.exitCode = 1
}
