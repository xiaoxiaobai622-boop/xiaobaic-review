/**
 * Playback failure report / alert probe.
 *
 *   npx tsx scripts/playback-failure-report.mts --hours=24
 *   npx tsx scripts/playback-failure-report.mts --failed-threshold=20 --auth-threshold=5 --video-threshold=5
 *
 * Counters come from POST /api/playback/failure (7-day TTL). Exit code 1 when
 * any hour crosses the failure threshold, auth refusals cross their own
 * threshold, or one video crosses its per-video threshold, so a cron/webhook
 * (or the scheduled GitHub workflow) can alert on it.
 */
import 'dotenv/config'
import { getRedis } from '../src/lib/redis'

const args = new Map<string, string>()
for (const arg of process.argv.slice(2)) {
  const [key, value = 'true'] = arg.replace(/^--/, '').split('=')
  args.set(key, value)
}

const hours = Math.max(1, Math.min(168, Number(args.get('hours') || 24)))
const failedThreshold = Math.max(1, Number(args.get('failed-threshold') || 20))
const authThreshold = Math.max(1, Number(args.get('auth-threshold') || 5))
const videoThreshold = Math.max(1, Number(args.get('video-threshold') || 5))

function bucketFor(offsetHours: number): string {
  return new Date(Date.now() - offsetHours * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 13)
    .replace(/[-T]/g, '')
}

const wantedBuckets = new Set(Array.from({ length: hours }, (_, index) => bucketFor(index)))

const redis = getRedis()
const keys: string[] = []
let cursor = '0'
do {
  const [next, batch] = await redis.scan(cursor, 'MATCH', 'playback_failure:*', 'COUNT', 500)
  cursor = next
  keys.push(...batch)
} while (cursor !== '0')

type Row = {
  total: number
  failed: number
  recovered: number
  fallback: number
  causes: Map<string, number>
}

const emptyRow = (): Row => ({
  total: 0,
  failed: 0,
  recovered: 0,
  fallback: 0,
  causes: new Map(),
})

const rows = new Map<string, Row>()
const videoTotals = new Map<string, number>()
const failedVideoTotals = new Map<string, number>()

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
  rows.set(bucket, row)
})

const allCauses = ['auth', 'network', 'decode', 'unsupported', 'unavailable', 'unknown']
const ordered = [...rows.entries()].sort(([a], [b]) => a.localeCompare(b))

console.log(`playback failures — last ${hours}h (failed ${failedThreshold}/h, auth ${authThreshold}/h, video ${videoThreshold}/h)`)
console.log(['hour', 'total', 'failed', 'recovered', 'fallback', ...allCauses].join('\t'))
let totalFailed = 0
let totalAuth = 0
let totalFallback = 0
let breached = false

for (const [bucket, row] of ordered) {
  const auth = row.causes.get('auth') || 0
  totalFailed += row.failed
  totalAuth += auth
  totalFallback += row.fallback
  if (row.failed >= failedThreshold || auth >= authThreshold) breached = true
  console.log([
    bucket,
    row.total,
    row.failed,
    row.recovered,
    row.fallback,
    ...allCauses.map((cause) => row.causes.get(cause) || 0),
  ].join('\t'))
}

const topVideos = [...videoTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
const topFailedVideos = [...failedVideoTotals.entries()].sort((a, b) => b[1] - a[1])
if (topFailedVideos.some(([, count]) => count >= videoThreshold)) breached = true

console.log(`\nfailed=${totalFailed} auth=${totalAuth} fallback=${totalFallback}`)
if (topVideos.length > 0) {
  console.log('top videos (all events):')
  for (const [videoId, count] of topVideos) console.log(`  ${videoId}\t${count}`)
}
if (topFailedVideos.length > 0) {
  console.log(`videos over ${videoThreshold} failed: ${topFailedVideos.filter(([, count]) => count >= videoThreshold).length}`)
  for (const [videoId, count] of topFailedVideos.slice(0, 10)) console.log(`  failed ${videoId}\t${count}`)
}

redis.disconnect()

if (breached) {
  console.error(`\nALERT: failure rate crossed a threshold (failed=${totalFailed}, auth=${totalAuth}, fallback=${totalFallback})`)
  process.exitCode = 1
}
