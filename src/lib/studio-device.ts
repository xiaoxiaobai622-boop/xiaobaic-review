import crypto from 'crypto'
import type { NextRequest } from 'next/server'

const DEVICE_HEADER = 'x-vitransfer-device-id'

export function getAdminDeviceFingerprint(request: NextRequest): string {
  const userAgent = request.headers.get('user-agent') || 'unknown'
  const deviceId = request.headers.get(DEVICE_HEADER)?.trim().slice(0, 128) || 'legacy-device'
  return crypto.createHash('sha256').update(`${deviceId}\n${userAgent}`).digest('base64url')
}

