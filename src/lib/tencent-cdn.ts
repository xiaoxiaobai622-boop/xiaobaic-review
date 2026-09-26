import { getRedis } from './redis'
import { getCdnObjectUrl } from './s3-storage'
import { callTencentApi } from './tencent-tc3'

const SERVICE = 'cdn'
const VERSION = '2018-06-06'
const HOST = 'cdn.tencentcloudapi.com'
const URLS_PER_TASK = 500
const DAILY_URL_LIMIT = 9000

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

export function isCdnPrefetchEnabled(): boolean {
  return process.env.MEDIA_CDN_ENABLED === 'true'
    && Boolean(process.env.MEDIA_CDN_BASE_URL?.trim())
    && process.env.MEDIA_CDN_PREFETCH !== 'false'
}

async function readPlaylist(manifestUrl: string): Promise<string[]> {
  const response = await fetch(manifestUrl, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
  if (!response.ok) return []
  const urls: string[] = []
  for (const line of (await response.text()).split('\n')) {
    const uri = line.trim()
    if (!uri || uri.startsWith('#')) continue
    urls.push(new URL(uri, manifestUrl).toString())
  }
  return urls
}

/**
 * Read-modify-write of the daily counter in one Lua script, so two prefatches
 * running at the same time cannot both see the same headroom and overspend the
 * account's daily quota. Returns the number of URLs actually reserved.
 */
const RESERVE_SCRIPT = `
  local used = tonumber(redis.call('GET', KEYS[1]) or '0') or 0
  local room = tonumber(ARGV[1]) - used
  if room <= 0 then
    return 0
  end
  local wanted = tonumber(ARGV[2])
  if room > wanted then
    room = wanted
  end
  redis.call('INCRBY', KEYS[1], room)
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
  return room
`

async function reserveFromDailyBudget(urlCount: number): Promise<number> {
  const limit = Math.max(0, Number(process.env.MEDIA_CDN_PREFETCH_DAILY_LIMIT || DAILY_URL_LIMIT))
  const key = `cdn_prefetch:${new Date().toISOString().slice(0, 10)}`
  const redis = getRedis()
  const reserved = await redis.eval(RESERVE_SCRIPT, 1, key, String(limit), String(urlCount), String(26 * 60 * 60))
  return Math.max(0, Number(reserved) || 0)
}

/**
 * Pull a freshly transcoded rendition onto the CDN nodes before anyone tries to
 * watch it. A segment the node has never served costs about 1.4s against 0.13s
 * once cached, and reviewers read that gap as stutter and as a failed seek when
 * they jump to a comment.
 *
 * The account allows 10000 prefetched URLs a day and every segment counts against
 * that, so the app keeps its own share below the quota (override with
 * MEDIA_CDN_PREFETCH_DAILY_LIMIT) instead of letting a bulk re-transcode starve
 * later uploads. Playlists are expanded here because the API only warms exact URLs.
 */
export async function prefetchHlsRendition(hlsPath: string): Promise<{ submitted: number; skipped: number; taskId?: string }> {
  const manifestUrl = getCdnObjectUrl(hlsPath)
  const urls = [manifestUrl, ...await readPlaylist(manifestUrl)]

  const room = await reserveFromDailyBudget(urls.length)
  if (room === 0) return { submitted: 0, skipped: urls.length }

  const allowed = urls.slice(0, room)
  let taskId: string | undefined
  for (let offset = 0; offset < allowed.length; offset += URLS_PER_TASK) {
    const response = await callTencentApi({
      service: SERVICE,
      host: HOST,
      version: VERSION,
      region: '',
      secretId: required('S3_ACCESS_KEY_ID'),
      secretKey: required('S3_SECRET_ACCESS_KEY'),
      action: 'PushUrlsCache',
      payload: { Urls: allowed.slice(offset, offset + URLS_PER_TASK), Area: 'mainland' },
    })
    taskId = response?.TaskId ?? taskId
  }
  return { submitted: allowed.length, skipped: urls.length - allowed.length, taskId }
}

/**
 * Warm a batch of renditions for an operator backfill. This is the only safe
 * entry point for bulk prewarming because every URL goes through the same daily
 * budget the transcode path uses: a hand-rolled caller spends the account's
 * quota while the app's counter stays asleep, and the uploads after it find no
 * headroom. Stops at the first rendition the budget refuses instead of asking
 * once per remaining file, and reports how many were left for the next day.
 */
export async function prefetchRenditions(hlsPaths: string[]): Promise<{ attempted: number; submitted: number; left: number }> {
  let attempted = 0
  let submitted = 0
  for (const hlsPath of hlsPaths) {
    const result = await prefetchHlsRendition(hlsPath)
    attempted += 1
    submitted += result.submitted
    if (result.submitted === 0) break
  }
  return { attempted, submitted, left: hlsPaths.length - attempted }
}
