export interface PlaybackFailureEvent {
  cause: string
  httpStatus?: number
  mediaErrorCode?: number
  hlsErrorType?: string
  hlsErrorDetails?: string
  videoId?: string | null
  projectId?: string
  quality?: string
  sourceQuality?: boolean
  recovered?: boolean
  fallback?: boolean
}

/**
 * Best-effort failure counter. sendBeacon keeps this off the playback path and
 * survives the page being closed right after the error. The payload has no
 * token, URL or account data: video/project ids and the classification only.
 */
export function reportPlaybackFailure(event: PlaybackFailureEvent): void {
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return

  try {
    const payload = JSON.stringify(event)
    navigator.sendBeacon('/api/playback/failure', new Blob([payload], { type: 'application/json' }))
  } catch {
    // Telemetry must never make a failed playback fail louder.
  }
}
