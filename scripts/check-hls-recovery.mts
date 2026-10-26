import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 审片播放器的 HLS 恢复契约。
 *
 * 线上事故（10-26）：一个 HLS 分片的短暂失败会先让 <video> 报 DEMUXER 错误，
 * 旧逻辑在媒体元素 error 上直接 activateFallback()。原生 HLS 没有 hls.js 的
 * 重试层，HLS-only 视频又没有渐进流，于是「网络错误」只能靠整页刷新恢复。
 *
 * 这里钉的是行为的前置结构：media error 必须先走缓冲恢复 / 重建 HLS / 原生 HLS
 * 重载，只有重试预算耗尽才允许降级或报错。真正的播放行为另由浏览器实测验证
 * （本地夹具见 check-player-spinner.mts；线上用分享页屏蔽 2 个分片复测）。
 */
const source = readFileSync(resolve('src/hooks/useHlsSource.ts'), 'utf8')
const failures: string[] = []

function check(ok: boolean, label: string, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` → ${detail}` : ''}`)
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

function between(start: string, end: string) {
  const from = source.indexOf(start)
  if (from < 0) return ''
  const to = source.indexOf(end, from + start.length)
  return to < 0 ? source.slice(from) : source.slice(from, to)
}

const mediaErrorHandler = between('const handleMediaElementError = () => {', "listenToVideo('error'")
const hlsFatalHandler = between('hls.on(Events.ERROR', 'hls.attachMedia(media)')
const fragLoadedHandler = between('hls.on(Events.FRAG_LOADED', 'hls.on(Events.ERROR')
const playingListener = source.match(/listenToVideo\('playing'[^\n]*/)?.[0] ?? ''

check(
  Boolean(mediaErrorHandler) && mediaErrorHandler.includes('restartHls()') && !mediaErrorHandler.includes('activateFallback()'),
  'H1 媒体元素报错时，HLS 会话先重建而不是直接降级',
  mediaErrorHandler
    ? mediaErrorHandler.includes('activateFallback()') ? '仍有直接 activateFallback' : '未发现直接降级'
    : '找不到 handleMediaElementError',
)
check(
  Boolean(mediaErrorHandler) && mediaErrorHandler.includes('restartNativeHls()'),
  'H2 原生 HLS 分支也有独立重载路径（不再一次错误就报网络错误）',
)
check(
  source.includes('const restartHls = () =>') &&
    source.includes('sourceRestartAttempts >= 2') &&
    source.includes('if (restartTimer !== null) return'),
  'H3 hls.js 重建有 2 次预算，且同一故障只排一次重建（不会把预算瞬间耗光）',
)
check(
  source.includes('const restartNativeHls = () =>') &&
    source.includes('nativeRestartAttempts >= 2') &&
    source.includes('if (disposed || !media || !hlsUrl || nativeRestartTimer !== null) return') &&
    source.includes("setVideoSource(hlsUrl, 'hls')") &&
    source.includes('pendingSeekPosition = Math.max(0, media.currentTime)'),
  'H4 原生 HLS 重载保留播放位置，且不会并发排多次重载',
)
check(
  Boolean(fragLoadedHandler) &&
    fragLoadedHandler.includes('sourceRestartAttempts = 0') &&
    fragLoadedHandler.includes('mediaRecoveryAttempts = 0'),
  'H5 成功取到分片后重置重试预算（恢复后不会一直背着旧失败）',
)
check(
  Boolean(playingListener) && playingListener.includes('nativeRestartAttempts = 0'),
  'H6 真正播起来后重置原生 HLS 预算',
  playingListener || '找不到 playing 监听',
)
check(
  hlsFatalHandler.includes('restartHls()') &&
    (hlsFatalHandler.match(/activateFallback\(\)/g) ?? []).length === 1,
  'H7 hls.js 致命错误先重建；只有 401/403 才立即降级',
  `activateFallback 次数=${(hlsFatalHandler.match(/activateFallback\(\)/g) ?? []).length}`,
)
check(
  source.includes('if (restartTimer !== null) clearTimeout(restartTimer)') &&
    source.includes('if (nativeRestartTimer !== null) clearTimeout(nativeRestartTimer)'),
  'H8 组件卸载时清掉两条重载定时器',
)

if (failures.length > 0) {
  console.error(`\nHLS 恢复契约 ${failures.length} 项不满足：`)
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}

console.log('\nHLS 恢复契约 8 项全部通过')
