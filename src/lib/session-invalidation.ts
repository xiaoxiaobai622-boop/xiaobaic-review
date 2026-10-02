import { getRedis } from './redis'
import { prisma } from './db'
import { revokeAllUserTokens } from './token-revocation'
import { logError, logMessage } from '@/lib/logging'

async function scanAndDeleteKeys(
  pattern: string
): Promise<number> {
  const redis = getRedis()
  const stream = redis.scanStream({ match: pattern, count: 100 })
  const keysToDelete: string[] = []

  for await (const keys of stream) {
    keysToDelete.push(...keys)
  }

  if (keysToDelete.length > 0) {
    const pipeline = redis.pipeline()
    keysToDelete.forEach(key => pipeline.del(key))
    await pipeline.exec()
  }

  return keysToDelete.length
}

/**
 * Clear all rate limit counters (password attempts, etc.)
 *
 * Use when:
 * - Password attempt limit changes
 * - Rate limit configuration changes
 * - Admin wants to reset all lockouts
 *
 * @returns Number of rate limit entries cleared
 */
export async function clearAllRateLimits(): Promise<number> {
  try {
    const clearedCount = await scanAndDeleteKeys('ratelimit:*')

    logMessage(`[SESSION_INVALIDATION] Cleared ${clearedCount} rate limit counters`)
    return clearedCount
  } catch (error) {
    logError('[SESSION_INVALIDATION] Error clearing rate limits:', error)
    throw error
  }
}

/**
 * Invalidate all share token sessions for a specific project
 * by revoking their sessionIds in Redis
 *
 * Use when:
 * - Project auth mode changes
 * - Project password changes
 * - Project security settings change
 *
 * @param projectId - The project ID to invalidate sessions for
 * @returns Number of sessions invalidated
 */
export async function invalidateShareTokensByProject(projectId: string): Promise<number> {
  try {
    const sessions = await prisma.sharePageAccess.findMany({
      where: { projectId },
      select: { sessionId: true },
      distinct: ['sessionId']
    })

    const invalidated = await revokeShareSessions(sessions.map((session) => session.sessionId))
    const redis = getRedis()
    const tokenStream = redis.scanStream({ match: 'video_access:*', count: 100 })
    let invalidatedContentTokens = 0

    for await (const keys of tokenStream) {
      for (const key of keys) {
        const raw = await redis.get(key)
        if (!raw) continue
        try {
          const data = JSON.parse(raw) as { projectId?: string; sessionId?: string; videoId?: string; quality?: string }
          if (data.projectId !== projectId) continue
          const pipeline = redis.pipeline().del(key)
          if (data.sessionId && data.videoId && data.quality) {
            pipeline.del(`video_token_cache:${data.sessionId}:${data.videoId}:${data.quality}`)
          }
          await pipeline.exec()
          invalidatedContentTokens += 1
        } catch {
          // Invalid token data is ignored here and rejected by token verification.
        }
      }
    }
    if (invalidatedContentTokens > 0) await redis.incr('video_token_rev_version')

    logMessage(`[SESSION_INVALIDATION] Invalidated ${invalidated} share sessions and ${invalidatedContentTokens} content tokens for project ${projectId}`)
    return invalidated + invalidatedContentTokens
  } catch (error) {
    logError('[SESSION_INVALIDATION] Error invalidating share sessions:', error)
    throw error
  }
}

/**
 * Invalidate all known share sessions globally.
 *
 * Use when:
 * - Session timeout duration changes
 * - Hotlink protection becomes more restrictive
 * - Global security policy changes
 *
 * @returns Number of share sessions invalidated
 */
export async function invalidateAllShareSessions(): Promise<number> {
  try {
    const sessions = await prisma.sharePageAccess.findMany({
      select: { sessionId: true },
      distinct: ['sessionId']
    })

    const invalidated = await revokeShareSessions(sessions.map((session) => session.sessionId))
    logMessage(`[SESSION_INVALIDATION] Invalidated ALL ${invalidated} share sessions globally`)
    return invalidated
  } catch (error) {
    logError('[SESSION_INVALIDATION] Error invalidating all share sessions:', error)
    throw error
  }
}

/**
 * Check if a share session is revoked
 * @param sessionId - The session ID to check
 * @returns true if session is revoked
 */
export async function isShareSessionRevoked(sessionId: string): Promise<boolean> {
  try {
    const redis = getRedis()
    const exists = await redis.exists(`revoked:share_session:${sessionId}`)
    return exists === 1
  } catch (error) {
    logError('[SESSION_INVALIDATION] Error checking session revocation:', error)
    return true // Fail closed: deny access if Redis is unavailable
  }
}

/**
 * Invalidate all admin sessions for a specific user
 *
 * Use when:
 * - Admin user is deleted
 * - Admin passkey is deleted (security measure)
 * - Admin account is compromised
 * - Security-sensitive changes to admin account
 *
 * @param userId - The admin user ID to invalidate sessions for
 */
export async function invalidateAdminSessions(userId: string): Promise<void> {
  try {
    await revokeAllUserTokens(userId)
    logMessage(`[SESSION_INVALIDATION] Invalidated all admin sessions for user ${userId}`)
  } catch (error) {
    logError('[SESSION_INVALIDATION] Error invalidating admin sessions:', error)
    throw error
  }
}

/**
 * Invalidate share sessions for a specific email across all projects
 *
 * Use when:
 * - Email-based security concern (email compromised, etc.)
 *
 * @param email - The email address whose sessions should be invalidated
 * @returns Number of sessions invalidated
 */
export async function invalidateSessionsByEmail(email: string): Promise<number> {
  try {
    const sessions = await prisma.sharePageAccess.findMany({
      where: {
        email: {
          equals: email,
          mode: 'insensitive'
        }
      },
      select: { sessionId: true },
      distinct: ['sessionId']
    })

    const invalidated = await revokeShareSessions(sessions.map((session) => session.sessionId))
    logMessage(`[SESSION_INVALIDATION] Invalidated ${invalidated} sessions for email ${email}`)
    return invalidated
  } catch (error) {
    logError('[SESSION_INVALIDATION] Error invalidating sessions by email:', error)
    throw error
  }
}

async function revokeShareSessions(sessionIds: string[]): Promise<number> {
  if (sessionIds.length === 0) return 0

  const redis = getRedis()
  const ttl = 7 * 24 * 60 * 60 // 7 days in seconds
  const pipeline = redis.pipeline()

  for (const sessionId of sessionIds) {
    pipeline.setex(`revoked:share_session:${sessionId}`, ttl, '1')
  }

  await pipeline.exec()
  return sessionIds.length
}

// A revocation marker has to outlive everything it can be used to reach: the
// viewer bearer (up to the configured share TTL) and the content tokens minted
// with it (up to four hours). 7 days matches the share-session markers above.
const SHARE_LINK_REVOCATION_TTL_SECONDS = 7 * 24 * 60 * 60

/**
 * Kill one share link's access without touching any other link of the project.
 *
 * Two layers, because a revoked link has to stop serving bytes immediately and
 * not only at the next page load:
 * - `revoked:share_link:<token>` is checked by the viewer bearer and by every
 *   content token that carries the link, which covers anything minted later;
 * - the live `video_access:*` tokens of that link are deleted here, which
 *   covers viewers who are already watching.
 *
 * @param token - The link's address segment (`ShareLink.token`)
 * @returns Number of in-flight content tokens removed
 */
export async function revokeShareLinkAccess(token: string): Promise<number> {
  const redis = getRedis()
  try {
    await redis.setex(`revoked:share_link:${token}`, SHARE_LINK_REVOCATION_TTL_SECONDS, '1')

    let removed = 0
    const tokenStream = redis.scanStream({ match: 'video_access:*', count: 100 })
    for await (const keys of tokenStream) {
      for (const key of keys) {
        const raw = await redis.get(key)
        if (!raw) continue
        try {
          const data = JSON.parse(raw) as { shareId?: string; sessionId?: string; videoId?: string; quality?: string }
          if (data.shareId !== token) continue
          const pipeline = redis.pipeline().del(key)
          if (data.sessionId && data.videoId && data.quality) {
            pipeline.del(`video_token_cache:${data.sessionId}:${data.videoId}:${data.quality}`)
          }
          await pipeline.exec()
          removed += 1
        } catch {
          // Malformed token data is ignored here; verification rejects it.
        }
      }
    }

    // The per-process verification cache answers from memory for up to ten
    // seconds, so flush it rather than let a revoked link keep playing.
    if (removed > 0) await redis.incr('video_token_rev_version')

    logMessage(`[SESSION_INVALIDATION] Revoked share link ${token} and ${removed} content tokens`)
    return removed
  } catch (error) {
    logError('[SESSION_INVALIDATION] Error revoking share link:', error)
    throw error
  }
}

/**
 * @param token - The link's address segment (`ShareLink.token`)
 * @returns true if the link has been revoked, or the check could not be made
 */
export async function isShareLinkRevoked(token: string): Promise<boolean> {
  try {
    const redis = getRedis()
    return (await redis.exists(`revoked:share_link:${token}`)) === 1
  } catch (error) {
    logError('[SESSION_INVALIDATION] Error checking share link revocation:', error)
    return true // Fail closed: deny access if Redis is unavailable
  }
}

/**
 * Re-activating a link has to undo the marker, or the address stays dead until
 * the marker's own TTL runs out. Tokens killed by the revoke are simply re-minted
 * on the next page load.
 */
export async function clearShareLinkRevocation(token: string): Promise<void> {
  const redis = getRedis()
  try {
    await redis.del(`revoked:share_link:${token}`)
    await redis.incr('video_token_rev_version')
  } catch (error) {
    logError('[SESSION_INVALIDATION] Error clearing share link revocation:', error)
    throw error
  }
}

/**
 * Clear pending passkey challenges for a user
 *
 * Use when:
 * - User's passkey is deleted (prevent pending registrations)
 * - Security concern with user's passkeys
 *
 * @param userId - The user ID whose challenges should be cleared
 */
export async function clearPasskeyChallenges(userId: string): Promise<void> {
  try {
    const redis = getRedis()
    const pipeline = redis.pipeline()

    // Clear both registration and authentication challenges
    pipeline.del(`passkey:challenge:register:${userId}`)
    pipeline.del(`passkey:challenge:auth:${userId}`)

    await pipeline.exec()

    logMessage(`[SESSION_INVALIDATION] Cleared passkey challenges for user ${userId}`)
  } catch (error) {
    logError('[SESSION_INVALIDATION] Error clearing passkey challenges:', error)
    throw error
  }
}
