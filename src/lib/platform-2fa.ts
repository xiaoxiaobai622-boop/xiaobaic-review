import jwt from 'jsonwebtoken'

const SECRET = process.env.PLATFORM_JWT_SECRET || process.env.JWT_SECRET

export type PlatformTwoFactorPayload = {
  type: 'platform_2fa'
  userId: string
  email: string
}

export function signPlatformTwoFactor(user: { id: string; email: string }, ttlSeconds = 5 * 60) {
  if (!SECRET) throw new Error('Platform JWT secret missing')
  const payload: PlatformTwoFactorPayload = { type: 'platform_2fa', userId: user.id, email: user.email }
  return jwt.sign(payload, SECRET, { expiresIn: ttlSeconds, algorithm: 'HS256' })
}

export function verifyPlatformTwoFactor(token: string): PlatformTwoFactorPayload | null {
  if (!SECRET || !token) return null
  try {
    const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] }) as PlatformTwoFactorPayload
    return payload.type === 'platform_2fa' && payload.userId ? payload : null
  } catch {
    return null
  }
}
