import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve('src/app/api/share/[token]/renew/route.ts'), 'utf8')
const failures: string[] = []
function check(ok: boolean, label: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`)
  if (!ok) failures.push(label)
}

check(source.includes("from '@/lib/session-invalidation'"), 'renew 路由引入会话吊销模块')
check(source.includes('revokeShareSession('), '续签成功后吊销旧会话')
check(!source.includes('sessionId: payload.sessionId'), '旧会话 id 不再被复用')
check(source.includes('sessionId:'), '新令牌显式使用新的会话 id')

if (failures.length > 0) {
  console.error(`\n续签轮换 ${failures.length} 项不满足`)
  process.exit(1)
}
console.log('\n续签轮换 4 项全部通过')
