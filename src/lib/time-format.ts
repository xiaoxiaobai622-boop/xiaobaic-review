import { formatClockTime, formatTimecodeDisplay, secondsToTimecode, timecodeToSeconds } from './timecode'

/**
 * 播放器那一串时间怎么画：帧、标准（分:秒）、时间码（时:分:秒:帧）。
 *
 * 这一档从 10-19 起归**看的人**：本机选过就跟着，没选过就是标准。以前它由 `Project.timestampDisplay`
 * 决定，而那列 `NOT NULL DEFAULT 'TIMECODE'`、项目级控件 10-03 就被删了 ⇒ 等于所有人一进来都是时间码，
 * 谁也没配过。默认档他点的名是标准。
 *
 * 三档的口径以前散在四个组件里各抄一份（其中播放器那份额过的 `formatTime` 在 60 分钟以上会画成
 * `61:40`），这里收成唯一一份。
 */
export type TimeFormat = 'FRAMES' | 'STANDARD' | 'TIMECODE'

/** 菜单里的顺序，也是判据钉住的顺序。 */
export const TIME_FORMATS: readonly TimeFormat[] = ['FRAMES', 'STANDARD', 'TIMECODE']

export const DEFAULT_TIME_FORMAT: TimeFormat = 'STANDARD'

/** 键名一改，所有人本机选过的档就丢了。 */
export const TIME_FORMAT_STORAGE_KEY = 'time_format'

/** 同一页面里多处渲染时间，靠这一枚事件同步（另一台标签页由 `storage` 事件接住）。 */
export const TIME_FORMAT_EVENT = 'vidx:time-format'

/** 取不到 fps 时的兜底，和评论、邮件、深链那几处同口径（`lib/timecode.ts`、`lib/email.ts`）。 */
const FALLBACK_FPS = 24

export function isTimeFormat(value: unknown): value is TimeFormat {
  return typeof value === 'string' && (TIME_FORMATS as readonly string[]).includes(value)
}

/** 认不出的存值（旧数据、手改过 localStorage）一律回落默认，不许把脏值画到界面上。 */
export function normalizeStoredTimeFormat(raw: string | null): TimeFormat {
  return isTimeFormat(raw) ? raw : DEFAULT_TIME_FORMAT
}

function safeFps(fps: number | null | undefined): number {
  return typeof fps === 'number' && Number.isFinite(fps) && fps > 0 ? fps : FALLBACK_FPS
}

function safeSeconds(seconds: number | null | undefined): number {
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds : 0
}

/**
 * 秒 → 界面上那一串。`durationSeconds` 只替「标准」档决定要不要带时：整条片子超过一小时时，
 * 当前读数和总时长读数同宽度，不许一边 `03:07` 一边 `1:02:03`。取不到时长就按秒数自己判。
 */
export function formatTimeDisplay(
  seconds: number | null | undefined,
  fps: number | null | undefined,
  durationSeconds: number | null | undefined,
  format: TimeFormat,
): string {
  const rate = safeFps(fps)
  const at = safeSeconds(seconds)

  if (format === 'FRAMES') return String(Math.floor(at * rate + 1e-6))
  if (format === 'TIMECODE') return formatTimecodeDisplay(secondsToTimecode(at, rate))

  const duration = safeSeconds(durationSeconds) || at
  return formatClockTime(at, duration >= 3600)
}

/**
 * 库里存的批注落点是时间码串，按同一档画出来。时间码档原样显示那一串——来回换算会把丢帧计时
 * （29.97/59.94 的 `;`）跳掉的那两帧算回来，显示就变了。读不动的脏串画零。
 */
export function formatTimecodeAs(
  timecode: string | null | undefined,
  fps: number | null | undefined,
  durationSeconds: number | null | undefined,
  format: TimeFormat,
): string {
  if (format === 'TIMECODE') return timecode ? formatTimecodeDisplay(timecode) : '00:00:00:00'

  const rate = safeFps(fps)
  let seconds = 0
  try {
    seconds = timecodeToSeconds(String(timecode ?? ''), rate)
  } catch {
    seconds = 0
  }
  return formatTimeDisplay(seconds, rate, durationSeconds, format)
}
