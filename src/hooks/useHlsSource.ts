'use client'

import Hls, { ErrorTypes, Events, type ErrorData } from 'hls.js'
import { useEffect, useRef, useState, type RefObject } from 'react'

interface UseHlsSourceOptions {
  videoRef: RefObject<HTMLVideoElement | null>
  hlsUrl?: string | null
  fallbackUrl?: string | null
  enabled?: boolean
  attachmentKey?: string | number
  playIntentRef?: { current: boolean }
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
  playIntentRef,
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
    let handleWaiting: (() => void) | null = null
    let handleLoadedMetadata: (() => void) | null = null
    let handleDurationChange: (() => void) | null = null
    let seekLoadTimer: ReturnType<typeof setTimeout> | null = null
    let pendingSeekPosition: number | null = null
    let pendingForceLoad = false
    let recoveryTimer: ReturnType<typeof setTimeout> | null = null
    let lastLoadRequestPosition: number | null = null
    let lastLoadRequestAt = 0
    let disposed = false

    const isBufferedAt = (position: number): boolean => {
      if (!Number.isFinite(position)) return false

      const duration = Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : null
      const isAtMediaEnd = duration !== null && position >= duration - 0.05

      for (let index = 0; index < video.buffered.length; index += 1) {
        // Keep the same tolerance hls.js uses for small buffer holes. Treating
        // a position at the exact end of a range as buffered can leave the
        // player waiting for the next fragment, so leave a small tail here.
        const start = video.buffered.start(index)
        const end = video.buffered.end(index)
        if (position >= start && (position < end - 0.15 || (isAtMediaEnd && end >= (duration ?? 0) - 0.05))) return true
      }
      return false
    }

    const scheduleLoadAt = (position: number, force = false) => {
      if (disposed || !hls || !Number.isFinite(position)) return

      const target = Math.max(0, position)
      pendingSeekPosition = target
      pendingForceLoad = pendingForceLoad || force

      if (!manifestReady) return
      if (!pendingForceLoad && isBufferedAt(target)) {
        pendingSeekPosition = null
        return
      }

      // The media element and hls.js both emit seek-related events. Coalesce
      // them so a drag/seek cannot restart the fragment loader repeatedly.
      if (seekLoadTimer !== null) clearTimeout(seekLoadTimer)
      seekLoadTimer = setTimeout(() => {
        seekLoadTimer = null
        if (disposed || !hls || !manifestReady) return

        const forceLoad = pendingForceLoad

        const currentTarget = Number.isFinite(video.currentTime)
          ? Math.max(0, video.currentTime)
          : target
        if (!forceLoad && isBufferedAt(currentTarget)) {
          pendingSeekPosition = null
          return
        }

        const now = Date.now()
        const sameTarget = lastLoadRequestPosition !== null &&
          Math.abs(lastLoadRequestPosition - currentTarget) < 0.25
        if (
          !forceLoad &&
          sameTarget &&
          // While a loader is active, another startLoad would abort the
          // fragment that is already fetching. A short cooldown coalesces the
          // media element's duplicate seeking/waiting events while still
          // allowing a later retry when a request has genuinely stalled.
          now - lastLoadRequestAt < 2000
        ) {
          // Keep the target alive. A seek can emit `waiting` only once, so
          // dropping it here can leave a paused player stuck forever when the
          // original fragment request stalls. Retry after the cooldown.
          const retryDelay = Math.max(50, 2000 - (now - lastLoadRequestAt) + 25)
          seekLoadTimer = setTimeout(() => {
            seekLoadTimer = null
            if (pendingSeekPosition !== null) {
              scheduleLoadAt(pendingSeekPosition, pendingForceLoad)
            }
          }, retryDelay)
          return
        }

        lastLoadRequestPosition = currentTarget
        lastLoadRequestAt = now
        pendingForceLoad = false

        // Run after hls.js' own media-seeking listener. startLoad(..., true)
        // aborts stale fragment work and makes the requested position the next
        // load position without moving the media element back to zero.
        try {
          hls.startLoad(currentTarget, true)
          pendingSeekPosition = null
        } catch {
          // Retain the target and let a later waiting/stalled event retry.
        }
      }, 0)
    }

    const applyPendingSeek = () => {
      if (disposed || pendingSeekPosition === null) return

      const duration = video.duration
      const target = Number.isFinite(duration) && duration > 0
        ? Math.min(pendingSeekPosition, duration)
        : pendingSeekPosition

      if (Number.isFinite(target)) {
        try {
          if (Math.abs(video.currentTime - target) > 0.05) {
            video.currentTime = target
          }
        } catch {
          // The media element can reject a seek while metadata is changing;
          // retain pendingSeekPosition and retry on the next metadata event.
          return
        }
      }

      if (manifestReady) scheduleLoadAt(target)
    }

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

      const fallbackPosition = pendingSeekPosition ?? (
        Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : null
      )
      const shouldResume = !video.paused || playIntentRef?.current === true

      if (shouldResume && playIntentRef) {
        // Loading a new source emits a pause event. Preserve the user's play
        // intent across that reset so the player can resume after metadata.
        playIntentRef.current = true
      }

      hls?.destroy()
      hls = null

      if (fallbackUrl) {
        setVideoSource(fallbackUrl, 'fallback')
        if (fallbackPosition !== null) {
          const restoreFallbackPosition = () => {
            if (disposed) return
            const duration = video.duration
            const target = Number.isFinite(duration) && duration > 0
              ? Math.min(fallbackPosition, duration)
              : fallbackPosition
            try {
              video.currentTime = target
              if (shouldResume) void video.play().catch(() => {})
            } catch {
              // A later loadedmetadata event will retry the position.
              video.addEventListener('loadedmetadata', restoreFallbackPosition, { once: true })
            }
          }
          if (video.readyState >= 1) restoreFallbackPosition()
          else video.addEventListener('loadedmetadata', restoreFallbackPosition, { once: true })
        }
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
        // Keep enough media around the playhead to avoid an immediate stall
        // after a seek while still allowing hls.js to discard stale data.
        backBufferLength: 30,
        maxBufferLength: 12,
        maxMaxBufferLength: 24,
        maxFragLookUpTolerance: 0.1,
        // CDN requests can briefly fail while a signed manifest or segment is
        // being refreshed. Keep the player in HLS recovery for a few seconds
        // before considering a progressive fallback.
        manifestLoadingMaxRetry: 4,
        manifestLoadingRetryDelay: 1000,
        manifestLoadingMaxRetryTimeout: 8000,
        fragLoadingMaxRetry: 4,
        fragLoadingRetryDelay: 1000,
        fragLoadingMaxRetryTimeout: 8000,
      })

      hls.on(Events.MEDIA_ATTACHED, () => {
        if (!disposed) hls?.loadSource(hlsUrl)
      })

      hls.on(Events.MANIFEST_PARSED, () => {
        manifestReady = true
        networkRecoveryAttempts = 0
        applyPendingSeek()
      })

      // Keep seeks made before the manifest/metadata is ready. hls.js cannot
      // select a fragment for those seeks yet, so replay the latest target as
      // soon as the level is available.
      handleSeeking = () => {
        if (disposed || !Number.isFinite(video.currentTime)) return
        pendingSeekPosition = Math.max(0, video.currentTime)
        if (manifestReady) scheduleLoadAt(video.currentTime)
      }
      video.addEventListener('seeking', handleSeeking)

      handleWaiting = () => {
        if (disposed || !manifestReady || !Number.isFinite(video.currentTime)) return
        // hls.js exposes `loadingEnabled` as a start/stop switch, not as an
        // indication that a fragment request is currently in flight. Let the
        // position/cooldown guard in scheduleLoadAt decide whether a restart
        // is useful so a stalled loader can recover as well.
        scheduleLoadAt(video.currentTime)
      }
      video.addEventListener('waiting', handleWaiting)
      video.addEventListener('stalled', handleWaiting)

      handleLoadedMetadata = applyPendingSeek
      handleDurationChange = applyPendingSeek
      video.addEventListener('loadedmetadata', handleLoadedMetadata)
      video.addEventListener('durationchange', handleDurationChange)

      hls.on(Events.ERROR, (_event, data: ErrorData) => {
        if (!data.fatal || disposed || !hls) return

        if (data.type === ErrorTypes.NETWORK_ERROR && networkRecoveryAttempts < 5) {
          networkRecoveryAttempts += 1
          const retryDelay = Math.min(8000, 500 * Math.pow(2, networkRecoveryAttempts - 1))
          if (recoveryTimer !== null) clearTimeout(recoveryTimer)
          recoveryTimer = setTimeout(() => {
            recoveryTimer = null
            if (disposed || !hls) return
            if (manifestReady && Number.isFinite(video.currentTime)) {
              scheduleLoadAt(video.currentTime, true)
            } else {
              hls.startLoad()
            }
          }, retryDelay)
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
      if (handleWaiting) {
        video.removeEventListener('waiting', handleWaiting)
        video.removeEventListener('stalled', handleWaiting)
      }
      if (handleLoadedMetadata) video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      if (handleDurationChange) video.removeEventListener('durationchange', handleDurationChange)
      if (seekLoadTimer !== null) clearTimeout(seekLoadTimer)
      if (recoveryTimer !== null) clearTimeout(recoveryTimer)
      pendingForceLoad = false
      hls?.destroy()
      video.pause()
      video.preload = previousPreload
      video.removeAttribute('src')
      video.load()
    }
  }, [attachmentKey, enabled, fallbackUrl, hlsUrl, playIntentRef, videoRef])

  return { isUsingHls }
}
