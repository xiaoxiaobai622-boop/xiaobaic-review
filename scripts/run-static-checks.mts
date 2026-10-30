/**
 * 静态判据聚合器：把 `check:static` 从 `a && b && c` 换成"每支都跑完，再汇总退出码"。
 *
 * `&&` 的问题是掩盖：第一支红时后面 8 支根本不跑，于是"修掉第一支"会一次性揭出 2–3 支
 * 早就存在的红（10-17 那轮就这样被掩盖过一次）。判据的价值在于一次看全，不在于短路。
 *
 * 名单是显式的，不自动发现：`scripts/check-*` 里有会写库的（`check-phone-field` 建/删审计行），
 * 它们进 CI 就是往生产数据库里写数据——`check-drift-guards.mts` 的 D23 专门钉着这条。
 *
 * 跑法：npx tsx scripts/run-static-checks.mts
 *
 * 名单里没有 `check-billing-out-of-build.mts`：它要 GET 一个真在跑的服务（默认
 * `http://localhost:3000`），属上线后的验收判据，不是静态判据——塞进 CI 只会得到一条假红。
 */
import { spawnSync } from 'node:child_process'

const CHECKS: Array<{ file: string; args?: string[] }> = [
  { file: 'scripts/check-drift-guards.mts' },
  { file: 'scripts/check-branding-read-paths.mts' },
  { file: 'scripts/check-dual-video-sync.mts' },
  { file: 'scripts/check-team-writeable.mts' },
  { file: 'scripts/check-home-media-budget.mts' },
  { file: 'scripts/check-playback-drift.mts' },
  { file: 'scripts/check-hls-recovery.mts' },
  { file: 'scripts/check-time-format.mts' },
  { file: 'scripts/check-wechat-phone-bind.mts' },
  { file: 'scripts/check-zod-schemas.mts' },
  { file: 'scripts/check-review-login-surface.mts' },
  { file: 'scripts/check-share-scope.mts' },
  { file: 'scripts/check-comment-visibility.mts' },
  { file: 'scripts/check-share-video-scope.mts' },
  { file: 'scripts/check-share-renewal-rotation.mts' },
  { file: 'scripts/check-download-permissions.mts' },
  { file: 'scripts/check-invite-role.mts' },
  { file: 'scripts/check-review-deep-link.mts' },
  { file: 'scripts/check-team-numeric-id.mts', args: ['--static'] },
  { file: 'scripts/check-platform-team-identity.mts' },
]

const failed: string[] = []
for (const check of CHECKS) {
  // 与 package.json 原来的写法同一条命令路径（npm 会把 node_modules/.bin 放进 PATH）
  const result = spawnSync('tsx', [check.file, ...(check.args ?? [])], { stdio: 'inherit', shell: true })
  if (result.status !== 0) failed.push(`${check.file}（退出码 ${result.status}）`)
}

console.log(
  failed.length === 0
    ? `\n=== 静态判据 ${CHECKS.length} 支全部通过 ===`
    : `\n=== 静态判据 ${CHECKS.length} 支里 ${failed.length} 支红 ===\n${failed.map((f) => '  ' + f).join('\n')}`,
)
process.exit(failed.length === 0 ? 0 : 1)
