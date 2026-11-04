import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { hasProgressivePlayback } from '../src/lib/video-playback'

/**
 * 播放失败的分类契约。
 *
 * 旧行为：<video> 只给 MediaError 3/4，token 过期的 403 被当成「格式不支持」
 * 或「网络失败」，既不重签也不保留原因；/api/content 的花式拒绝只有一部分带
 * CORS，hls.js 只能看到 status 0。这里钉住三件事：
 *   1. 失败必须探测真实 HTTP 状态，401/403 归 auth，其它 4xx/5xx 归 unavailable；
 *   2. 只有真正取不到状态时才允许落到 network，且渐进源要有退避重试；
 *   3. /api/content 的每条拒绝都带 CORS + no-store。
 */
const hook = readFileSync(resolve('src/hooks/useHlsSource.ts'), 'utf8')
const player = readFileSync(resolve('src/components/VideoPlayer.tsx'), 'utf8')
const contentRoute = readFileSync(resolve('src/app/api/content/[token]/route.ts'), 'utf8')
const videoAccess = readFileSync(resolve('src/lib/video-access.ts'), 'utf8')
const telemetryRoute = readFileSync(resolve('src/app/api/playback/failure/route.ts'), 'utf8')
const telemetryClient = readFileSync(resolve('src/lib/playback-telemetry.ts'), 'utf8')
const shareApi = readFileSync(resolve('src/app/api/share/[token]/route.ts'), 'utf8')
const projectApi = readFileSync(resolve('src/app/api/projects/[id]/route.ts'), 'utf8')
const shareTokenRoute = readFileSync(resolve('src/app/api/share/[token]/video-token/route.ts'), 'utf8')
const studioTokenRoute = readFileSync(resolve('src/app/api/studio/video-token/route.ts'), 'utf8')
const sharePage = readFileSync(resolve('src/app/share/[teamSlug]/SharePageClient.tsx'), 'utf8')
const studioPage = readFileSync(resolve('src/app/studio/projects/[id]/page.tsx'), 'utf8')
const reportScript = readFileSync(resolve('scripts/playback-failure-report.mts'), 'utf8')
const workflow = readFileSync(resolve('.github/workflows/playback-failure-report.yml'), 'utf8')
const dockerfile = readFileSync(resolve('Dockerfile'), 'utf8')
const packageJson = readFileSync(resolve('package.json'), 'utf8')

const failures: string[] = []
function check(ok: boolean, label: string, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` → ${detail}` : ''}`)
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

check(
  hook.includes("if (httpStatus === 401 || httpStatus === 403) return 'auth'") &&
    hook.includes("if (httpStatus === 415) return 'unsupported'") &&
    hook.includes("if (httpStatus !== undefined && httpStatus >= 400) return 'unavailable'") &&
    hook.includes("if (mediaErrorCode === 3) return 'decode'") &&
    hook.includes("if (mediaErrorCode === 4) return 'unsupported'") &&
    hook.includes("return 'network'"),
  'P1 分类顺序：401/403→auth，415→unsupported，其它 HTTP 错误→unavailable，仅无状态才落到 network',
)

check(
  hook.includes('const probePlaybackStatus = async') &&
    hook.includes('await probePlaybackStatus(fallbackUrl)') &&
    hook.includes('probePlaybackStatus(currentHlsUrl).then'),
  'P2 渐进源与原生 HLS 失败时都探测真实 HTTP 状态',
)

check(
  hook.includes('FALLBACK_NETWORK_RETRY_DELAYS_MS') &&
    hook.includes('fallbackNetworkAttempts') &&
    hook.includes("listenToVideo('playing'") &&
    hook.includes('fallbackNetworkAttempts = 0') &&
    hook.includes("addEventListener('online'"),
  'P3 渐进源网络失败有退避重试，播起来/恢复联网后重置',
)

check(
  player.includes("info.cause === 'unsupported' && info.httpStatus === undefined") &&
    !player.includes("info.cause === 'network' && videoCrossOrigin"),
  'P4 只有「无可读状态 + code 4」才去掉 crossOrigin，不再把真实网络失败重载成 code 4',
)

check(
  player.includes('attempts < 3') &&
    player.includes('streamAuthRetryRef.current = null') &&
    player.includes('recoverySeekRef.current') &&
    player.includes('sourceGenerationRef.current'),
  'P5 鉴权恢复有 3 次预算、成功后重置，并保留失败位置/防止同 URL 空转',
)

check(
  player.includes("auth: '播放授权已过期，请刷新页面重新打开。'") &&
    player.includes("unavailable: '视频暂时不可用，请稍后重试。'") &&
    player.includes("network: '视频加载失败，请刷新页面或检查网络后重试。'"),
  'P6 auth/network/unavailable 文案与 cause 一一对应',
)

const getBody = contentRoute.slice(contentRoute.indexOf('export async function GET'))
check(
  !getBody.includes('NextResponse.json(') &&
    contentRoute.includes("'Access-Control-Allow-Origin': '*'") &&
    contentRoute.includes("'Cache-Control': 'no-store'") &&
    contentRoute.includes('contentEmpty(416'),
  'P7 /api/content 的所有拒绝/错误响应走 contentRefusal/contentEmpty（CORS + no-store）',
)

check(
  videoAccess.includes('permissionsFingerprint(tokenData.permissions)') &&
    videoAccess.includes('video_token_cache:${tokenData.sessionId}:${tokenData.videoId}:${tokenData.quality}:${permissionsFingerprint'),
  'P8 令牌续期使用的缓存 key 与签发时一致（含权限指纹）',
)

check(
  telemetryRoute.includes('PLAYBACK_FAILURE_CAUSES') &&
    telemetryRoute.includes('playback_failure:hour:') &&
    telemetryRoute.includes('[PLAYBACK_FAILURE]') &&
    telemetryClient.includes("navigator.sendBeacon('/api/playback/failure'"),
  'P9 失败事件有 cause/httpStatus/video/project 计数与结构化日志',
)

const sourceQualityFallback = player.slice(
  player.indexOf('if (sourceQualityActive)'),
  player.indexOf('const fail = '),
)
check(
  sourceQualityFallback.includes('setSourceQualityMode(false)') &&
    sourceQualityFallback.includes("t('sourceQualityFallback')") &&
    sourceQualityFallback.includes('pendingSeekRef.current = { time, resume: wasPlaying }') &&
    sourceQualityFallback.includes('sourceQuality: true'),
  'P10 源画质失败回退预览、保留位置并给出专属提示（不落到通用网络文案）',
)

const fallbackCopy = ['zh', 'en', 'de', 'nl'].map((locale) => {
  const messages = JSON.parse(readFileSync(resolve(`src/locales/${locale}.json`), 'utf8'))
  return String(messages?.videos?.sourceQualityFallback || '')
})
check(
  fallbackCopy.every((copy) => /源画质|source quality|quellqualität|bronkwaliteit/i.test(copy)),
  'P11 四语都把源画质失败说成「暂不可用/回退预览」',
)

const hlsAuthBlock = hook.slice(
  hook.indexOf("status === 401 || status === 403"),
  hook.indexOf('if (networkRecoveryAttempts < 5)'),
)
check(
  hlsAuthBlock.includes("cause: 'auth'") &&
    hlsAuthBlock.includes('terminalFailureReported') &&
    !hlsAuthBlock.includes('activateFallback()'),
  'P12 hls.js 401/403 交给播放器重签，不在 hook 内静默降级',
)

check(
  hook.includes('UNAVAILABLE_PROBE_DELAYS_MS') &&
    hook.includes('startUnavailableRecovery') &&
    hook.includes("response.headers.get('retry-after')") &&
    hook.includes("cause: 'unavailable'"),
  'P13 503/5xx 有界探测/重试并读取 Retry-After，恢复后清遮罩',
)

check(
  shareTokenRoute.includes("url.searchParams.get('force')") &&
    shareTokenRoute.includes('skipCacheCheck: quality === \'source\' || force') &&
    studioTokenRoute.includes('quality !== \'source\' && !force') &&
    sharePage.includes('forceParam') &&
    sharePage.includes('fetchTokensForVideos([video], 1, undefined, true)') &&
    studioPage.includes("query.set('force', '1')"),
  'P14 鉴权恢复强制 mint 新 token，服务端缓存不会把旧 token 还回来',
)

check(
  telemetryRoute.includes('fallback') &&
    telemetryRoute.includes('video_failed') &&
    player.includes('onPlaybackRecovered') &&
    reportScript.includes('video-threshold') &&
    reportScript.includes('fallback') &&
    reportScript.includes("parts[1] === 'video_failed'") &&
    reportScript.includes('wantedBuckets.has(parts[3])'),
  'P15 可恢复 network/HLS fallback 上报 recovered，并按视频失败计数/阈值',
)

check(
  packageJson.includes('"playback:failure-report"') &&
    workflow.includes("cron: '17 * * * *'") &&
    workflow.includes('playback-failure-report.mts') &&
    dockerfile.includes('playback-failure-report.mts'),
  'P16 告警有 package script、定时 workflow 和运行镜像内的脚本',
)

check(
  hasProgressivePlayback({ hlsPath: 'h', status: 'READY', originalStoragePath: 'o' }) === false &&
    hasProgressivePlayback({ hlsPath: 'h', status: 'READY', preview720Path: 'p' }) === true &&
    hasProgressivePlayback({ hlsPath: null, status: 'READY', originalStoragePath: 'o' }) === true &&
    hasProgressivePlayback({ hlsPath: null, status: 'READY' }) === false,
  'P17 HLS-only + original 不算渐进源；有预览或纯 original 才算',
)

check(
  shareApi.includes('hasProgressivePlayback(video as any)') &&
    projectApi.includes('hasProgressivePlayback: hasProgressivePlayback(video)') &&
    studioPage.includes('hasProgressivePlayback(video)') &&
    !studioPage.includes("const progressive = await mintReviewToken(video.id, '720p')") &&
    contentRoute.includes('PROGRESSIVE_RENDITION_UNAVAILABLE') &&
    hook.includes("if (httpStatus === 415) return 'unsupported'") &&
    player.includes('或下载原片查看'),
  'P18 studio/share 不再给 HLS-only 铸 720p；缺 rendition 返回 415/unsupported + 下载出口',
)

check(
  hook.includes('HLS_ONLY_RECOVERY_DELAYS_MS') &&
    hook.includes('scheduleHlsOnlyRecovery') &&
    hook.includes('withRecoveryNonce') &&
    hook.includes('lastFailureInfo') &&
    hook.includes('onPlaybackErrorRef.current?.(failureInfo)') &&
    hook.includes('hlsErrorDetails') &&
    hook.includes('onPlaybackRecovering'),
  'P19 HLS-only 终结失败保留真实 cause/状态，并有界重取新清单后仍在无回退时如实上报',
)

check(
  player.includes('reconnectingSource') &&
    player.includes('onPlaybackRecovering') &&
    player.includes("info.hlsErrorType ? 'hls' : resolvedPlaybackQuality") &&
    telemetryRoute.includes('hlsErrorDetails') &&
    reportScript.includes('cause-threshold') &&
    reportScript.includes('causeTotals') &&
    workflow.includes('--failed-threshold=6') &&
    workflow.includes('--video-threshold=6') &&
    workflow.includes('--cause-threshold=6'),
  'P20 静默重连有可见提示；告警阈值高于 4/h 自动化且低于 8/h 事故，日志带 hls 细节',
)

check(
  telemetryRoute.includes('quality:${quality}') &&
    telemetryRoute.includes('source_quality:') &&
    reportScript.includes('source_quality') &&
    reportScript.includes('allQualities') &&
    reportScript.includes('sourceQuality') &&
    reportScript.includes("args.get('buckets')") &&
    reportScript.includes('explicitBuckets'),
  'P21 报告按小时统计并输出 quality 与 sourceQuality，支持指定 bucket 复核',
)

const mediaErrorBranch = hook.slice(
  hook.indexOf('const handleMediaElementError'),
  hook.indexOf("} else if (sourceType === 'fallback')"),
)
const beforeHlsBranch = mediaErrorBranch.slice(0, mediaErrorBranch.indexOf("if (sourceType === 'hls')"))
check(
  hook.includes('hlsErrorType?: string') &&
    hook.includes('hlsErrorType: lastFailureInfo?.hlsErrorType') &&
    player.includes("recovery.hlsErrorType ? 'hls'") &&
    mediaErrorBranch.includes("hlsErrorType: 'mediaElement'") &&
    !beforeHlsBranch.includes("hlsErrorType: 'mediaElement'"),
  'P22 recovered 事件保留 hlsErrorType 并标 quality=hls；渐进回退失败不继承 HLS 标签',
)

check(
  workflow.includes('--cursor') &&
    workflow.includes('--hours=24') &&
    reportScript.includes("args.get('cursor')") &&
    reportScript.includes('last_evaluated_bucket') &&
    reportScript.includes('shiftBucket') &&
    reportScript.includes('now-bucket') &&
    reportScript.includes('failedVideoMaxPerBucket') &&
    reportScript.includes('cursor advanced'),
  'P23 定时报告用游标覆盖上次评估以来的完整小时；旧 bucket 不重复告警；宽窗口按单小时最大视频失败数判阈值',
)

if (failures.length > 0) {
  console.error(`\n播放失败分类契约 ${failures.length} 项不满足：`)
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}

console.log('\n播放失败分类契约 23 项全部通过')
