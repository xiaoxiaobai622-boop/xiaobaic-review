const BUFFER_TAIL_TOLERANCE_SECONDS = 0.15

export interface BufferedRangeSource {
  readonly length: number
  start(index: number): number
  end(index: number): number
}

export interface BufferMediaSource {
  duration: number
  buffered: BufferedRangeSource
}

export function getFiniteDuration(video: BufferMediaSource): number | null {
  return Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null
}

/**
 * Whether the media element can decode `time` right now. A timestamp at the
 * exact end of a range can still stall while the next HLS fragment is fetched,
 * so a tail of each range is treated as a hole - unless that range already
 * reaches the end of the media, where no further data will ever arrive.
 */
export function isTimeBuffered(video: BufferMediaSource, time: number): boolean {
  if (!Number.isFinite(time)) return false

  const duration = getFiniteDuration(video)

  for (let index = 0; index < video.buffered.length; index += 1) {
    const start = video.buffered.start(index)
    const end = video.buffered.end(index)
    const rangeLength = Math.max(0, end - start)
    // Short trailing fragments (a partial last GOP is common) must not be
    // swallowed whole by a fixed tolerance.
    const tailTolerance = Math.min(BUFFER_TAIL_TOLERANCE_SECONDS, Math.max(0.02, rangeLength / 4))
    const reachesMediaEnd = duration !== null && end >= duration - 0.05
    if (time >= start && (time < end - tailTolerance || reachesMediaEnd)) {
      return true
    }
  }
  return false
}
