const DEVICE_ID_KEY = 'vitransfer_device_id'
export const DEVICE_ID_HEADER = 'X-ViTransfer-Device-ID'

export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return ''

  const stored = window.localStorage.getItem(DEVICE_ID_KEY)
  if (stored) return stored

  const deviceId = crypto.randomUUID?.() ?? `device-${Date.now()}-${Math.random().toString(36).slice(2)}`
  window.localStorage.setItem(DEVICE_ID_KEY, deviceId)
  return deviceId
}

export function getDeviceAuthHeaders(): Record<string, string> {
  const deviceId = getOrCreateDeviceId()
  return deviceId ? { [DEVICE_ID_HEADER]: deviceId } : {}
}

