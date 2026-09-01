/**
 * Deep link utilities for Feishu message cards.
 *
 * Deep link format:
 * - Video with timecode: /studio/projects/{projectId}/share?video={videoName}&t={timecode}
 * - Video without timecode: /studio/projects/{projectId}/share?video={videoName}
 * - Project overview: /projects/{projectId}
 *
 * The timecode parameter 't' can be:
 * - Seconds (e.g., t=125 for 2:05)
 * - Timecode format (e.g., t=00:02:05:00)
 */

export interface DeepLinkParams {
  projectId: string
  videoId?: string
  /** Display name used by the share page to select the video group. */
  videoName?: string
  /** Optional version number used to select the exact uploaded version. */
  version?: number
  timecode?: string // In seconds or timecode format
}

/**
 * Build a deep link URL for Feishu message card button.
 */
export function buildDeepLink(params: DeepLinkParams): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://mle6.cn'

  if (params.videoId) {
    // The review page resolves `video` against videosByName, so use the name
    // when available instead of an internal database id.
    const videoQuery = encodeURIComponent(params.videoName || params.videoId)
    let url = `${base}/studio/projects/${params.projectId}/share?video=${videoQuery}`

    if (params.version !== undefined) {
      url += `&version=${encodeURIComponent(String(params.version))}`
    }

    if (params.timecode) {
      // Convert timecode to seconds if needed
      const seconds = parseTimecodeToSeconds(params.timecode)
      url += `&t=${seconds}`
    }

    return url
  }

  // Project overview link
  return `${base}/studio/projects/${params.projectId}/share`
}

/**
 * Parse timecode string to seconds.
 * Supports formats: "125", "00:02:05", "00:02:05:00"
 */
export function parseTimecodeToSeconds(timecode: string): number {
  // Already in seconds
  if (/^\d+$/.test(timecode)) {
    return parseInt(timecode, 10)
  }

  // Parse HH:MM:SS or HH:MM:SS:FF
  const parts = timecode.split(':').map(p => parseInt(p, 10))

  if (parts.length === 3) {
    // HH:MM:SS
    const [hours, minutes, seconds] = parts
    return hours * 3600 + minutes * 60 + seconds
  }

  if (parts.length === 4) {
    // HH:MM:SS:FF (ignore frames, just use seconds)
    const [hours, minutes, seconds] = parts
    return hours * 3600 + minutes * 60 + seconds
  }

  // Fallback
  return 0
}

/**
 * Parse seconds back to timecode format for display.
 */
export function formatSecondsToTimecode(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)

  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}
