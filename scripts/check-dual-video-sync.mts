import {
  computeSyncDecision,
  frameTargetTime,
  type SyncDecision,
  type SyncInput,
} from '../src/lib/dual-video-sync'
import {
  getFiniteDuration,
  isTimeBuffered,
  type BufferMediaSource,
} from '../src/lib/media-buffer'

const FPS = 25
const FRAME = 1 / FPS

let passed = 0
const failures: string[] = []

function expect(name: string, actual: unknown, want: unknown) {
  const ok = typeof want === 'number' && typeof actual === 'number'
    ? Math.abs(actual - want) < 1e-9
    : actual === want
  if (ok) passed += 1
  else failures.push(`${name}\n      expected ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`)
}

function decide(overrides: Partial<SyncInput> = {}): SyncInput {
  return {
    masterTime: 4,
    slaveTime: 4,
    fps: FPS,
    speed: 1,
    slaveReady: true,
    seeking: false,
    ...overrides,
  }
}

function check(name: string, actual: SyncDecision | Error, expected: Partial<SyncDecision>) {
  if (actual instanceof Error) {
    failures.push(`${name}\n      threw: ${actual.message}`)
    return
  }
  const problems: string[] = []
  for (const [key, want] of Object.entries(expected)) {
    const got = actual[key as keyof SyncDecision]
    const ok = typeof want === 'number' && typeof got === 'number'
      ? Math.abs(got - want) < 1e-9
      : got === want
    if (!ok) problems.push(`${key}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`)
  }
  if (problems.length) failures.push(`${name}\n      ${problems.join('\n      ')}`)
  else passed += 1
}

// --- frame grid -------------------------------------------------------------
expect('帧栅格取点：4.02s@25fps 落在第 100 帧 = 4.000s',
  ask(() => frameTargetTime(4.02, FPS)), 100 / FPS)
expect('帧栅格取点：4.03s@25fps 落在第 101 帧 = 4.040s',
  ask(() => frameTargetTime(4.03, FPS)), 101 / FPS)
expect('帧栅格取点：0s 落在第 0 帧', ask(() => frameTargetTime(0, FPS)), 0)

check('主时钟 4.000s 落在第 100 帧，从机目标也是 4.000s',
  safe(decide({ masterTime: 4, slaveTime: 4 })),
  { frame: 100, targetTime: 4, drift: 0 })

check('主时钟 4.03s 已呈现，帧号取整为 101',
  safe(decide({ masterTime: 4.03, slaveTime: 4.04 })),
  { frame: 101, targetTime: 101 * FRAME, drift: 0 })

// --- tolerance --------------------------------------------------------------
check('落后 10ms（小于半帧）不动',
  safe(decide({ slaveTime: 4 - 0.01 })),
  { state: 'locked', hold: false, realign: false, slaveRate: 1 })

check('落后 19ms（仍在半帧容差内）不动',
  safe(decide({ slaveTime: 4 - 0.019 })),
  { state: 'locked', slaveRate: 1 })

check('落后 30ms（超过半帧）开始平滑追帧',
  safe(decide({ slaveTime: 4 - 0.03 })),
  { state: 'catch-up', slaveRate: 1.04 })

check('锁定状态下把倍速写回用户倍速',
  safe(decide({ slaveTime: 4.005, speed: 1.5 })),
  { state: 'locked', slaveRate: 1.5 })

// --- catch-up ---------------------------------------------------------------
check('落后 0.10s → 从机倍速上调 4% 平滑追平',
  safe(decide({ slaveTime: 4 - 0.1 })),
  { state: 'catch-up', realign: false, hold: false, slaveRate: 1.04 })

check('超前 0.10s → 从机倍速下调 4%',
  safe(decide({ slaveTime: 4 + 0.1 })),
  { state: 'catch-up', slaveRate: 0.96 })

check('2x 播放时追平幅度跟着用户倍速缩放',
  safe(decide({ slaveTime: 4 - 0.1, speed: 2 })),
  { state: 'catch-up', slaveRate: 2.08 })

check('0.5x 播放时减速不会低于 0',
  safe(decide({ slaveTime: 4 + 0.1, speed: 0.5 })),
  { state: 'catch-up', slaveRate: 0.48 })

// --- hard realign -----------------------------------------------------------
check('落后超过 1s → 直接跳帧硬对齐一次',
  safe(decide({ slaveTime: 4 - 1.5 })),
  { state: 'realign', realign: true, hold: false, slaveRate: 1 })

check('恰好 1s 仍走平滑追平',
  safe(decide({ slaveTime: 4 - 1 })),
  { state: 'catch-up', realign: false })

// --- buffering gate ---------------------------------------------------------
check('从机没缓冲数据 → 整对定住，不跳帧也不改倍速',
  safe(decide({ slaveReady: false })),
  { state: 'buffering', hold: true, realign: false, slaveRate: null })

check('缓冲缺口优先于漂移：先定住再谈追帧',
  safe(decide({ slaveReady: false, slaveTime: 2.5 })),
  { state: 'buffering', hold: true, realign: false, slaveRate: null })

// --- seek in flight ---------------------------------------------------------
check('seek 进行中什么都不做，免得跟元素抢',
  safe(decide({ seeking: true, slaveReady: false, slaveTime: 1 })),
  { state: 'seeking', hold: false, realign: false, slaveRate: null })

// --- duration clamp ---------------------------------------------------------
check('从机时长更短：目标帧夹到自己的结尾',
  safe(decide({ masterTime: 4.03, slaveTime: 4, slaveDuration: 4 })),
  { frame: 101, targetTime: 4, state: 'locked', slaveRate: 1 })

check('时长未知（Infinity）不夹',
  safe(decide({ masterTime: 4.03, slaveTime: 4.04, slaveDuration: Infinity })),
  { targetTime: 101 * FRAME })

function safe(input: SyncInput): SyncDecision | Error {
  try {
    return computeSyncDecision(input)
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }
}

// --- buffered-range source (used by the sync gate) --------------------------
expect('区间正中算已缓冲', ask(() => isTimeBuffered(media(60, [0, 10]), 5)), true)
expect('区间末端 0.15s 留尾内不算，免得卡在片段边界等一个永远不会来的字节',
  ask(() => isTimeBuffered(media(60, [0, 10]), 9.95)), false)
expect('两个区间的空隙不算', ask(() => isTimeBuffered(media(60, [0, 10], [12, 20]), 11)), false)
expect('落在第二个区间算', ask(() => isTimeBuffered(media(60, [0, 10], [12, 20]), 15)), true)
expect('时长结尾那一点放行', ask(() => isTimeBuffered(media(60, [0, 60]), 59.99)), true)
// 实测场景：流已经下完（缓冲尾到达片尾），但播放点还差 0.11 秒。
// 留尾容差本意是「后面还要取」，数据已经到底时不能再拦，否则两个版本永远停在结尾前。
expect('缓冲尾已到片尾时，结尾前 0.11 秒算已缓冲',
  ask(() => isTimeBuffered(media(12, [0, 11.997]), 11.887)), true)
expect('缓冲尾没到片尾时，尾部 0.15 秒仍不算',
  ask(() => isTimeBuffered(media(12, [0, 11.5]), 11.44)), false)
expect('时长未知时不存在“结尾”', ask(() => isTimeBuffered(media(Infinity, [0, 10]), 9.99)), false)
expect('极短尾部区间按 25% 留尾，中间仍算已缓冲',
  ask(() => isTimeBuffered(media(60, [10, 10.1]), 10.05)), true)
expect('极短尾部区间的最后 25% 仍不算',
  ask(() => isTimeBuffered(media(60, [10, 10.1]), 10.09)), false)
expect('没有缓冲区间不算', ask(() => isTimeBuffered(media(60), 5)), false)
expect('NaN 时间点不算已缓冲', ask(() => isTimeBuffered(media(60, [0, 10]), NaN)), false)
expect('负时间点不算已缓冲', ask(() => isTimeBuffered(media(60, [0, 10]), -1)), false)
expect('有限时长原样读出', ask(() => getFiniteDuration(media(30.5))), 30.5)
expect('Infinity 时长读成 null', ask(() => getFiniteDuration(media(Infinity))), null)
expect('NaN 时长读成 null', ask(() => getFiniteDuration(media(NaN))), null)

function ask<T>(fn: () => T): T | string {
  try {
    return fn()
  } catch (error) {
    return `threw: ${error instanceof Error ? error.message : String(error)}`
  }
}

function media(duration: number, ...rs: Array<[number, number]>): BufferMediaSource {
  return {
    duration,
    buffered: {
      length: rs.length,
      start: (index: number) => rs[index][0],
      end: (index: number) => rs[index][1],
    },
  }
}

console.log(printSummary())
process.exit(failures.length ? 1 : 0)

function printSummary() {
  if (!failures.length) return `OK  ${passed} 条断言全部通过`
  const body = failures.map((line, index) => `  ${index + 1}. ${line}`).join('\n')
  return `FAIL  ${failures.length} 条未通过 / ${passed + failures.length} 条\n${body}`
}
