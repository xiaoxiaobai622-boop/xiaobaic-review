import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { prisma } from './db'
import { logError, logMessage } from './logging'
import { getClientIpAddress, maskEmail } from './utils'
import { getClientSessionTimeoutSeconds } from './settings'
import { getRedis } from './redis'
import { isShareSessionRevoked, isShareLinkRevoked } from './session-invalidation'
import { isAdminSessionRevoked } from './studio-session-registry'

type CachedValue<T> = { value: T; expiresAt: number; version?: string }
type SecuritySettingsResult = {
  hotlinkProtection: string
  ipRateLimit: number
  sessionRateLimit: number
  shareSessionRateLimit: number
  trackSecurityLogs: boolean
  trackAnalytics: boolean
}

const SECURITY_SETTINGS_CACHE_TTL_MS = 90_000
const securitySettingsCache: CachedValue<SecuritySettingsResult> = {
  value: {
    hotlinkProtection: 'LOG_ONLY',
    ipRateLimit: 1000,
    sessionRateLimit: 600,
    shareSessionRateLimit: 300,
    trackSecurityLogs: true,
    trackAnalytics: true
  },
  expiresAt: 0
}

const TOKEN_CACHE_TTL_MS = 10_000
// A minted content token is renewed while it keeps being used, but never past
// this absolute deadline, so a long review cannot outlive the mint. It matches
// the CDN stream URL lifetime handed out by /api/content.
const TOKEN_MAX_LIFETIME_SECONDS = 4 * 60 * 60
const TOKEN_CACHE_MAX_ENTRIES = 500
type CachedTokenEntry = CachedValue<VideoAccessToken>
const tokenVerificationCache = new Map<string, CachedTokenEntry>()
const TOKEN_REV_VERSION_KEY = 'video_token_rev_version'

export async function getCachedVideoAccessToken(
  videoId: string,
  projectId: string,
  quality: string,
  sessionId: string
): Promise<string | null> {
  const redis = getRedis()
  const cacheKey = `video_token_cache:${sessionId}:${videoId}:${quality}`
  const cachedToken = await redis.get(cacheKey)

  if (!cachedToken) return null

  const tokenData = await redis.get(`video_access:${cachedToken}`)
  return tokenData ? cachedToken : null
}

interface VideoAccessToken {
  videoId: string
  projectId: string
  quality: string
  sessionId: string
  ipAddress: string
  createdAt: number
  isAdmin: boolean
  // The share link this token was minted through. Revoking that link has to
  // reach the bytes, not only the page, and the project id is too coarse: a
  // project can carry several live links.
  shareId?: string
}

/**
 * Generate a time-limited video access token with session binding
 * Tokens are cached per session to prevent token proliferation
 */
export async function generateVideoAccessToken(
  videoId: string,
  projectId: string,
  quality: string,
  request: NextRequest,
  sessionId: string,
  options?: { skipCacheCheck?: boolean; shareId?: string },
): Promise<string> {
  const redis = getRedis()

  if (!options?.skipCacheCheck) {
    const cachedToken = await getCachedVideoAccessToken(videoId, projectId, quality, sessionId)
    if (cachedToken) {
      return cachedToken
    }
  }

  const token = crypto.randomBytes(16).toString('base64url')
  const ipAddress = getClientIpAddress(request)

  const tokenData: VideoAccessToken = {
    videoId,
    projectId,
    quality,
    sessionId,
    ipAddress,
    createdAt: Date.now(),
    isAdmin: sessionId.startsWith('admin:'),
    shareId: options?.shareId,
  }

  const ttlSeconds = await getClientSessionTimeoutSeconds()

  await redis.setex(
    `video_access:${token}`,
    ttlSeconds,
    JSON.stringify(tokenData)
  )

  await redis.setex(`video_token_cache:${sessionId}:${videoId}:${quality}`, ttlSeconds, token)

  return token
}

/**
 * Verify video access token and validate session binding
 */
export async function verifyVideoAccessToken(
  token: string,
  request: NextRequest,
  sessionId: string,
  rawTokenData?: string | null,
): Promise<VideoAccessToken | null> {
  const redis = getRedis()
  const now = Date.now()

  const revVersion = (await redis.get(TOKEN_REV_VERSION_KEY)) || '0'
  const cacheKey = `${token}:${sessionId}:${revVersion}`
  const cached = tokenVerificationCache.get(cacheKey)

  if (cached) {
    if (cached.expiresAt > now && cached.version === revVersion) {
      return cached.value
    }
    tokenVerificationCache.delete(cacheKey)
  }

  const key = `video_access:${token}`
  // The content endpoint already fetched this value to obtain the bound
  // session id. Reuse it when supplied, while keeping the Redis lookup for
  // callers that do not have a prefetched value.
  const data = rawTokenData === undefined ? await redis.get(key) : rawTokenData

  if (!data) {
    return null
  }

  let tokenData: VideoAccessToken
  try {
    tokenData = JSON.parse(data)

    if (!tokenData.videoId || !tokenData.projectId || !tokenData.sessionId) {
      logMessage(`[SECURITY] Invalid token data structure (tokenPrefix=${token.substring(0, 10)})`)
      return null
    }
  } catch (error) {
    logError(`[SECURITY] Failed to parse video access token data (tokenPrefix=${token.substring(0, 10)})`, error)
    return null
  }

  const isAdminSession = tokenData.isAdmin === true

  if (tokenData.sessionId !== sessionId) {
    await logSecurityEvent({
      type: 'TOKEN_SESSION_MISMATCH',
      severity: 'WARNING',
      projectId: tokenData.projectId,
      videoId: tokenData.videoId,
      sessionId,
      ipAddress: getClientIpAddress(request),
      details: { expectedSession: tokenData.sessionId }
    })

    return null
  }

  if (tokenData.shareId && await isShareLinkRevoked(tokenData.shareId)) return null

  if (isAdminSession) {
    const adminSessionId = tokenData.sessionId.startsWith('admin:')
      ? tokenData.sessionId.slice('admin:'.length)
      : ''
    if (!adminSessionId || await isAdminSessionRevoked(adminSessionId)) return null
  } else if (
    !tokenData.sessionId.startsWith('none:') &&
    !tokenData.sessionId.startsWith('guest:') &&
    await isShareSessionRevoked(tokenData.sessionId)
  ) {
    return null
  }

  tokenVerificationCache.set(cacheKey, {
    value: tokenData,
    expiresAt: now + TOKEN_CACHE_TTL_MS,
    version: revVersion
  })

  // Keep the in-process verification cache as the rate limiter for these
  // writes: at most one renewal per token per TOKEN_CACHE_TTL_MS.
  await renewVideoAccessToken(token, tokenData)

  if (tokenVerificationCache.size > TOKEN_CACHE_MAX_ENTRIES) {
    tokenVerificationCache.clear()
  }

  return tokenData
}

/**
 * Renew a content token that is still in active use. Without this the 15 minute
 * session TTL kills a URL the player legitimately holds, and /api/content starts
 * answering 403 for a viewer who is simply still watching.
 */
async function renewVideoAccessToken(
  token: string,
  tokenData: VideoAccessToken
): Promise<void> {
  const redis = getRedis()
  const secondsUsed = Math.floor((Date.now() - tokenData.createdAt) / 1000)
  const remaining = TOKEN_MAX_LIFETIME_SECONDS - secondsUsed

  if (remaining <= 0) return

  const lifetime = Math.min(await getClientSessionTimeoutSeconds(), remaining)

  // EXPIRE on a deleted key is a no-op, so a revoked session is never revived.
  await redis.expire(`video_access:${token}`, lifetime)
  await redis.expire(
    `video_token_cache:${tokenData.sessionId}:${tokenData.videoId}:${tokenData.quality}`,
    lifetime
  )
}

// Label-wise comparison, so `vidx.cn.evil.com` is no longer treated as our own
// host the way a plain substring test would.
function isSameOrSubdomain(host: string, domain: string): boolean {
  if (!host || !domain) return false
  return host === domain || host.endsWith('.' + domain)
}

// HOTLINK_ALLOWED_REFERER_HOSTS=servicewechat.com,m.baidu.com
let allowedRefererHostsCache: string[] | null = null
function getAllowedRefererHosts(): string[] {
  if (allowedRefererHostsCache === null) {
    allowedRefererHostsCache = (process.env.HOTLINK_ALLOWED_REFERER_HOSTS || '')
      .split(/[,\s]+/)
      .map(entry => entry.trim().toLowerCase())
      .filter(Boolean)
  }
  return allowedRefererHostsCache
}

/**
 * Detect potential hotlinking attempts using referer analysis and session validation
 *
 * A Referer is client-controlled, so this is deliberately not an access control:
 * the signed content token in front of it is. What it does decide is which
 * *ordinary* referrers our own players use, so BLOCK_STRICT can be turned on
 * without locking out real viewers.
 */
export async function detectHotlinking(
  request: NextRequest,
  sessionId: string,
  videoId: string,
  projectId: string
): Promise<{ isHotlinking: boolean; reason?: string; severity?: string }> {
  const redis = getRedis()
  
  const referer = request.headers.get('referer') || request.headers.get('origin')
  const host = request.headers.get('host')

  if (referer && host) {
    try {
      const refererUrl = new URL(referer)
      const refererHost = refererUrl.hostname.toLowerCase()
      const requestHost = host.toLowerCase().split(':')[0]

      if (!isSameOrSubdomain(refererHost, requestHost) && !isSameOrSubdomain(requestHost, refererHost)) {
        const blockedDomains = await getBlockedDomains()
        if (blockedDomains.some(domain => refererHost.includes(domain))) {
          return {
            isHotlinking: true,
            reason: `Blocked domain: ${refererHost}`,
            severity: 'CRITICAL'
          }
        }

        if (getAllowedRefererHosts().some(allowed => isSameOrSubdomain(refererHost, allowed))) {
          return { isHotlinking: false }
        }

        await logSecurityEvent({
          type: 'HOTLINK_DETECTED',
          severity: 'WARNING',
          projectId,
          videoId,
          sessionId,
          ipAddress: getClientIpAddress(request),
          referer,
          details: { refererHost }
        })

        return {
          isHotlinking: true,
          reason: `External referer: ${refererHost}`,
          severity: 'WARNING'
        }
      }
    } catch (error) {}
  }

  const freqKey = `video_freq:${sessionId}:${videoId}`
  const count = await redis.incr(freqKey)
  await redis.expire(freqKey, 300)

  if (count > 3000) {
    if (count % 500 === 0) {
      await logSecurityEvent({
        type: 'SUSPICIOUS_ACTIVITY',
        severity: 'WARNING',
        projectId,
        videoId,
        sessionId,
        ipAddress: getClientIpAddress(request),
        details: { requestCount: count, window: '5min' }
      })
    }

    return {
      isHotlinking: true,
      reason: `High frequency: ${count} requests in 5 min`,
      severity: 'WARNING'
    }
  }

  const ipAddress = getClientIpAddress(request)

  const blockedIPs = await getBlockedIPs()
  if (blockedIPs.includes(ipAddress)) {
    await logSecurityEvent({
      type: 'BLOCKED_IP_ATTEMPT',
      severity: 'CRITICAL',
      projectId,
      videoId,
      sessionId,
      ipAddress,
      details: { reason: 'IP in blocklist' }
    })

    return {
      isHotlinking: true,
      reason: `Blocked IP: ${ipAddress}`,
      severity: 'CRITICAL'
    }
  }

  return { isHotlinking: false }
}

export async function trackVideoAccess(params: {
  videoId: string
  projectId: string
  sessionId: string
  tokenId?: string
  request: NextRequest
  quality: string
  bandwidth?: number
  eventType: 'PAGE_VISIT' | 'DOWNLOAD_COMPLETE'
  assetId?: string // Single asset download
  assetIds?: string[] // Multiple assets downloaded as ZIP
  isAdmin?: boolean
}) {
  const { videoId, projectId, eventType, assetId, assetIds, isAdmin } = params

  const settings = await getSecuritySettings()
  if (!settings.trackAnalytics) {
    return
  }

  // Avoid inflating metrics with admin activity
  if (isAdmin) {
    return
  }

  await prisma.videoAnalytics.create({
    data: {
      videoId,
      projectId,
      eventType,
      assetId,
      assetIds: assetIds ? JSON.stringify(assetIds) : undefined,
    }
  })
}

/** Audit rows live for months and are readable from the console, so no address goes in. */
function maskEmailsInDetails(details: any): any {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return details

  const masked: Record<string, any> = {}
  for (const [key, value] of Object.entries(details)) {
    masked[key] = typeof value === 'string' && value.includes('@') ? maskEmail(value) : value
  }
  return masked
}

export async function logSecurityEvent(params: {
  type: string
  severity: string
  projectId?: string
  userId?: string
  videoId?: string
  sessionId?: string
  ipAddress?: string
  referer?: string
  details?: any
  wasBlocked?: boolean
}) {
  try {
    const settings = await getSecuritySettings()

    if (!settings.trackSecurityLogs) {
      return
    }

    // Most call sites name the actor only inside `details`, so the column is filled from
    // either place instead of rewriting all of them.
    const actorId = params.userId
      || (params.details && typeof params.details.userId === 'string' ? params.details.userId : undefined)

    await prisma.securityEvent.create({
      data: {
        type: params.type,
        severity: params.severity,
        projectId: params.projectId,
        userId: actorId,
        videoId: params.videoId,
        sessionId: params.sessionId,
        ipAddress: params.ipAddress,
        referer: params.referer,
        details: maskEmailsInDetails(params.details),
        wasBlocked: params.wasBlocked || false,
      }
    })

    const redis = getRedis()
    await redis.lpush('security:events:recent', JSON.stringify({
      ...params,
      timestamp: new Date().toISOString()
    }))
    await redis.ltrim('security:events:recent', 0, 999)
  } catch (error) {
    logError('[SECURITY_EVENT] Failed to log:', error)
  }
}

export async function getSecuritySettings() {
  const now = Date.now()

  if (securitySettingsCache.expiresAt > now) {
    return securitySettingsCache.value
  }

  const redis = getRedis()
  const REDIS_KEY = 'app:security_settings'
  const cached = await redis.get(REDIS_KEY)

  if (cached) {
    const parsed = JSON.parse(cached)
    securitySettingsCache.value = parsed
    securitySettingsCache.expiresAt = now + SECURITY_SETTINGS_CACHE_TTL_MS
    return parsed
  }

  const settings = await prisma.securitySettings.findUnique({
    where: { id: 'default' },
    select: {
      hotlinkProtection: true,
      ipRateLimit: true,
      sessionRateLimit: true,
      shareSessionRateLimit: true,
      trackSecurityLogs: true,
      trackAnalytics: true
    }
  })

  const value: SecuritySettingsResult = {
    hotlinkProtection: settings?.hotlinkProtection || 'LOG_ONLY',
    ipRateLimit: settings?.ipRateLimit || 1000,
    sessionRateLimit: settings?.sessionRateLimit || 600,
    shareSessionRateLimit: settings?.shareSessionRateLimit || 300,
    trackSecurityLogs: settings?.trackSecurityLogs ?? true,
    trackAnalytics: settings?.trackAnalytics ?? true
  }

  securitySettingsCache.value = value
  securitySettingsCache.expiresAt = now + SECURITY_SETTINGS_CACHE_TTL_MS

  await redis.setex(REDIS_KEY, 300, JSON.stringify(value))

  return value
}

export async function invalidateSecuritySettingsCache(): Promise<void> {
  securitySettingsCache.expiresAt = 0

  const redis = getRedis()
  await redis.del('app:security_settings')
}

const BLOCKLIST_CACHE_TTL = 300 // 5 minutes
const BLOCKLIST_CACHE_KEY_IPS = 'security:blocklist:ips'
const BLOCKLIST_CACHE_KEY_DOMAINS = 'security:blocklist:domains'

/**
 * Get blocked IPs with Redis caching
 */
async function getBlockedIPs(): Promise<string[]> {
  const redis = getRedis()

  const cached = await redis.get(BLOCKLIST_CACHE_KEY_IPS)
  if (cached) {
    try {
      return JSON.parse(cached)
    } catch (error) {
      logError('[BLOCKLIST] Failed to parse cached IPs:', error)
    }
  }

  const blockedIPs = await prisma.blockedIP.findMany({
    select: { ipAddress: true }
  })

  const ipList = blockedIPs.map(entry => entry.ipAddress)

  await redis.setex(BLOCKLIST_CACHE_KEY_IPS, BLOCKLIST_CACHE_TTL, JSON.stringify(ipList))

  return ipList
}

/**
 * Get blocked domains with Redis caching
 */
async function getBlockedDomains(): Promise<string[]> {
  const redis = getRedis()

  const cached = await redis.get(BLOCKLIST_CACHE_KEY_DOMAINS)
  if (cached) {
    try {
      return JSON.parse(cached)
    } catch (error) {
      logError('[BLOCKLIST] Failed to parse cached domains:', error)
    }
  }

  const blockedDomains = await prisma.blockedDomain.findMany({
    select: { domain: true }
  })

  const domainList = blockedDomains.map(entry => entry.domain)

  await redis.setex(BLOCKLIST_CACHE_KEY_DOMAINS, BLOCKLIST_CACHE_TTL, JSON.stringify(domainList))

  return domainList
}

/**
 * Invalidate blocklist caches
 * Call this after adding/removing blocked IPs or domains
 */
export async function invalidateBlocklistCache(): Promise<void> {
  const redis = getRedis()
  await redis.del(BLOCKLIST_CACHE_KEY_IPS, BLOCKLIST_CACHE_KEY_DOMAINS)
}
