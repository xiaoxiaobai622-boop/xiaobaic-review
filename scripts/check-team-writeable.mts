import { getTeamWriteBlockReason } from '../src/lib/team-writeable'

const DAY = 86_400_000
const now = Date.now()
let passed = 0
const failures: string[] = []
function expect(name: string, actual: unknown, want: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(want)
  if (ok) passed += 1
  else failures.push(`${name}\n      expected ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} → ${JSON.stringify(actual)}`)
}
const t = (status: string, expiresAt: Date | null, subscriptionPlan = 'MONTHLY') => ({ status, subscriptionPlan, subscriptionExpiresAt: expiresAt })

expect('null expiry = 长期有效，放行', getTeamWriteBlockReason(t('ACTIVE', null)), null)
expect('未来到期放行', getTeamWriteBlockReason(t('ACTIVE', new Date(now + 30 * DAY))), null)
// 内测期不过期：`isTeamSubscriptionActive` 恒 true，到期日与 UNACTIVATED 都不再拦写。
expect('过去到期也放行（内测）', getTeamWriteBlockReason(t('ACTIVE', new Date(now - DAY))), null)
expect('到期边界（1 秒前）也放行（内测）', getTeamWriteBlockReason(t('ACTIVE', new Date(now - 1000))), null)
expect('UNACTIVATED 也放行（内测，沿用 isTeamSubscriptionActive 语义）', getTeamWriteBlockReason(t('ACTIVE', null, 'UNACTIVATED')), null)
expect('SUSPENDED 优先于到期判断', getTeamWriteBlockReason(t('SUSPENDED', null)), 'TEAM_DISABLED')
expect('team 为 null', getTeamWriteBlockReason(null), 'TEAM_DISABLED')

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) { console.log(failures.join('\n')); process.exit(1) }
