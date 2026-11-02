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
  onPlaybackRecovered?: (info?: PlaybackRecoveryInfo) => void
  /** Position to restore when a user-requested retry re-attaches the source. */
  initialPosition?: number | null
}

/**
 * Why playback stopped. A refused media URL, an unsupported codec and an
 * unreachable network look identical to the viewer unless the cause is carried
 * out of the player.
 */
export type PlaybackFailureCause = 'auth' | 'decode' | 'unsupported' | 'unavailable' | 'network'

export interface PlaybackFailureInfo {
  cause: PlaybackFailureCause
  /** HTTP status of the last failed manifest/fragment request, if any. */
  httpStatus?: number
  /** `HTMLMediaElement.error.code`: 3 = decode, 4 = unsupported source. */
  mediaErrorCode?: number
}

export interface PlaybackRecoveryInfo {
  cause: PlaybackFailureCause
  httpStatus?: number
  /** True when the retry succeeded on the progressive fallback rendition. */
  fallback?: boolean
}

type PlaybackProbe = {
  status?: number
  retryAfterMs?: number
}

const classifyPlaybackFailure = (
  httpStatus?: number,
  mediaErrorCode?: number,
): PlaybackFailureCause => {
  if (httpStatus === 401 || httpStatus === 403) return 'auth'
  // A progressive token for an HLS-only video has no rendition to play. That
  // is a format/capability mismatch, not a server outage.
  if (httpStatus === 415) return 'unsupported'
  // A media element reports every HTTP failure as MediaError 3/4, so an error
  // response from the content endpoint must not be dressed up as a codec or a
  // network problem. 404/409/5xx are a server-side "not available", not the
  // viewer's connection.
  if (httpStatus !== undefined && httpStatus >= 400) return 'unavailable'
  if (mediaErrorCode === 3) return 'decode'
  if (mediaErrorCode === 4) return 'unsupported'
  return 'network'
}

const PLAYBACK_PROBE_TIMEOUT_MS = 4000
const FALLBACK_NETWORK_RETRY_DELAYS_MS = [1000, 3000]
const UNAVAILABLE_PROBE_DELAYS_MS = [1000, 3000, 5000, 7000]
const UNAVAILABLE_MAX_RETRIES = 2

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
  onPlaybackRecovered,
  initialPosition,
}: UseHlsSourceOptions): UseHlsSourceResult {
  const [isUsingHls, setIsUsingHls] = useState(false)
  const onPlaybackErrorRef = useRef(onPlaybackError)
  const onPlaybackRecoveredRef = useRef(onPlaybackRecovered)
  const initialPositionRef = useRef(initialPosition)
  // A re-signed URL keeps the same video and element, so the effect below is
  // torn down and rebuilt with no memory of where playback was. Carry that
  // position across the rebuild; a different video changes attachmentKey and
  // must not inherit the previous video's position.
  const carriedPositionRef = useRef<{ key: string; position: number; playing?: boolean } | null>(null)

  useEffect(() => {
    onPlaybackErrorRef.current = onPlaybackError
  }, [onPlaybackError])

  useEffect(() => {
    onPlaybackRecoveredRef.current = onPlaybackRecovered
  }, [onPlaybackRecovered])

  useEffect(() => {
    initialPositionRef.current = initialPosition
  }, [initialPosition])

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
    let restartTimer: ReturnType<typeof setTimeout> | null = null
    let nativeRestartTimer: ReturnType<typeof setTimeout> | null = null
    let fallbackRetryTimer: ReturnType<typeof setTimeout> | null = null
    let sourceRestartAttempts = 0
    let nativeRestartAttempts = 0
    let fallbackNetworkAttempts = 0
    let fallbackProbeInFlight = false
    let nativeProbeInFlight = false
    let fallbackResumeOnReconnect = false
    let unavailableProbeTimer: ReturnType<typeof setTimeout> | null = null
    let unavailableRetryTimer: ReturnType<typeof setTimeout> | null = null
    let unavailableProbeStarted = false
    let unavailableRetryAttempts = 0
    let unavailableReported = false
    let unavailableResume = false
    let pendingRecoveryInfo: PlaybackRecoveryInfo | null = null
    // Once a terminal refusal has been handed to the player, later media
    // element errors must not restart the session or silently downgrade it.
    let terminalFailureReported = false
    let lastLoadRequestPosition: number | null = null
    let lastLoadRequestAt = 0
    let lastScheduledPosition: number | null = null
    let disposed = false
    let lastNetworkStatus: number | undefined
    // Last position the media element actually reached. Recovery uses this when
    // the element has already reset to 0, so a restart cannot resurrect a stale
    // pending target from an earlier attempt.
    let lastPlaybackPosition = 0
    const carryKey = String(attachmentKey ?? '')
    const carried = carriedPositionRef.current
    if (carried && carried.key === carryKey && carried.position > 0.1) {
      pendingSeekPosition = carried.position
    } else if (typeof initialPositionRef.current === 'number' && initialPositionRef.current > 0.1) {
      pendingSeekPosition = initialPositionRef.current
    }
    // A re-signed URL is the same playback, not a new play intent: resume once
    // the carried position is applied, but only if it was actually playing.
    let resumeAfterCarry = Boolean(
      carried && carried.key === carryKey && carried.playing && playIntentRef?.current
    )

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
      // A metadata/duration notification is not a request to replay an old
      // target. Apply once; only put it back when the element refuses the seek.
      pendingSeekPosition = null

      if (Number.isFinite(target)) {
        try {
          if (Math.abs(video.currentTime - target) > 0.05) {
            video.currentTime = target
          }
        } catch {
          // The media element can reject a seek while metadata is changing;
          // retain pendingSeekPosition and retry on the next metadata event.
          pendingSeekPosition = target
          return
        }
      }

      if (manifestReady) scheduleLoadAt(target)

      if (resumeAfterCarry) {
        resumeAfterCarry = false
        if (playIntentRef?.current) void video.play().catch(() => {})
      }
    }

    const setVideoSource = (source: string, type: 'hls' | 'fallback') => {
      sourceType = type
      terminalFailureReported = false
      setIsUsingHls(type === 'hls')
      // HLS needs the first media segment available before the first play or seek.
      // Keep the existing metadata behaviour for ordinary MP4 fallbacks.
      video.preload = type === 'hls' ? 'auto' : previousPreload
      video.src = source
      video.load()
    }

    const activateFallback = () => {
      if (disposed) return

      fallbackNetworkAttempts = 0
      const current = Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : 0
      const fallbackPosition = pendingSeekPosition ?? (
        current > 0 ? current : lastPlaybackPosition > 0 ? lastPlaybackPosition : null
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
        pendingRecoveryInfo = {
          cause: classifyPlaybackFailure(lastNetworkStatus),
          httpStatus: lastNetworkStatus,
          fallback: true,
        }
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
        if (terminalFailureReported) return
        terminalFailureReported = true
        onPlaybackErrorRef.current?.({
          cause: classifyPlaybackFailure(lastNetworkStatus),
          httpStatus: lastNetworkStatus,
        })
      }
    }

    // A transient CDN failure can kill the media element before hls.js has a
    // chance to retry the fragment (our repro aborted one segment and the
    // element reported DEMUXER_ERROR_COULD_NOT_PARSE). Rebuilding only the
    // buffer is not enough when the loader has already stopped; tear down the
    // whole HLS session and attach a fresh one before falling back. HLS-only
    // videos have no progressive URL, so a premature fallback is a dead end.
    const restartHls = () => {
      const media = video
      if (disposed || !media) return
      // Several errors can arrive for the same dying session (media element,
      // hls.js media error, stalled loader). One pending rebuild supersedes
      // all of them; without this gate they exhaust the retry budget before
      // the first rebuild even starts.
      if (restartTimer !== null) return
      if (!hls || sourceRestartAttempts >= 2) {
        activateFallback()
        return
      }
      sourceRestartAttempts += 1
      manifestReady = false
      networkRecoveryAttempts = 0
      mediaRecoveryAttempts = 0
      lastNetworkStatus = undefined
      if (recoveryTimer !== null) {
        clearTimeout(recoveryTimer)
        recoveryTimer = null
      }
      if (restartTimer !== null) clearTimeout(restartTimer)
      if (nativeRestartTimer !== null) clearTimeout(nativeRestartTimer)
      restartTimer = setTimeout(() => {
        restartTimer = null
        if (disposed) return
        // Snapshot the playhead at the moment the old session is actually torn
        // down. If the element already reset itself, resume from the last
        // position it really reached instead of an older pending target.
        const atReset = Number.isFinite(media.currentTime) && media.currentTime > 0
          ? media.currentTime
          : lastPlaybackPosition
        if (atReset > 0) pendingSeekPosition = atReset
        startHlsJs()
      }, 400 * sourceRestartAttempts)
    }

    // A media element only exposes MediaError 3/4. Ask the exact URL what the
    // server said before turning a refused token into a codec/network verdict.
    // The body is cancelled as soon as headers arrive, so this is a header-only
    // round trip even for a multi-gigabyte original.
    const probePlaybackStatus = async (url: string | null | undefined): Promise<PlaybackProbe | undefined> => {
      if (!url || disposed) return undefined
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), PLAYBACK_PROBE_TIMEOUT_MS)
      try {
        const response = await fetch(url, {
          method: 'GET',
          cache: 'no-store',
          // Keep the probe off the non-range session counter and stop the body
          // as soon as the status line is known.
          headers: { Range: 'bytes=0-1' },
          signal: controller.signal,
        })
        const status = response.status
        let retryAfterMs: number | undefined
        const retryAfterHeader = response.headers.get('retry-after')
        if (retryAfterHeader) {
          const seconds = Number(retryAfterHeader)
          if (Number.isFinite(seconds)) {
            retryAfterMs = Math.max(0, seconds * 1000)
          } else {
            const date = Date.parse(retryAfterHeader)
            if (Number.isFinite(date)) retryAfterMs = Math.max(0, date - Date.now())
          }
        }
        try {
          await response.body?.cancel()
        } catch {
          // The response may already be closed; the status is all we need.
        }
        return { status, retryAfterMs }
      } catch {
        return undefined
      } finally {
        clearTimeout(timer)
      }
    }

    const replayFallbackAt = (position: number, resumeOverride?: boolean) => {
      if (disposed || !fallbackUrl) return
      const shouldResume = resumeOverride ?? (!video.paused || playIntentRef?.current === true)
      if (shouldResume && playIntentRef) playIntentRef.current = true
      if (position > 0) pendingSeekPosition = position
      setVideoSource(fallbackUrl, 'fallback')
      if (shouldResume) {
        video.addEventListener('loadedmetadata', () => {
          if (!disposed) void video.play().catch(() => {})
        }, { once: true })
      }
    }

    const fallbackPosition = (fallback: number): number => {
      if (Number.isFinite(video.currentTime) && video.currentTime > 0) return video.currentTime
      if (lastPlaybackPosition > 0) return lastPlaybackPosition
      return Math.max(0, fallback)
    }

    const scheduleUnavailableReload = (
      httpStatus: number | undefined,
      retryAfterMs: number | undefined,
      fallbackAt: number,
      resume: boolean,
    ) => {
      if (disposed || !fallbackUrl || unavailableRetryAttempts >= UNAVAILABLE_MAX_RETRIES) return
      if (unavailableRetryTimer !== null) return
      const delay = retryAfterMs && retryAfterMs > 0 ? retryAfterMs : 5000
      unavailableRetryAttempts += 1
      unavailableRetryTimer = setTimeout(() => {
        unavailableRetryTimer = null
        if (disposed || sourceType !== 'fallback') return
        pendingRecoveryInfo = { cause: 'unavailable', httpStatus, fallback: true }
        replayFallbackAt(fallbackPosition(fallbackAt), resume)
      }, delay)
    }

    // A 503/5xx is usually transient. Keep the overlay honest, but poll for a
    // health transition and reload as soon as the endpoint is readable again.
    // The actual reload still honours Retry-After; the poll only asks for the
    // status line (Range: bytes=0-1).
    const startUnavailableRecovery = (
      httpStatus: number | undefined,
      retryAfterMs: number | undefined,
      fallbackAt: number,
      resume: boolean,
    ) => {
      if (disposed || !fallbackUrl || unavailableProbeStarted) {
        if (unavailableProbeStarted) scheduleUnavailableReload(httpStatus, retryAfterMs, fallbackAt, resume)
        return
      }
      unavailableProbeStarted = true
      unavailableResume = resume
      let probeIndex = 0
      const runProbe = async () => {
        unavailableProbeTimer = null
        if (disposed || !fallbackUrl) return
        const probe = await probePlaybackStatus(fallbackUrl)
        if (disposed) return
        const status = probe?.status
        if (status !== undefined && status < 400) {
          pendingRecoveryInfo = { cause: 'unavailable', httpStatus, fallback: true }
          replayFallbackAt(fallbackPosition(fallbackAt), unavailableResume)
          return
        }
        if (probeIndex < UNAVAILABLE_PROBE_DELAYS_MS.length - 1) {
          probeIndex += 1
          unavailableProbeTimer = setTimeout(runProbe, UNAVAILABLE_PROBE_DELAYS_MS[probeIndex])
          return
        }
        scheduleUnavailableReload(httpStatus, retryAfterMs, fallbackAt, unavailableResume)
      }
      unavailableProbeTimer = setTimeout(runProbe, UNAVAILABLE_PROBE_DELAYS_MS[0])
    }

    const reportFallbackFailure = async () => {
      if (disposed || fallbackProbeInFlight) return
      fallbackProbeInFlight = true
      const mediaErrorCode = video.error?.code
      const probe = lastNetworkStatus === undefined
        ? await probePlaybackStatus(fallbackUrl)
        : undefined
      fallbackProbeInFlight = false
      if (disposed) return
      const httpStatus = probe?.status ?? lastNetworkStatus
      const probedStatus = probe?.status
      const retryAfterMs = probe?.retryAfterMs
      let cause = classifyPlaybackFailure(httpStatus, mediaErrorCode)
      // Re-arming the media element turns the retry's own failure into code 4
      // even when the original problem was an unreachable network. Keep the
      // cause we were already retrying instead of flipping to "unsupported".
      if (cause === 'unsupported' && probedStatus === undefined && fallbackNetworkAttempts > 0) {
        cause = 'network'
      }

      // The media element has no retry layer of its own. A short outage used to
      // turn into a permanent failure, and the crossOrigin retry's second code-4
      // error overwrote the network cause. Retry the same source with backoff;
      // a successful `playing` resets the budget.
      if (cause === 'network') {
        fallbackResumeOnReconnect = !video.paused || playIntentRef?.current === true
      }
      if (cause === 'network' && fallbackUrl && fallbackNetworkAttempts < FALLBACK_NETWORK_RETRY_DELAYS_MS.length) {
        const delay = FALLBACK_NETWORK_RETRY_DELAYS_MS[fallbackNetworkAttempts]
        fallbackNetworkAttempts += 1
        if (fallbackRetryTimer !== null) clearTimeout(fallbackRetryTimer)
        fallbackRetryTimer = setTimeout(() => {
          fallbackRetryTimer = null
          if (disposed || sourceType !== 'fallback') return
          pendingRecoveryInfo = { cause: 'network', httpStatus, fallback: true }
          replayFallbackAt(fallbackPosition(0))
        }, delay)
        return
      }

      // 503/5xx: the endpoint is telling us it is transiently unavailable.
      // Show the honest overlay once, then keep polling/reloading in the
      // background so a recovered endpoint clears it without a page refresh.
      if (cause === 'unavailable' && httpStatus !== undefined && httpStatus >= 500) {
        const wasPlaying = !video.paused || playIntentRef?.current === true
        if (!unavailableReported) {
          unavailableReported = true
          terminalFailureReported = true
          onPlaybackErrorRef.current?.({ cause, httpStatus, mediaErrorCode })
        }
        startUnavailableRecovery(httpStatus, retryAfterMs, fallbackPosition(0), wasPlaying)
        return
      }

      if (terminalFailureReported) return
      terminalFailureReported = true
      onPlaybackErrorRef.current?.({ cause, httpStatus, mediaErrorCode })
    }

    // Native HLS (Safari/WebKit, and some embedded WebViews) has no retry
    // layer of its own: one failed segment leaves the media element in an
    // unrecoverable error state. Reload the manifest/source and resume at the
    // previous position before giving up. The hls.js path above uses the same
    // budget with a full session rebuild.
    const restartNativeHls = () => {
      const media = video
      if (disposed || !media || !hlsUrl || nativeRestartTimer !== null || nativeProbeInFlight) return
      if (nativeRestartAttempts >= 2) {
        activateFallback()
        return
      }
      nativeRestartAttempts += 1
      const shouldResume = !media.paused || playIntentRef?.current === true
      const scheduleReload = () => {
        nativeRestartTimer = setTimeout(() => {
          nativeRestartTimer = null
          if (disposed) return
          // Same rule as the hls.js rebuild: the source is about to be replaced,
          // so the position worth keeping is the one the element holds right now.
          const atReset = Number.isFinite(media.currentTime) && media.currentTime > 0
            ? media.currentTime
            : lastPlaybackPosition
          if (atReset > 0) pendingSeekPosition = atReset
          setVideoSource(hlsUrl, 'hls')
          if (shouldResume) {
            media.addEventListener('loadedmetadata', () => {
              if (!disposed) void media.play().catch(() => {})
            }, { once: true })
          }
        }, 400 * nativeRestartAttempts)
      }

      // Native WebKit hides the manifest's HTTP status behind MediaError 2/4.
      // On the first error, ask the manifest directly so an expired token is
      // reported as auth (and re-minted) instead of burning the reload budget
      // and ending as a bogus network error.
      if (nativeRestartAttempts > 1) {
        scheduleReload()
        return
      }
      nativeProbeInFlight = true
      void probePlaybackStatus(hlsUrl).then((probe) => {
        nativeProbeInFlight = false
        if (disposed) return
        const status = probe?.status
        if (status === 401 || status === 403) {
          if (terminalFailureReported) return
          terminalFailureReported = true
          onPlaybackErrorRef.current?.({ cause: 'auth', httpStatus: status, mediaErrorCode: video.error?.code })
          return
        }
        if (status !== undefined && status >= 400) {
          if (terminalFailureReported) return
          terminalFailureReported = true
          onPlaybackErrorRef.current?.({ cause: 'unavailable', httpStatus: status, mediaErrorCode: video.error?.code })
          return
        }
        scheduleReload()
      })
    }

    function startHlsJs() {
      const media = video
      const sourceUrl = hlsUrl
      if (disposed || !media || !sourceUrl) return
      if (hls) {
        try {
          hls.destroy()
        } catch {
          // The previous instance may already have torn down its media source.
        }
        hls = null
      }
      sourceType = 'hls'
      terminalFailureReported = false
      setIsUsingHls(true)
      media.preload = 'auto'
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
        if (!disposed) hls?.loadSource(sourceUrl)
      })

      hls.on(Events.MANIFEST_PARSED, () => {
        manifestReady = true
        networkRecoveryAttempts = 0
        lastNetworkStatus = undefined
        applyPendingSeek()
      })

      hls.on(Events.FRAG_LOADED, () => {
        // A completed fragment proves the current source is healthy. Network
        // failures from earlier seek targets must not carry into later seeks,
        // and a rebuilt session starts its retry budget over.
        if (networkRecoveryAttempts > 0) {
          onPlaybackRecoveredRef.current?.({ cause: 'network', httpStatus: lastNetworkStatus })
        }
        networkRecoveryAttempts = 0
        mediaRecoveryAttempts = 0
        sourceRestartAttempts = 0
        lastNetworkStatus = undefined
      })

      hls.on(Events.ERROR, (_event, data: ErrorData) => {
        if (!data.fatal || disposed || !hls) return

        if (data.type === ErrorTypes.NETWORK_ERROR) {
          const status = data.response?.code
          if (status) lastNetworkStatus = status
          // A 401/403 means the media URL itself was refused. The player owns
          // the re-mint and fallback decision: hand it the auth cause instead
          // of silently swapping to the progressive rendition.
          if (status === 401 || status === 403) {
            if (terminalFailureReported) return
            terminalFailureReported = true
            onPlaybackErrorRef.current?.({
              cause: 'auth',
              httpStatus: status,
              mediaErrorCode: video.error?.code,
            })
            return
          }
          if (networkRecoveryAttempts < 5) {
            networkRecoveryAttempts += 1
            const retryDelay = Math.min(8000, 500 * Math.pow(2, networkRecoveryAttempts - 1))
            if (recoveryTimer !== null) clearTimeout(recoveryTimer)
            recoveryTimer = setTimeout(() => {
              recoveryTimer = null
              if (disposed || !hls) return
              if (manifestReady && Number.isFinite(media.currentTime)) {
                scheduleLoadAt(media.currentTime, true)
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

        restartHls()
      })

      hls.attachMedia(media)
    }

    const handleMediaElementError = () => {
      if (terminalFailureReported) return
      if (sourceType === 'hls') {
        if (hls) {
          if (mediaRecoveryAttempts < 1) {
            mediaRecoveryAttempts += 1
            try {
              hls.recoverMediaError()
              return
            } catch {
              // Fall through to a full session rebuild when the buffer swap
              // cannot be issued at all.
            }
          }
          restartHls()
          return
        }
        restartNativeHls()
      } else if (sourceType === 'fallback') {
        void reportFallbackFailure()
      }
    }

    listenToVideo('error', handleMediaElementError)

    // Keep seeks made before the manifest/metadata is ready. hls.js cannot
    // select a fragment for those seeks yet, so replay the latest target as
    // soon as the level is available. Registered once; a rebuilt HLS session
    // reuses the same listeners.
    listenToVideo('seeking', () => {
      if (disposed || !Number.isFinite(video.currentTime)) return
      pendingSeekPosition = Math.max(0, video.currentTime)
      if (manifestReady) scheduleLoadAt(video.currentTime)
    })

    const rememberPlaybackPosition = () => {
      if (Number.isFinite(video.currentTime) && video.currentTime > 0) {
        lastPlaybackPosition = video.currentTime
        carriedPositionRef.current = { key: carryKey, position: video.currentTime }
      }
    }
    listenToVideo('timeupdate', rememberPlaybackPosition)
    // A completed seek has reached its target; keeping the target pending makes
    // the next metadata/duration notification rewind the playhead to it later.
    listenToVideo('seeked', () => {
      if (Number.isFinite(video.currentTime)) {
        lastPlaybackPosition = video.currentTime
        carriedPositionRef.current = { key: carryKey, position: video.currentTime }
      }
      if (pendingSeekPosition === null || !Number.isFinite(video.currentTime)) return
      // hls.js cannot select a fragment for a seek made before the manifest is
      // parsed; keep that target for MANIFEST_PARSED.
      if (!manifestReady && hls) return
      if (Math.abs(video.currentTime - clampToDuration(pendingSeekPosition)) <= 0.5) {
        pendingSeekPosition = null
      }
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

    listenToVideo('playing', () => {
      const recovered = pendingRecoveryInfo ?? (
        networkRecoveryAttempts > 0
          ? { cause: 'network' as const, httpStatus: lastNetworkStatus }
          : undefined
      )
      pendingRecoveryInfo = null
      nativeRestartAttempts = 0
      fallbackNetworkAttempts = 0
      fallbackResumeOnReconnect = false
      unavailableProbeStarted = false
      unavailableRetryAttempts = 0
      unavailableReported = false
      unavailableResume = false
      if (unavailableProbeTimer !== null) {
        clearTimeout(unavailableProbeTimer)
        unavailableProbeTimer = null
      }
      if (unavailableRetryTimer !== null) {
        clearTimeout(unavailableRetryTimer)
        unavailableRetryTimer = null
      }
      // A healthy playback proves the last refused URL is no longer in play.
      // Without this, a later fallback failure could inherit an old HLS 403.
      lastNetworkStatus = undefined
      terminalFailureReported = false
      onPlaybackRecoveredRef.current?.(recovered)
    })
    listenToVideo('loadedmetadata', applyPendingSeek)
    listenToVideo('durationchange', applyPendingSeek)

    // A progressive source has no reconnection layer in the media element. If
    // the browser had already given up while the device was offline, coming
    // back online should reload the same URL at the last position instead of
    // leaving a dead element behind the failure message.
    const handleOnline = () => {
      if (disposed || sourceType !== 'fallback' || !fallbackUrl) return
      const stalled = Boolean(video.error) || (!video.paused && video.readyState < 3)
      if (!stalled) return
      const at = Number.isFinite(video.currentTime) && video.currentTime > 0
        ? video.currentTime
        : lastPlaybackPosition
      // The failure handler cleared the play intent; a viewer who was watching
      // should get that intent back when the device reconnects.
      if (fallbackResumeOnReconnect && playIntentRef) playIntentRef.current = true
      fallbackResumeOnReconnect = false
      pendingRecoveryInfo = { cause: 'network', httpStatus: lastNetworkStatus, fallback: true }
      replayFallbackAt(at)
    }
    window.addEventListener('online', handleOnline)

    if (hlsUrl && video.canPlayType('application/vnd.apple.mpegurl')) {
      setVideoSource(hlsUrl, 'hls')
    } else if (hlsUrl && Hls.isSupported()) {
      startHlsJs()
    } else if (fallbackUrl) {
      setVideoSource(fallbackUrl, 'fallback')
    } else {
      // An HLS-only source in a browser that supports neither native nor
      // MSE playback has no way to play it, whatever the network does.
      onPlaybackErrorRef.current?.({ cause: 'unsupported' })
    }

    return () => {
      disposed = true
      if (Number.isFinite(video.currentTime) && video.currentTime > 0) {
        carriedPositionRef.current = { key: carryKey, position: video.currentTime, playing: !video.paused }
      }
      for (const [type, handler] of videoListeners) video.removeEventListener(type, handler)
      window.removeEventListener('online', handleOnline)
      if (seekLoadTimer !== null) clearTimeout(seekLoadTimer)
      if (recoveryTimer !== null) clearTimeout(recoveryTimer)
      if (restartTimer !== null) clearTimeout(restartTimer)
      if (nativeRestartTimer !== null) clearTimeout(nativeRestartTimer)
      if (fallbackRetryTimer !== null) clearTimeout(fallbackRetryTimer)
      if (unavailableProbeTimer !== null) clearTimeout(unavailableProbeTimer)
      if (unavailableRetryTimer !== null) clearTimeout(unavailableRetryTimer)
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
