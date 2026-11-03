import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pickQuickPreviewSource } from '../src/lib/video-playback'

const failures: string[] = []
function check(ok: boolean, label: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`)
  if (!ok) failures.push(label)
}

check(
  pickQuickPreviewSource({ status: 'READY', preview720Path: 'p/720.mp4' }) === 'progressive',
  '有 720p 渐进流时走渐进预览',
)
check(
  pickQuickPreviewSource({ status: 'READY', preview1080Path: 'p/1080.mp4', hlsPath: 'p/master.m3u8' }) === 'progressive',
  '同时有渐进流与 HLS 时继续走 720p，保持原行为',
)
check(
  pickQuickPreviewSource({ status: 'READY', hlsPath: 'p/master.m3u8', originalStoragePath: 'o/source.mp4' }) === 'hls',
  'HLS-only（即使保留原片）必须走 HLS 预览',
)
check(
  pickQuickPreviewSource({ status: 'READY', preview720Path: null, hlsPath: 'p/master.m3u8' }) === 'hls',
  '没有渐进预览但有 HLS 时走 HLS',
)
check(
  pickQuickPreviewSource({ status: 'READY', originalStoragePath: 'o/source.mp4' }) === 'progressive',
  '无 HLS 且原片可播时仍走渐进预览',
)
check(
  pickQuickPreviewSource({ status: 'READY' }) === 'unavailable',
  '既无渐进流也无 HLS 时标记不可预览',
)
check(pickQuickPreviewSource(null) === 'unavailable', '没有视频时标记不可预览')

const managerSource = readFileSync(resolve('src/components/AdminVideoManager.tsx'), 'utf8')
check(managerSource.includes('pickQuickPreviewSource(latest)'), '后台卡片预览必须使用共享的源判定')
check(managerSource.includes("source === 'hls' ? 'hls' : '720p'"), '预览按源类型选择 hls 或 720p 令牌')
check(managerSource.includes("useHlsSource({"), '后台快速预览必须接 HLS 播放器')

if (failures.length > 0) {
  console.error(`\n快速预览源判定 ${failures.length} 项不满足`)
  process.exit(1)
}
console.log('\n快速预览源判定 10 项全部通过')
