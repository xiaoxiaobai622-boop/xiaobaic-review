export const SYNC_CATCH_UP_RATIO = 0.04
export const SYNC_HARD_REALIGN_SECONDS = 1
const TIME_EPSILON_SECONDS = 1e-6
const CATCH_UP_STEPS = 1000

export interface SyncInput {
  /** Media time of the frame the master actually presented. */
  masterTime: number
  slaveTime: number
  fps: number
  /** User-selected playback speed, before any catch-up adjustment. */
  speed: number
  /** The slave already has decodable data at the target frame. */
  slaveReady: boolean
  /** A seek is in flight on either element. */
  seeking: boolean
  slaveDuration?: number | null
}

export type SyncState = 'locked' | 'catch-up' | 'realign' | 'buffering' | 'seeking'

export interface SyncDecision {
  frame: number
  targetTime: number
  drift: number
  /** Freeze the pair: the slave cannot show the target frame yet. */
  hold: boolean
  realign: boolean
  /** Playback rate the slave should use, or null to leave it untouched. */
  slaveRate: number | null
  state: SyncState
}

/** Time of the frame-grid point the master time falls on. */
export function frameTargetTime(masterTime: number, fps: number): number {
  return Math.round(masterTime * fps) / fps
}

export function computeSyncDecision(input: SyncInput): SyncDecision {
  const { masterTime, slaveTime, fps, speed, slaveReady, seeking } = input

  const frame = Math.round(masterTime * fps)
  const duration = typeof input.slaveDuration === 'number'
    && Number.isFinite(input.slaveDuration)
    && input.slaveDuration > 0
    ? input.slaveDuration
    : null
  // A re-encode can be a frame shorter than the master. Targeting past the
  // slave's end would park it on an `ended` element that never recovers.
  const targetTime = Math.min(frameTargetTime(masterTime, fps), duration ?? Infinity)
  const drift = slaveTime - targetTime
  const magnitude = Math.abs(drift)

  const shared = { frame, targetTime, drift }

  if (seeking) {
    return { ...shared, hold: false, realign: false, slaveRate: null, state: 'seeking' }
  }
  // No media at the target frame: freezing is the only answer. Seeking into the
  // hole would restart the loader and make the stall longer.
  if (!slaveReady) {
    return { ...shared, hold: true, realign: false, slaveRate: null, state: 'buffering' }
  }
  if (magnitude > SYNC_HARD_REALIGN_SECONDS) {
    return { ...shared, hold: false, realign: true, slaveRate: speed, state: 'realign' }
  }
  if (magnitude <= 1 / fps / 2 + TIME_EPSILON_SECONDS) {
    // A time that is exactly half a frame from the grid rounds to either side,
    // so the tolerance must survive binary rounding or the rate flips every tick.
    return { ...shared, hold: false, realign: false, slaveRate: speed, state: 'locked' }
  }
  const rate = speed * (1 + Math.sign(-drift) * SYNC_CATCH_UP_RATIO)
  return {
    ...shared,
    hold: false,
    realign: false,
    slaveRate: Math.round(rate * CATCH_UP_STEPS) / CATCH_UP_STEPS,
    state: 'catch-up',
  }
}
