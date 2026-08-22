import { getRedis } from './redis'

const ADMIN_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60
const MAX_ACTIVE_DEVICES = 3

type AdminSessionRecord = {
  userId: string
  fingerprintHash?: string
  createdAt: number
}

function sessionsKey(userId: string) {
  return `admin:sessions:${userId}`
}

function sessionKey(sessionId: string) {
  return `admin:session:${sessionId}`
}

function deviceKey(userId: string, fingerprintHash: string) {
  return `admin:device:${userId}:${fingerprintHash}`
}

function revokedSessionKey(sessionId: string) {
  return `blacklist:admin_session:${sessionId}`
}

export async function registerAdminSession(
  userId: string,
  sessionId: string,
  fingerprintHash?: string
): Promise<void> {
  const redis = getRedis()
  const now = Date.now()

  await redis.zremrangebyscore(sessionsKey(userId), 0, now - ADMIN_SESSION_TTL_SECONDS * 1000)

  if (fingerprintHash) {
    const previousSessionId = await redis.get(deviceKey(userId, fingerprintHash))
    if (previousSessionId && previousSessionId !== sessionId) {
      await revokeAdminSession(previousSessionId)
    }
  }

  const record: AdminSessionRecord = { userId, fingerprintHash, createdAt: now }
  const transaction = redis.multi()
  transaction.zadd(sessionsKey(userId), now, sessionId)
  transaction.expire(sessionsKey(userId), ADMIN_SESSION_TTL_SECONDS)
  transaction.setex(sessionKey(sessionId), ADMIN_SESSION_TTL_SECONDS, JSON.stringify(record))
  if (fingerprintHash) {
    transaction.setex(deviceKey(userId, fingerprintHash), ADMIN_SESSION_TTL_SECONDS, sessionId)
  }
  await transaction.exec()

  const activeCount = await redis.zcard(sessionsKey(userId))
  const overflow = activeCount - MAX_ACTIVE_DEVICES
  if (overflow <= 0) return

  const evictedSessionIds = await redis.zrange(sessionsKey(userId), 0, overflow - 1)
  await Promise.all(evictedSessionIds.map((evictedSessionId) => revokeAdminSession(evictedSessionId)))
}

export async function touchAdminSession(sessionId: string): Promise<void> {
  const redis = getRedis()
  const raw = await redis.get(sessionKey(sessionId))
  if (!raw) return

  const record = JSON.parse(raw) as AdminSessionRecord
  const transaction = redis.multi()
  transaction.expire(sessionKey(sessionId), ADMIN_SESSION_TTL_SECONDS)
  transaction.expire(sessionsKey(record.userId), ADMIN_SESSION_TTL_SECONDS)
  if (record.fingerprintHash) {
    transaction.expire(deviceKey(record.userId, record.fingerprintHash), ADMIN_SESSION_TTL_SECONDS)
  }
  await transaction.exec()
}

export async function revokeAdminSession(sessionId: string): Promise<void> {
  const redis = getRedis()
  const raw = await redis.get(sessionKey(sessionId))
  const record = raw ? JSON.parse(raw) as AdminSessionRecord : null

  const transaction = redis.multi()
  transaction.setex(revokedSessionKey(sessionId), ADMIN_SESSION_TTL_SECONDS, Date.now().toString())
  transaction.del(sessionKey(sessionId))

  if (record) {
    transaction.zrem(sessionsKey(record.userId), sessionId)
    if (record.fingerprintHash) {
      const mappedSessionId = await redis.get(deviceKey(record.userId, record.fingerprintHash))
      if (mappedSessionId === sessionId) {
        transaction.del(deviceKey(record.userId, record.fingerprintHash))
      }
    }
  }

  await transaction.exec()
}

export async function isAdminSessionRevoked(sessionId: string): Promise<boolean> {
  const redis = getRedis()
  return (await redis.exists(revokedSessionKey(sessionId))) === 1
}

