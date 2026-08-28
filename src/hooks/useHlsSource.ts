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
    let disposed = false

    const setVideoSource = (source: string, type: 'hls' | 'fallback') => {
      sourceType = type
      setIsUsingHls(type === 'hls')
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
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 30,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
      })

      hls.on(Events.MEDIA_ATTACHED, () => {
        if (!disposed) hls?.loadSource(hlsUrl)
      })

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
      hls?.destroy()
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [attachmentKey, enabled, fallbackUrl, hlsUrl, videoRef])

  return { isUsingHls }
}
