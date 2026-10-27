import { logWarn } from './logging'
import type { ShareErrorCode } from './share-error-codes'

export function requestEndpoint(request: Request): string {
  try {
    return new URL(request.url).pathname
  } catch {
    return 'unknown'
  }
}

/** The link address carried by a share route, used when no bearer was presented. */
export function shareTokenFromPath(request: Request): string | null {
  const match = requestEndpoint(request).match(/^\/api\/share\/([^/]+)/)
  return match ? decodeURIComponent(match[1]) : null
}

/**
 * One line per refused share action so a link can be aggregated in the log
 * store: shareToken + endpoint + reason are always present.
 */
export function logShareDenial(params: {
  shareToken?: string | null
  endpoint?: string
  reason: ShareErrorCode | string
}): void {
  logWarn('[SHARE_403]', JSON.stringify({
    shareToken: params.shareToken ?? null,
    endpoint: params.endpoint ?? 'unknown',
    reason: params.reason,
  }))
}
