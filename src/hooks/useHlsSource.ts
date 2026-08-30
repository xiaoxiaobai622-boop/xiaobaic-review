'use client'

import Hls, { ErrorTypes, Events, type ErrorData } from 'hls.js'
import { useEffect, useRef, useState, type RefObject } from 'react'

interface UseHlsSourceOptions {
  videoRef: RefObject<HTMLVideoElement | null>
  hlsUrl?: string | null
  fallbackUrl?: string | null
  enabled?: boolean
  attachmentKey?: string | number
  onPlaybackError?: () => void
}

interface UseHlsSourceResult {
  isUsingHls: boolean
}

export function useHlsSource({
  videoRef,
  hlsUrl,
  fallbackUrl,
  enabled = true,
  attachmentKey,
  onPlaybackError,
}: UseHlsSourceOptions): UseHlsSourceResult {
  const [isUsingHls, setIsUsingHls] = useState(false)
  const onPlaybackErrorRef = useRef(onPlaybackError)

  useEffect(() => {
    onPlaybackErrorRef.current = onPlaybackError
  }, [onPlaybackError])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !enabled) {
      setIsUsingHls(false)
      return
    }

    let hls: Hls | null = null
    let sourceType: 'hls' | 'fallback' | 'none' = 'none'
    let networkRecoveryAttempts = 0
    let mediaRecoveryAttempts = 0
    let manifestReady = false
    const previousPreload = video.preload
    let handleSeeking: (() => void) | null = null
    let disposed = false

    const setVideoSource = (source: string, type: 'hls' | 'fallback') => {
      sourceType = type
      setIsUsingHls(type === 'hls')
      // HLS needs the first media segment available before the first play or seek.
      // Keep the existing metadata behaviour for ordinary MP4 fallbacks.
      video.preload = type === 'hls' ? 'auto' : previousPreload
      video.src = source
      video.load()
    }

    const activateFallback = () => {
      if (disposed) return

      hls?.destroy()
      hls = null

      if (fallbackUrl) {
        setVideoSource(fallbackUrl, 'fallback')
      } else {
        sourceType = 'none'
        setIsUsingHls(false)
        onPlaybackErrorRef.current?.()
      }
    }

    const handleMediaElementError = () => {
      if (sourceType === 'hls') {
        activateFallback()
      } else if (sourceType === 'fallback') {
        onPlaybackErrorRef.current?.()
      }
    }

    video.addEventListener('error', handleMediaElementError)

    if (hlsUrl && video.canPlayType('application/vnd.apple.mpegurl')) {
      setVideoSource(hlsUrl, 'hls')
    } else if (hlsUrl && Hls.isSupported()) {
      sourceType = 'hls'
      setIsUsingHls(true)
      video.preload = 'auto'
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        // Keep only a small amount behind the playhead so seeks do not have
        // to wait for stale buffered data to be flushed.
        backBufferLength: 12,
        // Resume playback sooner after a seek by limiting how much forward
        // media hls.js will buffer before unpausing.
        maxBufferLength: 6,
        maxMaxBufferLength: 12,
        // Tight tolerance keeps seeks close to the requested timestamp.
        maxFragLookUpTolerance: 0.05,
      })

      hls.on(Events.MEDIA_ATTACHED, () => {
        if (!disposed) hls?.loadSource(hlsUrl)
      })

      hls.on(Events.MANIFEST_PARSED, () => {
        manifestReady = true
      })

      // hls.js normally notices the media element's seeking event, but when a
      // large seek happens during an in-flight fragment request it can wait for
      // that request to finish. Starting at the requested time cancels stale
      // work and requests the target fragment immediately.
      handleSeeking = () => {
        if (!manifestReady || disposed || !hls || !Number.isFinite(video.currentTime)) return
        const target = video.currentTime
        let buffered = false
        for (let index = 0; index < video.buffered.length; index += 1) {
          if (target >= video.buffered.start(index) && target <= video.buffered.end(index)) {
            buffered = true
            break
          }
        }
        if (!buffered) hls.startLoad(target, true)
      }
      video.addEventListener('seeking', handleSeeking)

      hls.on(Events.ERROR, (_event, data: ErrorData) => {
        if (!data.fatal || disposed || !hls) return

        if (data.type === ErrorTypes.NETWORK_ERROR && networkRecoveryAttempts < 1) {
          networkRecoveryAttempts += 1
          hls.startLoad()
          return
        }

        if (data.type === ErrorTypes.MEDIA_ERROR && mediaRecoveryAttempts < 1) {
          mediaRecoveryAttempts += 1
          hls.recoverMediaError()
          return
        }

        activateFallback()
      })

      hls.attachMedia(video)
    } else if (fallbackUrl) {
      setVideoSource(fallbackUrl, 'fallback')
    } else {
      onPlaybackErrorRef.current?.()
    }

    return () => {
      disposed = true
      video.removeEventListener('error', handleMediaElementError)
      if (handleSeeking) video.removeEventListener('seeking', handleSeeking)
      hls?.destroy()
      video.pause()
      video.preload = previousPreload
      video.removeAttribute('src')
      video.load()
    }
  }, [attachmentKey, enabled, fallbackUrl, hlsUrl, videoRef])

  return { isUsingHls }
}
