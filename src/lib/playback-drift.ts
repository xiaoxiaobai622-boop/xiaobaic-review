export interface DriftVerdict {
  /** 这个 seek 目标是否已经作废（作废就该关圈、别再把时间码钉在目标上） */
  stale: boolean
  /** 下一次比对要用的漂移基线；null = 清掉基线 */
  driftTime: number | null
}

export interface DriftInput {
  targetTime: number
  playheadTime: number
  previousDriftTime: number | null
  paused: boolean
}

/** 播放头落进目标这个范围内，就算 seek 正在落地，不是"飘走了"。 */
const NEAR_TARGET_SECONDS = 0.5
/** 两次 timeupdate 之间至少前进这么多才算"画面真的在走"。 */
const PROGRESS_SECONDS = 0.05

function computeDrift(input: DriftInput): DriftVerdict {
  const { targetTime, playheadTime, previousDriftTime, paused } = input

  if (!Number.isFinite(targetTime) || !Number.isFinite(playheadTime)) {
    return { stale: false, driftTime: null }
  }
  if (paused) return { stale: false, driftTime: null }
  if (Math.abs(playheadTime - targetTime) <= NEAR_TARGET_SECONDS) {
    return { stale: false, driftTime: null }
  }
  if (previousDriftTime === null || !Number.isFinite(previousDriftTime)) {
    return { stale: false, driftTime: playheadTime }
  }
  // 减出来的差比 `>=` 比较稳：12 + 0.05 在二进制浮点里是 12.050000000000001，
  // 直接比会让"恰好等于阈值"这一档永远判不出来。
  if (playheadTime - previousDriftTime >= PROGRESS_SECONDS - 1e-9) {
    return { stale: true, driftTime: null }
  }
  // 没动或往回飘都只刷新基线：停在目标外等分片时，圈必须继续转。
  return { stale: false, driftTime: playheadTime }
}

export const judgeSeekDrift = Object.assign(computeDrift, {
  NEAR_TARGET_SECONDS,
  PROGRESS_SECONDS,
})
