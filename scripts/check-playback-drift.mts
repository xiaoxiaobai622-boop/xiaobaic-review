import {
  judgeSeekDrift,
  type DriftVerdict,
} from '../src/lib/playback-drift'

/**
 * 审片页转圈不消失的判据。
 *
 * 现场事实（读 src/components/VideoPlayer.tsx:1040-1066 得来）：
 * `handleTimeUpdate` 只要还挂着 pendingSeek、且播放头离目标超过 0.5s，就整个 `return`。
 * 于是"画面在往前走"这个唯一能证明没在缓冲的证据被丢掉，而 `playing` 已经发过、
 * `seeked`/`canplay` 不再会来 ⇒ 圈圈永久钉住，视频却照常播。
 *
 * 这里判的是抽出来的纯函数：什么算"越飘越远"（该把这个 seek 判过期、关圈），
 * 什么不算（刚跳过去、正停在目标附近等数据——那必须继续显示圈）。
 */

let passed = 0
const failures: string[] = []

function check(name: string, got: DriftVerdict, want: Partial<DriftVerdict>, note = '') {
  const problems: string[] = []
  for (const [key, expected] of Object.entries(want)) {
    const actual = got[key as keyof DriftVerdict]
    if (actual !== expected) problems.push(`${key} 期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
  }
  if (problems.length) failures.push(`${name}\n      ${problems.join('\n      ')}${note ? `\n      ${note}` : ''}`)
  else passed += 1
}

console.log('=== seek 目标已过期：播放头连着两次自己往前走 ===')

// 第一次飘在目标外：只记基线，不能立刻判过期——可能正停在目标附近等首个分片。
check('D1 第一次落在目标外 ⇒ 只记基线，不判过期（这时该继续转圈）',
  judgeSeekDrift({ targetTime: 40, playheadTime: 12, previousDriftTime: null, paused: false }),
  { stale: false, driftTime: 12 })

// 第二次仍在往前走 ⇒ 元素根本没在等数据，这个 seek 目标已经作废。
check('D2 连着两次往前走 ⇒ 判过期（这就是"画面在播、圈还转着"那一条）',
  judgeSeekDrift({ targetTime: 40, playheadTime: 12.25, previousDriftTime: 12, paused: false }),
  { stale: true, driftTime: null })

// 倍速下步进更大，同样要判过期。
check('D3 4 倍速下飘了 1 秒 ⇒ 判过期',
  judgeSeekDrift({ targetTime: 40, playheadTime: 13, previousDriftTime: 12, paused: false }),
  { stale: true, driftTime: null })

console.log('=== 真在等数据：不许关圈 ===')

// 播放头没动（停在目标附近等分片）⇒ 保留基线，继续转圈。
check('D4 播放头纹丝不动 ⇒ 不判过期，刷新基线继续等',
  judgeSeekDrift({ targetTime: 40, playheadTime: 12, previousDriftTime: 12, paused: false }),
  { stale: false, driftTime: 12 })

// 抖动（回退几帧、倒着飘）不算往前走，别误判成"在播"。
check('D5 播放头往回飘 ⇒ 不判过期（倒退不是恢复播放的证据）',
  judgeSeekDrift({ targetTime: 40, playheadTime: 11.5, previousDriftTime: 12, paused: false }),
  { stale: false, driftTime: 11.5 })

// 落在目标附近：这是 seek 正在落地，不是"飘走了"。
check('D6 播放头落进目标 ±0.5s ⇒ 不判过期，并清掉漂移基线',
  judgeSeekDrift({ targetTime: 40, playheadTime: 40.2, previousDriftTime: 12, paused: false }),
  { stale: false, driftTime: null })

// 暂停时不判：用户可能就是停在别处，不代表 seek 作废。
check('D7 暂停中 ⇒ 一律不判过期（没有"画面在走"这回事）',
  judgeSeekDrift({ targetTime: 40, playheadTime: 99, previousDriftTime: 12, paused: true }),
  { stale: false, driftTime: null })

console.log('=== 边界：不许把噪声当前进 ===')

check('D8 只前进 1 毫秒（抖动量级）⇒ 不算往前走',
  judgeSeekDrift({ targetTime: 40, playheadTime: 12.001, previousDriftTime: 12, paused: false }),
  { stale: false, driftTime: 12.001 })

check('D9 恰好等于最小前进量 ⇒ 算往前走（阈值本身要钉住，别悄悄漂）',
  judgeSeekDrift({ targetTime: 40, playheadTime: 12.05, previousDriftTime: 12, paused: false }),
  { stale: true, driftTime: null })

check('D10 目标在末尾、播放头已越过目标 ⇒ 落点判据按绝对差，不判过期',
  judgeSeekDrift({ targetTime: 40, playheadTime: 40.5, previousDriftTime: 12, paused: false }),
  { stale: false, driftTime: null })

console.log('=== 非有限值：不许把 NaN 当证据 ===')

check('D11 播放头是 NaN ⇒ 不判过期、也不记基线（否则基线被污染，后面永远比不出来）',
  judgeSeekDrift({ targetTime: 40, playheadTime: Number.NaN, previousDriftTime: 12, paused: false }),
  { stale: false, driftTime: null })

check('D12 目标是 Infinity ⇒ 不判过期、不记基线',
  judgeSeekDrift({ targetTime: Number.POSITIVE_INFINITY, playheadTime: 12, previousDriftTime: null, paused: false }),
  { stale: false, driftTime: null })

console.log('=== 钉住阈值常量（改了要连判据一起改，别让它悄悄漂）===')
check('D13 落点容差 = 0.5s、最小前进量 = 0.05s（和 VideoPlayer 里那两处 0.5 / 0.05 同源）',
  { stale: false, driftTime: null, nearTargetSeconds: judgeSeekDrift.NEAR_TARGET_SECONDS, progressSeconds: judgeSeekDrift.PROGRESS_SECONDS } as unknown as DriftVerdict,
  { nearTargetSeconds: 0.5, progressSeconds: 0.05 } as unknown as Partial<DriftVerdict>)

console.log(`\n合计 ${passed} PASS / ${failures.length} FAIL`)
for (const f of failures) console.log(`  FAIL  ${f}`)
process.exit(failures.length === 0 ? 0 : 1)
