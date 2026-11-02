type PlaybackVideoShape = {
  status?: string | null
  hlsPath?: string | null
  preview2160Path?: string | null
  preview1080Path?: string | null
  preview720Path?: string | null
  cleanPreview2160Path?: string | null
  cleanPreview1080Path?: string | null
  cleanPreview720Path?: string | null
  originalStoragePath?: string | null
}

/**
 * Whether /api/content can actually answer a progressive playback request.
 *
 * The content endpoint answers 415 for an HLS-only video with no preview; an
 * original is only a progressive source when there is no HLS rendition. Share
 * and studio surfaces must make the same decision before minting a 720p token,
 * otherwise a non-HLS browser is handed a URL that is guaranteed to fail.
 */
export function hasProgressivePlayback(video: PlaybackVideoShape | null | undefined): boolean {
  if (!video) return false
  if (video.preview2160Path || video.preview1080Path || video.preview720Path ||
      video.cleanPreview2160Path || video.cleanPreview1080Path || video.cleanPreview720Path) {
    return true
  }
  return !video.hlsPath && video.status === 'READY' && Boolean(video.originalStoragePath)
}
