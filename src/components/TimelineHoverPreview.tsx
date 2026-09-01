'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { formatCommentTimestamp, secondsToTimecode } from '@/lib/timecode'

interface TimelineHoverPreviewProps {
  videoUrl?: string | null
  hoveredTime: number | null
  duration: number
  fps: number
  timestampDisplayMode: 'TIMECODE' | 'AUTO'
}

function formatTimeWithMode(
  seconds: number,
  fps: number,
  duration: number,
  mode: 'TIMECODE' | 'AUTO',
): string {
  if (!Number.isFinite(seconds)) return mode === 'TIMECODE' ? '00:00:00:00' : '0:00'
  const timecode = secondsToTimecode(seconds, fps)
  return formatCommentTimestamp({ timecode, fps, videoDurationSeconds: duration, mode })
}

function TimelineHoverPreview({
  videoUrl,
  hoveredTime,
  duration,
  fps,
  timestampDisplayMode,
}: TimelineHoverPreviewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [ready, setReady] = useState(false)
  const [previewTime, setPreviewTime] = useState<number | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !videoUrl || hoveredTime === null || !Number.isFinite(duration) || duration <= 0) {
      setReady(false)
      setPreviewTime(null)
      return
    }

    const targetTime = Math.max(0, Math.min(hoveredTime, duration))
    setPreviewTime(targetTime)
    setReady(false)

    const timer = window.setTimeout(() => {
      const current = videoRef.current
      if (!current) return

      const applySeek = () => {
        if (!videoRef.current) return
        try {
          videoRef.current.currentTime = targetTime
        } catch {
          // Seeking can throw if metadata is not loaded yet.
        }
        if (videoRef.current.readyState >= 2) setReady(true)
      }

      if (current.readyState >= 1) {
        applySeek()
      } else {
        current.addEventListener('loadedmetadata', applySeek, { once: true })
      }
    }, 70)

    return () => window.clearTimeout(timer)
  }, [videoUrl, hoveredTime, duration])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const handleSeeked = () => setReady(true)
    const handleLoadedData = () => {
      if (video.readyState >= 2) setReady(true)
    }

    video.addEventListener('seeked', handleSeeked)
    video.addEventListener('loadeddata', handleLoadedData)
    if (video.readyState >= 2) setReady(true)
    return () => {
      video.removeEventListener('seeked', handleSeeked)
      video.removeEventListener('loadeddata', handleLoadedData)
    }
  }, [videoUrl])

  if (hoveredTime === null || !videoUrl || !Number.isFinite(duration) || duration <= 0) {
    return null
  }

  const percent = Math.max(0, Math.min(100, (hoveredTime / duration) * 100))
  const alignment = percent < 18 ? 'left-0' : percent > 82 ? 'right-0' : 'left-1/2 -translate-x-1/2'
  const label = formatTimeWithMode(hoveredTime, fps, duration, timestampDisplayMode)

  return (
    <div
      className={`pointer-events-none absolute bottom-[calc(100%+10px)] z-40 w-[168px] sm:w-[210px] ${alignment}`}
    >
      <div className="overflow-hidden rounded-lg border border-white/20 bg-black/95 shadow-2xl backdrop-blur-sm">
        <div className="relative aspect-video overflow-hidden bg-black">
          <video
            key={videoUrl}
            ref={videoRef}
            src={videoUrl}
            muted
            playsInline
            preload="metadata"
            className="h-full w-full object-contain"
          />
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/25 border-t-white" />
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-white/10 px-2 py-1.5">
          <span className="text-[10px] font-medium text-white/70 sm:text-[11px]">帧预览</span>
          <span className="text-[10px] font-sans tabular-nums text-white sm:text-[11px]">{label}</span>
        </div>
      </div>
    </div>
  )
}

export default memo(TimelineHoverPreview)
