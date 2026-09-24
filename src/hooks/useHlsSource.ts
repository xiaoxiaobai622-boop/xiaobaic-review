'use client'

import Hls, { ErrorTypes, Events, type ErrorData } from 'hls.js'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { isTimeBuffered } from '@/lib/media-buffer'

interface UseHlsSourceOptions {
  videoRef: RefObject<HTMLVideoElement | null>
  hlsUrl?: string | null
  fallbackUrl?: string | null
  enabled?: boolean
  attachmentKey?: string | number
  playIntentRef?: { current: boolean }
  onPlaybackError?: (info: PlaybackFailureInfo) => void
}

/**
 * Why playback stopped. A refused media URL, an unsupported codec and an
 * unreachable network look identical to the viewer unless the cause is carried
 * out of the player.
 */
export type PlaybackFailureCause = 'auth' | 'decode' | 'unsupported' | 'network'

export interface PlaybackFailureInfo {
  cause: PlaybackFailureCause
  /** HTTP status of the last failed manifest/fragment request, if any. */
  httpStatus?: number
  /** `HTMLMediaElement.error.code`: 3 = decode, 4 = unsupported source. */
  mediaErrorCode?: number
}

const classifyPlaybackFailure = (
  httpStatus?: number,
  mediaErrorCode?: number,
): PlaybackFailureCause => {
  if (httpStatus === 401 || httpStatus === 403) return 'auth'
  if (mediaErrorCode === 3) return 'decode'
  if (mediaErrorCode === 4) return 'unsupported'
  return 'network'
}

interface UseHlsSourceResult {
  isUsingHls: boolean
}

const SEEK_LOAD_DEBOUNCE_MS = 180
const SEEK_LOAD_RESTART_COOLDOWN_MS = 750

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
    let seekLoadTimer: ReturnType<typeof setTimeout> | null = null
    let pendingSeekPosition: number | null = null
    let pendingForceLoad = false
    let recoveryTimer: ReturnType<typeof setTimeout> | null = null
    let lastLoadRequestPosition: number | null = null
    let lastLoadRequestAt = 0
    let lastScheduledPosition: number | null = null
    let disposed = false
    let lastNetworkStatus: number | undefined

    // Registered in attach order so teardown replays the same order.
    const videoListeners: Array<[string, () => void]> = []
    const listenToVideo = (type: string, handler: () => void) => {
      video.addEventListener(type, handler)
      videoListeners.push([type, handler])
    }

    const clampToDuration = (position: number): number => {
      const duration = video.duration
      return Number.isFinite(duration) && duration > 0
        ? Math.min(position, duration)
        : position
    }

    const isBufferedAt = (position: number): boolean => isTimeBuffered(video, position)

    const scheduleLoadAt = (position: number, force = false) => {
      if (disposed || !hls || !Number.isFinite(position)) return

      const target = Math.max(0, position)
      const isNewTarget = lastScheduledPosition === null || Math.abs(lastScheduledPosition - target) >= 0.25
      if (isNewTarget) {
        // A new user seek supersedes recovery work for the previous fragment.
        // Do not let intentionally aborted requests consume the retry budget
        // for the final position in a rapid click sequence.
        networkRecoveryAttempts = 0
        lastNetworkStatus = undefined
        lastScheduledPosition = target
        if (recoveryTimer !== null) {
          clearTimeout(recoveryTimer)
          recoveryTimer = null
        }
      }
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
        const elapsedSinceLastLoad = now - lastLoadRequestAt
        const sameTarget = lastLoadRequestPosition !== null && Math.abs(lastLoadRequestPosition - currentTarget) < 0.25
        const cooldown = sameTarget ? 2000 : SEEK_LOAD_RESTART_COOLDOWN_MS
        if (!forceLoad && lastLoadRequestAt > 0 && elapsedSinceLastLoad < cooldown) {
          // Keep the target alive. A seek can emit `waiting` only once, so
          // dropping it here can leave a paused player stuck forever. The
          // cooldown also prevents different rapid targets from repeatedly
          // aborting the active fragment request.
          const retryDelay = Math.max(50, cooldown - elapsedSinceLastLoad + 25)
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
      }, force ? 0 : SEEK_LOAD_DEBOUNCE_MS)
    }

    const applyPendingSeek = () => {
      if (disposed || pendingSeekPosition === null) return

      const target = clampToDuration(pendingSeekPosition)

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
            const target = clampToDuration(fallbackPosition)
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
        onPlaybackErrorRef.current?.({
          cause: classifyPlaybackFailure(lastNetworkStatus),
          httpStatus: lastNetworkStatus,
        })
      }
    }

    const handleMediaElementError = () => {
      if (sourceType === 'hls') {
        activateFallback()
      } else if (sourceType === 'fallback') {
        const mediaErrorCode = video.error?.code
        onPlaybackErrorRef.current?.({
          cause: classifyPlaybackFailure(lastNetworkStatus, mediaErrorCode),
          httpStatus: lastNetworkStatus,
          mediaErrorCode,
        })
      }
    }

    listenToVideo('error', handleMediaElementError)

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
        lastNetworkStatus = undefined
        applyPendingSeek()
      })

      hls.on(Events.FRAG_LOADED, () => {
        // A completed fragment proves the current source is healthy. Network
        // failures from earlier seek targets must not carry into later seeks.
        networkRecoveryAttempts = 0
        lastNetworkStatus = undefined
      })

      // Keep seeks made before the manifest/metadata is ready. hls.js cannot
      // select a fragment for those seeks yet, so replay the latest target as
      // soon as the level is available.
      listenToVideo('seeking', () => {
        if (disposed || !Number.isFinite(video.currentTime)) return
        pendingSeekPosition = Math.max(0, video.currentTime)
        if (manifestReady) scheduleLoadAt(video.currentTime)
      })

      // hls.js exposes `loadingEnabled` as a start/stop switch, not as an
      // indication that a fragment request is currently in flight. Let the
      // position/cooldown guard in scheduleLoadAt decide whether a restart
      // is useful so a stalled loader can recover as well.
      const handleWaiting = () => {
        if (disposed || !manifestReady || !Number.isFinite(video.currentTime)) return
        scheduleLoadAt(video.currentTime)
      }
      listenToVideo('waiting', handleWaiting)
      listenToVideo('stalled', handleWaiting)

      listenToVideo('loadedmetadata', applyPendingSeek)
      listenToVideo('durationchange', applyPendingSeek)

      hls.on(Events.ERROR, (_event, data: ErrorData) => {
        if (!data.fatal || disposed || !hls) return

        if (data.type === ErrorTypes.NETWORK_ERROR) {
          const status = data.response?.code
          if (status) lastNetworkStatus = status
          // A 401/403 means the media URL itself was refused, so every retry is
          // guaranteed to fail. Falling through keeps the failure honest and
          // immediate instead of burning the backoff budget on a dead token.
          if (status === 401 || status === 403) {
            activateFallback()
            return
          }
          if (networkRecoveryAttempts < 5) {
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
      // An HLS-only source in a browser that supports neither native nor
      // MSE playback has no way to play it, whatever the network does.
      onPlaybackErrorRef.current?.({ cause: 'unsupported' })
    }

    return () => {
      disposed = true
      for (const [type, handler] of videoListeners) video.removeEventListener(type, handler)
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
