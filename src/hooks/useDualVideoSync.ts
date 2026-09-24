'use client'

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { isTimeBuffered } from '@/lib/media-buffer'
import { computeSyncDecision, frameTargetTime } from '@/lib/dual-video-sync'

const FALLBACK_FPS = 24
/** Corrections run on a timer: frame callbacks stop while the pair is frozen. */
const SYNC_TICK_MS = 40
const UI_SYNC_MS = 100
/**
 * Frozen-thresholds in ticks. A playing element's `currentTime` advances every
 * tick, so two identical readings already mean it stopped. The window has to
 * stay short: the master keeps running until the pair freezes, and every
 * millisecond there is a frame of disagreement the 4% nudge then has to heal.
 */
const SLAVE_NUDGE_TICKS = 2
const MASTER_FROZEN_TICKS = 5
const SLAVE_FROZEN_TICKS = 3

export type ComparisonSide = 'A' | 'B'

interface UseDualVideoSyncOptions {
  videoRefA: RefObject<HTMLVideoElement | null>
  videoRefB: RefObject<HTMLVideoElement | null>
  fps?: number | null
  /** User-selected speed; catch-up adjustments are layered on top of it. */
  speed: number
  /** Changes whenever either element is re-attached so the pair re-baselines. */
  attachmentKey: string
}

interface UseDualVideoSyncResult {
  isPlaying: boolean
  currentTime: number
  duration: number
  /** Which side's buffering currently holds the pair, or null. */
  waitingSide: ComparisonSide | null
  toggle: () => void
  pause: () => void
  seekTo: (time: number) => void
  stepFrame: (direction: 'forward' | 'backward') => void
  setSpeed: (speed: number) => void
}

function normalizeFps(fps: number | null | undefined): number {
  return typeof fps === 'number' && Number.isFinite(fps) && fps > 0 ? fps : FALLBACK_FPS
}

function mediaTime(video: HTMLVideoElement | null): number {
  return video && Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : 0
}

function finiteDuration(video: HTMLVideoElement | null): number {
  return video && Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0
}

/**
 * Lock two elements to the same frame. Version A is the master clock: the frame
 * it actually presented is what both sides must show, so a stalled B freezes A
 * instead of A running ahead. Drift is removed by nudging B's playback rate,
 * and only a gap too large to nudge away ever seeks (which would be visible).
 */
export function useDualVideoSync({
  videoRefA,
  videoRefB,
  fps,
  speed,
  attachmentKey,
}: UseDualVideoSyncOptions): UseDualVideoSyncResult {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [waitingSide, setWaitingSide] = useState<ComparisonSide | null>(null)

  const fpsRef = useRef(normalizeFps(fps))
  const speedRef = useRef(speed)
  /** Play intent survives buffering pauses so the pair can resume itself. */
  const intentRef = useRef(false)
  const waitingRef = useRef<ComparisonSide | null>(null)
  const presentedRef = useRef<number | null>(null)

  useEffect(() => {
    fpsRef.current = normalizeFps(fps)
  }, [fps])

  /**
   * The clock both elements are steered by. `currentTime` is the only quantity
   * the two elements share a domain in: the frame the browser has *presented*
   * already lags it by a frame on each element, so locking B's playhead to A's
   * presented frame leaves B one frame behind on screen.
   */
  const syncTime = useCallback((): number => mediaTime(videoRefA.current), [videoRefA])

  /** What the viewer can actually see on the master, for the timecode label. */
  const displayTime = useCallback(
    (): number => presentedRef.current ?? mediaTime(videoRefA.current),
    [videoRefA],
  )

  const pause = useCallback(() => {
    intentRef.current = false
    videoRefA.current?.pause()
    videoRefB.current?.pause()
    setIsPlaying(false)
  }, [videoRefA, videoRefB])

  const setSpeed = useCallback((nextSpeed: number) => {
    speedRef.current = nextSpeed
    const a = videoRefA.current
    if (a) a.playbackRate = nextSpeed
  }, [videoRefA])

  const play = useCallback(() => {
    const a = videoRefA.current
    const b = videoRefB.current
    if (!a || !b) return

    intentRef.current = true
    setIsPlaying(true)

    // Start from the same frame rather than letting the first tick drag B over.
    const target = frameTargetTime(syncTime(), fpsRef.current)
    if (Math.abs(mediaTime(b) - target) > 1 / fpsRef.current / 2 && !b.seeking) {
      try {
        b.currentTime = target
      } catch {
        // Metadata can still be settling; the tick will realign.
      }
    }
    void Promise.all([a.play(), b.play()]).catch(() => {
      intentRef.current = false
      setIsPlaying(false)
    })
  }, [syncTime, videoRefA, videoRefB])

  const toggle = useCallback(() => {
    if (intentRef.current) pause()
    else play()
  }, [pause, play])

  const seekTo = useCallback((time: number) => {
    const a = videoRefA.current
    const b = videoRefB.current
    if (!a || !b) return

    const limit = Math.max(finiteDuration(a), finiteDuration(b))
    const target = Math.min(Math.max(0, time), limit || Math.max(0, time))
    presentedRef.current = null
    for (const element of [a, b]) {
      try {
        element.currentTime = target
      } catch {
        // A source swap can reject a seek; hls.js replays it on metadata.
      }
    }
    setCurrentTime(target)
  }, [videoRefA, videoRefB])

  const stepFrame = useCallback((direction: 'forward' | 'backward') => {
    pause()
    const a = videoRefA.current
    const grid = fpsRef.current
    const frame = Math.round(syncTime() * grid) + (direction === 'forward' ? 1 : -1)
    const lastFrame = Math.floor(finiteDuration(a) * grid)
    const target = Math.min(Math.max(0, frame), Math.max(0, lastFrame)) / grid
    seekTo(target)
  }, [syncTime, pause, seekTo, videoRefA])

  useEffect(() => {
    const a = videoRefA.current
    const b = videoRefB.current
    if (!a || !b) return

    let disposed = false
    let frameHandle = 0
    let lastUiPush = 0

    intentRef.current = false
    waitingRef.current = null
    presentedRef.current = null
    setIsPlaying(false)
    setWaitingSide(null)
    setCurrentTime(0)
    setDuration(finiteDuration(a))

    const onMasterPlay = () => {
      intentRef.current = true
      setIsPlaying(true)
    }
    // Any pause of the master takes the slave with it; a buffering pause keeps
    // the play intent so the loop below can resume the pair by itself.
    const onMasterPause = () => {
      b.pause()
      if (!intentRef.current) setIsPlaying(false)
    }
    const onMasterEnded = () => {
      intentRef.current = false
      b.pause()
      setIsPlaying(false)
    }
    const onDurationChange = () => setDuration(finiteDuration(a))

    const listeners: Array<[HTMLVideoElement, string, () => void]> = [
      [a, 'play', onMasterPlay],
      [a, 'pause', onMasterPause],
      [a, 'ended', onMasterEnded],
      [a, 'loadedmetadata', onDurationChange],
      [a, 'durationchange', onDurationChange],
    ]
    for (const [element, type, handler] of listeners) element.addEventListener(type, handler)

    // `mediaTime` is the frame the viewer can see. It cannot be the sync target
    // (each element's playhead already runs a frame ahead of it) but it is what
    // the timecode label must report, exactly like the main player.
    const trackPresented = () => {
      if (disposed) return
      frameHandle = a.requestVideoFrameCallback((_now, metadata) => {
        if (disposed) return
        presentedRef.current = metadata.mediaTime
        trackPresented()
      })
    }
    const usesFrameClock = typeof a.requestVideoFrameCallback === 'function'
    if (usesFrameClock) trackPresented()

    const holdPair = (side: ComparisonSide) => {
      if (!a.paused) a.pause()
      if (!b.paused) b.pause()
      if (waitingRef.current === side) return
      waitingRef.current = side
      setWaitingSide(side)
    }

    const releasePair = () => {
      if (waitingRef.current === null) return
      waitingRef.current = null
      setWaitingSide(null)
      if (!intentRef.current) return
      void a.play().catch(() => {})
      void b.play().catch(() => {})
    }

    // An element can stop advancing without ever firing `waiting` — the exact
    // failure this loop exists to catch — so progress is measured, not trusted.
    let lastMasterTime = -1
    let lastSlave = -1
    let masterFrozenTicks = 0
    let slaveFrozenTicks = 0

    const tick = () => {
      if (disposed) return

      const master = syncTime()
      const slaveTime = mediaTime(b)
      const now = performance.now()
      const pushUi = () => {
        const shown = displayTime()
        if (now - lastUiPush >= UI_SYNC_MS) {
          lastUiPush = now
          setCurrentTime((previous) => (Math.abs(previous - shown) > 1e-4 ? shown : previous))
        }
      }

      // While the pair is intentionally stopped there is nothing to correct, and
      // an empty buffer would otherwise read as "B is stalling".
      if (!intentRef.current) {
        masterFrozenTicks = 0
        slaveFrozenTicks = 0
        releasePair()
        pushUi()
        return
      }

      const grid = fpsRef.current
      const target = frameTargetTime(master, grid)
      const slaveLimit = finiteDuration(b)
      const decision = computeSyncDecision({
        masterTime: master,
        slaveTime,
        fps: grid,
        speed: speedRef.current,
        slaveReady: isTimeBuffered(b, slaveLimit > 0 ? Math.min(target, slaveLimit) : target),
        seeking: a.seeking || b.seeking,
        slaveDuration: b.duration,
      })

      if (waitingRef.current === null) {
        masterFrozenTicks = master === lastMasterTime ? masterFrozenTicks + 1 : 0
        slaveFrozenTicks = slaveTime === lastSlave ? slaveFrozenTicks + 1 : 0
        // Give a stopped slave one cheap chance to restart before freezing A too.
        if (slaveFrozenTicks >= SLAVE_NUDGE_TICKS && b.paused) {
          void b.play().catch(() => {})
        }
      } else {
        masterFrozenTicks = 0
        slaveFrozenTicks = 0
      }
      lastMasterTime = master
      lastSlave = slaveTime

      const masterFrozen = masterFrozenTicks >= MASTER_FROZEN_TICKS
      const blocked = decision.state === 'seeking'
        || decision.hold
        || masterFrozen
        || slaveFrozenTicks >= SLAVE_FROZEN_TICKS
      if (blocked) {
        holdPair(masterFrozen || a.seeking ? 'A' : 'B')
      } else {
        releasePair()
        if (decision.realign && !b.seeking) {
          b.playbackRate = speedRef.current
          b.currentTime = decision.targetTime
        } else if (decision.slaveRate !== null && b.playbackRate !== decision.slaveRate) {
          b.playbackRate = decision.slaveRate
        }
      }

      pushUi()
    }

    const timer = setInterval(tick, SYNC_TICK_MS)
    tick()

    return () => {
      disposed = true
      clearInterval(timer)
      if (usesFrameClock && frameHandle) a.cancelVideoFrameCallback(frameHandle)
      for (const [element, type, handler] of listeners) element.removeEventListener(type, handler)
      a.pause()
      b.pause()
      b.playbackRate = speedRef.current
    }
    // `speed` is read through a ref so changing it never re-baselines the pair.
  }, [attachmentKey, syncTime, displayTime, videoRefA, videoRefB])

  return { isPlaying, currentTime, duration, waitingSide, toggle, pause, seekTo, stepFrame, setSpeed }
}
