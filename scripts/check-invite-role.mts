import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveAcceptedRole } from '../src/lib/team-role'

const failures: string[] = []
function check(ok: boolean, label: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`)
  if (!ok) failures.push(label)
}

check(resolveAcceptedRole('ADMIN', 'MEMBER') === 'ADMIN', 'existing ADMIN is not demoted')
check(resolveAcceptedRole('OWNER', 'MEMBER') === 'OWNER', 'existing OWNER is not demoted')
check(resolveAcceptedRole('MEMBER', 'ADMIN') === 'ADMIN', 'invite can still promote')
check(resolveAcceptedRole(null, 'MEMBER') === 'MEMBER', 'new member takes the invited role')
check(resolveAcceptedRole('MEMBER', 'MEMBER') === 'MEMBER', 'same role is stable')

const acceptRoute = readFileSync(
  resolve('src/app/api/teams/[id]/invitations/[token]/accept/route.ts'),
  'utf8',
)
check(acceptRoute.includes('resolveAcceptedRole('), 'accept route uses the role resolver')
check(acceptRoute.includes("existing?.status === 'ACTIVE'"), 'only active memberships keep their role')

const invitePage = readFileSync(resolve('src/app/studio/team/invite/[token]/page.tsx'), 'utf8')
check(invitePage.includes('invite.role'), 'accept page shows the invited role')
check(invitePage.includes('invite.expiresAt'), 'accept page shows the invite expiry')

if (failures.length > 0) {
  console.error(`\n邀请角色 ${failures.length} 项不满足`)
  process.exit(1)
}
console.log('\n邀请角色 9 项全部通过')
