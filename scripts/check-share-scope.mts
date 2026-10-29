import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * A scoped share link is a data boundary, not just a landing-page filter.
 *
 * `/api/share/[token]/comments` already applies `getShareScopeVideoIds`. The
 * sibling `/api/comments` route accepts the same share bearer, so it must apply
 * the same scope on read and write; otherwise a single-video link can list or
 * comment on every video in the project.
 */
const root = new URL('../', import.meta.url)
const route = readFileSync(
  fileURLToPath(new URL('src/app/api/comments/route.ts', root)),
  'utf8',
)

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
    .replace(/([^:])\/\/[^\n]*/g, '$1')
}

const code = stripComments(route)
const failures: string[] = []
let passed = 0

function check(ok: boolean, label: string, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` → ${detail}` : ''}`)
  if (ok) passed += 1
  else failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

check(
  /import\s*\{[^}]*getShareScopeVideoIds[^}]*\}\s*from\s*['"]@\/lib\/share-links['"]/.test(code),
  '/api/comments 复用分享 scope 解析（getShareScopeVideoIds）',
  '单集/文件夹链接必须和 /api/share/[token]/comments 用同一条 scope 规则',
)
check(
  /videoId:\s*\{\s*in:\s*Array\.from\(scopedVideoIds\)\s*\}/.test(code),
  'GET 的 comment.findMany 带 scopedVideoIds 过滤',
  '缺这条时 bearer 仍能读到项目内其他集的批注',
)
check(
  /SCOPE_DENIED/.test(code),
  'POST 拒绝越出分享 scope 的 videoId',
  '缺这条时 scoped 链接可以往其他集写批注',
)
check(
  /resolveShareMetadata\s*\(/.test(code) && /isShareLinkActive\s*\(/.test(code),
  '分享 bearer 先解析 policy 并检查链接仍有效',
  '撤销/过期链接不能继续读评论',
)
check(
  /permissions\?*\.includes\(['"]comment['"]\)/.test(code),
  '分享 bearer 必须带 comment 权限',
  'COLLECT/只读链接不能借 /api/comments 读评论',
)

console.log(`\n合计 ${passed} PASS / ${failures.length} FAIL`)
if (failures.length) {
  console.error(failures.map((failure) => `  - ${failure}`).join('\n'))
  process.exit(1)
}
