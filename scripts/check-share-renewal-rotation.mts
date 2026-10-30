import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve('src/app/api/share/[token]/renew/route.ts'), 'utf8')
const shareRoute = readFileSync(resolve('src/app/api/share/[token]/route.ts'), 'utf8')
const client = readFileSync(resolve('src/app/share/[teamSlug]/SharePageClient.tsx'), 'utf8')
const failures: string[] = []
function check(ok: boolean, label: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`)
  if (!ok) failures.push(label)
}

check(source.includes("from '@/lib/session-invalidation'"), 'renew 路由引入会话吊销模块')
check(source.includes('revokeShareSession('), '续签成功后吊销旧会话')
check(source.includes('revokeToken('), '旧 bearer 进入令牌黑名单')
check(source.includes("startsWith('none:')"), 'NONE 的固定 session 不被续签吊销')
check(!source.includes('sessionId: payload.sessionId'), '旧会话 id 不再被复用')
check(source.includes('sessionId:'), '新令牌显式使用新的会话 id')

check(shareRoute.includes('isShareSessionRevoked('), '发新令牌前检查 NONE 固定 session 是否被吊销')
check(client.includes('readShareTokenRaw(storageKey)'), '客户端旧 401 不清掉更新的令牌')
check(client.includes('storedToken !== authToken') && client.includes('storedToken !== shareToken'), '客户端两处 401 清理都带新旧令牌比较')

if (failures.length > 0) {
  console.error(`\n续签轮换 ${failures.length} 项不满足`)
  process.exit(1)
}
console.log('\n续签轮换 9 项全部通过')
