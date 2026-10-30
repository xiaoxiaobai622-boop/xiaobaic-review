import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { NextRequest } from 'next/server'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

function formatClock(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

export function formatDuration(seconds: number): string {
  return formatClock(seconds)
}

export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = bytes
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`
}

export function formatTimestamp(seconds: number): string {
  if (!seconds || isNaN(seconds) || !isFinite(seconds)) {
    return '0:00'
  }
  return formatClock(seconds)
}

/**
 * Format date with timezone awareness
 * Uses browser's timezone (client-side) or TZ env variable (server-side)
 * Format adapts based on detected timezone region
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date

  // Client-side: use browser timezone
  // Server-side: use TZ environment variable
  const timezone = typeof window !== 'undefined'
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : process.env.TZ!

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const parts = formatter.formatToParts(d)
  const year = parts.find(p => p.type === 'year')?.value || ''
  const month = parts.find(p => p.type === 'month')?.value || ''
  const day = parts.find(p => p.type === 'day')?.value || ''

  // US/Americas format (MM-dd-yyyy)
  if (timezone.startsWith('America/') || timezone.startsWith('US/')) {
    return `${month}-${day}-${year}`
  }

  // European format (dd-MM-yyyy)
  if (timezone.startsWith('Europe/') || timezone.startsWith('Africa/')) {
    return `${day}-${month}-${year}`
  }

  // Asian/ISO format (yyyy-MM-dd) - also default
  return `${year}-${month}-${day}`
}

/**
 * Format date and time with timezone awareness
 * Uses browser's timezone (client-side) or TZ env variable (server-side)
 * Time is displayed in user's local timezone
 */
export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date

  // Client-side: use browser timezone
  // Server-side: use TZ environment variable
  const timezone = typeof window !== 'undefined'
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : process.env.TZ!

  const dateStr = formatDate(d)

  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false, // 24-hour format
  })

  const timeStr = timeFormatter.format(d)
  return `${dateStr} ${timeStr}`
}

/**
 * 运营后台的时刻一律按北京（UTC+8）画。
 * 首页那套「每日使用量」是北京日切分的（`platform-usage.ts`：库里存的是 UTC 无时区时间戳，
 * `+8h` 再截 date），同一时刻在安全页与消息页要是跟着浏览器时区走，运营就会拿两条不同口径的
 * 时间去对同一件事——他这台机器在 +08 看不出来，换台机器或换个人看就错了。
 */
export function formatBeijingDateTime(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    // hourCycle 而不是 hour12: false —— 后者在部分 ICU 版本里把午夜渲染成「24:00」。
    hourCycle: 'h23',
  }).formatToParts(d)
  const at = (type: string) => parts.find(part => part.type === type)?.value || ''
  return `${at('year')}-${at('month')}-${at('day')} ${at('hour')}:${at('minute')}`
}

/**
 * Keep only enough of an address to recognise the account. Audit rows are kept for months
 * and are readable by anyone with console access, so they must not carry the full address.
 */
export function maskEmail(email: string): string {
  const [localPart, domain] = email.split('@')
  if (!domain) return '****'
  return `${localPart.charAt(0)}****@${domain}`
}

export function getClientIpAddress(request: NextRequest): string {
  // Header-derived and client-settable — only trustworthy when the origin is reachable
  // solely via the proxy/CDN (a directly-exposed origin lets clients spoof IPs).
  const isCloudflare = !!request.headers.get('cf-ray')
  if (isCloudflare) {
    const cfIp = request.headers.get('cf-connecting-ip')
    if (cfIp) return cfIp
  }

  // Caddy's proxy sets `header_up X-Real-IP {remote_host}`, which overwrites anything
  // the client sent. X-Forwarded-For is only appended to, so a client-supplied first
  // hop survives to the origin — audit rows keyed off it would be attacker-chosen.
  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp.trim()

  const xff = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (xff) return xff

  return 'unknown'
}

// 头像配色：按名字稳定散列到一组饱和色，实底 + 白字（对标站同一人永远同色）。
// 不含灰/石/中性档——默认头像也必须带颜色。
const AVATAR_COLORS = [
  'border-red-600',
  'border-orange-600',
  'border-amber-700',
  'border-lime-700',
  'border-green-700',
  'border-emerald-700',
  'border-teal-700',
  'border-cyan-700',
  'border-sky-700',
  'border-blue-700',
  'border-indigo-600',
  'border-violet-600',
  'border-fuchsia-700',
  'border-pink-700',
] as const

export const AVATAR_HEX: Record<string, string> = {
  'border-red-600': '#dc2626',
  'border-orange-600': '#c2410c',
  'border-amber-700': '#b45309',
  'border-lime-700': '#4d7c0f',
  'border-green-700': '#15803d',
  'border-emerald-700': '#047857',
  'border-teal-700': '#0f766e',
  'border-cyan-700': '#0e7490',
  'border-sky-700': '#0369a1',
  'border-blue-700': '#1d4ed8',
  'border-indigo-600': '#4f46e5',
  'border-violet-600': '#7c3aed',
  'border-fuchsia-700': '#a21caf',
  'border-pink-700': '#be185d',
}

export function getUserColor(name: string | null | undefined, _isSender: boolean = false): { border: string } {
  const key = (name || '?').trim().toLowerCase() || '?'
  return { border: AVATAR_COLORS[Math.abs(hashString(key)) % AVATAR_COLORS.length] }
}

/**
 * Improved hash function with better distribution
 * Uses djb2 algorithm which produces fewer collisions
 */
function hashString(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i) // hash * 33 + c
  }
  return hash
}
