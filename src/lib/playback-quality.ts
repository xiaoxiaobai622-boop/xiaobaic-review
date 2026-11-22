/**
 * Playback rendition selection shared by the player and the quality menu.
 *
 * The background 1080p MP4 (`local1080Status`) is a progressive-only rendition:
 * there is no 1080 HLS ladder, so a 1080 preference must not be answered with
 * the 720p HLS manifest. The helpers here keep that decision pure and testable
 * without mounting the player.
 */

export type PlaybackQuality = '720p' | '1080p' | '2160p'

export type Local1080Status = 'NONE' | 'PENDING' | 'PROCESSING' | 'READY' | 'ERROR'

const LOCAL_1080_STATUSES: ReadonlySet<string> = new Set([
  'NONE',
  'PENDING',
  'PROCESSING',
  'READY',
  'ERROR',
])

/**
 * Whether the payload actually carries the local-1080 contract. Share links and
 * older project payloads omit both fields; those surfaces keep their previous
 * playback behaviour and do not render the menu.
 */
export function isLocal1080StatusKnown(status: string | null | undefined): status is Local1080Status {
  return typeof status === 'string' && LOCAL_1080_STATUSES.has(status)
}

/** A 1080 rendition is playable only when the worker marked it READY and a URL exists. */
export function isLocal1080Ready(input: {
  local1080Status?: string | null
  streamUrl1080p?: string | null
}): boolean {
  return input.local1080Status === 'READY' && Boolean(input.streamUrl1080p)
}

export type Local1080MenuState = 'ready' | 'processing' | 'unavailable'

/**
 * What the 1080 menu row should say and whether it can be clicked.
 * PENDING/PROCESSING are the only states the worker will still resolve on its
 * own; READY without a URL and every other state (including NONE/ERROR) are
 * unavailable. A READY rendition only counts once its token-minted URL exists.
 */
export function local1080MenuState(
  status: string | null | undefined,
  hasStream: boolean,
): Local1080MenuState {
  if (status === 'READY') return hasStream ? 'ready' : 'unavailable'
  if (status === 'PENDING' || status === 'PROCESSING') return 'processing'
  return 'unavailable'
}

/**
 * Clip a requested quality to what the selected video can actually play.
 * Surfaces that do not expose `local1080Status` (share links) keep their old
 * behaviour untouched: their 1080 URL was never gated by this feature.
 */
export function clipPreferredQuality(
  quality: PlaybackQuality,
  input: { local1080Status?: string | null; streamUrl1080p?: string | null },
): PlaybackQuality {
  if (quality !== '1080p') return quality
  if (!isLocal1080StatusKnown(input.local1080Status)) return quality
  return isLocal1080Ready(input) ? '1080p' : '720p'
}

export interface PlaybackSource {
  videoId: string | null
  url: string
  hlsUrl: string
  quality: PlaybackQuality
}

/**
 * Resolve which rendition to hand the media element.
 *
 * `supportsHls` is the caller's final answer: false (a 1080 MP4 preference, or
 * a forced progressive fallback) must bypass HLS even when a manifest exists.
 */
export function resolvePlaybackSource(
  video: {
    id?: string
    streamUrl720p?: string | null
    streamUrl1080p?: string | null
    streamUrl2160p?: string | null
    hlsUrl720p?: string | null
    sourceUrl?: string | null
  } | null,
  defaultQuality: PlaybackQuality,
  supportsHls: boolean,
  preferSourceQuality = false,
): PlaybackSource {
  if (!video) {
    return { videoId: null, url: '', hlsUrl: '', quality: defaultQuality }
  }

  if (preferSourceQuality && video.sourceUrl) {
    return { videoId: video.id || null, url: video.sourceUrl, hlsUrl: '', quality: defaultQuality }
  }

  let url = ''
  let quality: PlaybackQuality = defaultQuality

  if (defaultQuality === '2160p') {
    if (video.streamUrl2160p) {
      url = video.streamUrl2160p
      quality = '2160p'
    } else if (video.streamUrl1080p) {
      url = video.streamUrl1080p
      quality = '1080p'
    } else {
      url = video.streamUrl720p || ''
      quality = '720p'
    }
  } else if (defaultQuality === '1080p') {
    if (video.streamUrl1080p) {
      url = video.streamUrl1080p
      quality = '1080p'
    } else if (video.streamUrl720p) {
      url = video.streamUrl720p
      quality = '720p'
    } else {
      url = video.streamUrl2160p || ''
      quality = '2160p'
    }
  } else if (video.streamUrl720p) {
    url = video.streamUrl720p
    quality = '720p'
  } else if (video.streamUrl1080p) {
    url = video.streamUrl1080p
    quality = '1080p'
  } else {
    url = video.streamUrl2160p || ''
    quality = '2160p'
  }

  const hlsUrl = supportsHls ? (video.hlsUrl720p || '') : ''
  if (hlsUrl) quality = '720p'

  return { videoId: video.id || null, url, hlsUrl, quality }
}
