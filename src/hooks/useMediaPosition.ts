'use client'

import { RefObject, useEffect, useRef, useState } from 'react'

const POSITION_SYNC_INTERVAL_MS = 100

function readCurrentTime(video: HTMLVideoElement | null, fallback: number): number {
  if (!video || !Number.isFinite(video.currentTime)) return Number.isFinite(fallback) ? fallback : 0
  return Math.max(0, video.currentTime)
}

/**
 * Keep playhead state local to the small UI that needs it. The review page
 * contains expensive panels, so propagating every media tick through the
 * parent component causes avoidable reconciliation work.
 */
export function useMediaPosition(
  videoRef: RefObject<HTMLVideoElement | null>,
  fallbackTime: number,
  attachmentKey?: string,
): number {
  const [position, setPosition] = useState(() => (Number.isFinite(fallbackTime) ? fallbackTime : 0))
  const fallbackRef = useRef(fallbackTime)

  useEffect(() => {
    fallbackRef.current = fallbackTime
    const video = videoRef.current
    // Parent state can change for unrelated reasons (buffering, fullscreen,
    // comments). While media is actively playing, its element is the source
    // of truth; do not rewind the local playhead to an older fallback value.
    if (video && !video.paused && !video.ended && !video.seeking) return
    setPosition((previous) => (
      Math.abs(previous - fallbackTime) > 0.05 ? fallbackTime : previous
    ))
  }, [fallbackTime, videoRef])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let lastSyncedAt = 0
    let pendingSeekTarget: number | null = null

    const isSameVideo = (videoId: unknown): boolean => {
      if (!attachmentKey || !videoId) return true
      return String(videoId) === String(attachmentKey)
    }

    const getNormalizedSeekTarget = (target: number): number => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        return Math.min(video.duration, Math.max(0, target))
      }
      return Math.max(0, target)
    }

    const sync = (force = false) => {
      const now = performance.now()
      if (!force && now - lastSyncedAt < POSITION_SYNC_INTERVAL_MS) return
      lastSyncedAt = now
      const next = readCurrentTime(video, fallbackRef.current)

      if (pendingSeekTarget !== null) {
        const target = getNormalizedSeekTarget(pendingSeekTarget)
        // Keep the requested position visible while the browser is still
        // reporting the old buffered range. This is common when a seek lands
        // outside the currently loaded MP4/HLS window.
        if (video.seeking || Math.abs(next - target) > 0.5) return
        pendingSeekTarget = null
      }

      setPosition((previous) => (Math.abs(previous - next) > 0.01 ? next : previous))
    }

    const handleTimeUpdate = () => {
      // During an unbuffered seek browsers can emit a stale timeupdate while
      // the old buffer is still active. Keep the requested fallback position
      // until the seeked event confirms the new media position.
      if (video.seeking) return
      sync()
    }
    const handleImmediateUpdate = () => sync(true)
    const handleSeekRequested = (event: Event) => {
      const detail = (event as CustomEvent<{ time?: number; videoId?: string | null }>).detail
      if (!detail || !isSameVideo(detail.videoId) || !Number.isFinite(detail.time)) return
      pendingSeekTarget = Math.max(0, detail.time as number)
      setPosition(getNormalizedSeekTarget(pendingSeekTarget))
    }

    video.addEventListener('timeupdate', handleTimeUpdate)
    video.addEventListener('seeked', handleImmediateUpdate)
    video.addEventListener('playing', handleImmediateUpdate)
    video.addEventListener('pause', handleImmediateUpdate)
    video.addEventListener('ended', handleImmediateUpdate)
    video.addEventListener('loadedmetadata', handleImmediateUpdate)
    window.addEventListener('videoSeekRequested', handleSeekRequested as EventListener)
    sync(true)

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate)
      video.removeEventListener('seeked', handleImmediateUpdate)
      video.removeEventListener('playing', handleImmediateUpdate)
      video.removeEventListener('pause', handleImmediateUpdate)
      video.removeEventListener('ended', handleImmediateUpdate)
      video.removeEventListener('loadedmetadata', handleImmediateUpdate)
      window.removeEventListener('videoSeekRequested', handleSeekRequested as EventListener)
    }
  }, [attachmentKey, videoRef])

  return Number.isFinite(position) ? Math.max(0, position) : 0
}
