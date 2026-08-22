import { getRedis } from './redis'

const SESSION_TTL_SECONDS = 12 * 60 * 60
const MAX_ACTIVE_DEVICES = 3

type PlatformSessionRecord = {
  userId: string
  fingerprintHash?: string
  createdAt: number
}

function sessionsKey(userId: string) {
  return `platform:sessions:${userId}`
}

function sessionKey(sessionId: string) {
  return `platform:session:${sessionId}`
}

function deviceKey(userId: string, fingerprintHash: string) {
  return `platform:device:${userId}:${fingerprintHash}`
}

function revokedKey(sessionId: string) {
  return `blacklist:platform_session:${sessionId}`
}

export async function registerPlatformSession(
  userId: string,
  sessionId: string,
  fingerprintHash?: string,
) {
  const redis = getRedis()
  const now = Date.now()
  const record: PlatformSessionRecord = { userId, fingerprintHash, createdAt: now }
  const transaction = redis.multi()
  transaction.zadd(sessionsKey(userId), now, sessionId)
  transaction.expire(sessionsKey(userId), SESSION_TTL_SECONDS)
  transaction.setex(sessionKey(sessionId), SESSION_TTL_SECONDS, JSON.stringify(record))
  if (fingerprintHash) {
    const previous = await redis.get(deviceKey(userId, fingerprintHash))
    if (previous && previous !== sessionId) {
      await revokePlatformSession(previous)
    }
    transaction.setex(deviceKey(userId, fingerprintHash), SESSION_TTL_SECONDS, sessionId)
  }
  await transaction.exec()

  const count = await redis.zcard(sessionsKey(userId))
  const overflow = count - MAX_ACTIVE_DEVICES
  if (overflow <= 0) return
  const evicted = await redis.zrange(sessionsKey(userId), 0, overflow - 1)
  await Promise.all(evicted.map((id) => revokePlatformSession(id)))
}

export async function touchPlatformSession(sessionId: string) {
  const redis = getRedis()
  const raw = await redis.get(sessionKey(sessionId))
  if (!raw) return
  const record = JSON.parse(raw) as PlatformSessionRecord
  const transaction = redis.multi()
  transaction.expire(sessionKey(sessionId), SESSION_TTL_SECONDS)
  transaction.expire(sessionsKey(record.userId), SESSION_TTL_SECONDS)
  if (record.fingerprintHash) {
    transaction.expire(deviceKey(record.userId, record.fingerprintHash), SESSION_TTL_SECONDS)
  }
  await transaction.exec()
}

export async function revokePlatformSession(sessionId: string) {
  const redis = getRedis()
  const raw = await redis.get(sessionKey(sessionId))
  const record = raw ? (JSON.parse(raw) as PlatformSessionRecord) : null
  const transaction = redis.multi()
  transaction.setex(revokedKey(sessionId), SESSION_TTL_SECONDS, Date.now().toString())
  transaction.del(sessionKey(sessionId))
  if (record) {
    transaction.zrem(sessionsKey(record.userId), sessionId)
    if (record.fingerprintHash) {
      const mapped = await redis.get(deviceKey(record.userId, record.fingerprintHash))
      if (mapped === sessionId) transaction.del(deviceKey(record.userId, record.fingerprintHash))
    }
  }
  await transaction.exec()
}

export async function isPlatformSessionRevoked(sessionId: string) {
  const redis = getRedis()
  return (await redis.exists(revokedKey(sessionId))) === 1
}
