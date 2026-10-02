import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { isTeamSubscriptionActive } from '@/lib/platform-access'

/**
 * 写闸门的两枚码 = 响应里 `code` 的词表（F-3）。它与 `billing-pricing.ts` 的 `BillingErrorCode`
 * 是两套：那五枚由 `BillingError` 抛出、走 HTTP 映射，这两枚由本文件直接回 403，从不包成
 * `BillingError`。客户端要按码亮本地化文案，所以码必须有名有姓地导出。
 */
export type TeamWriteBlockCode = 'TEAM_DISABLED' | 'TEAM_EXPIRED'

/**
 * Expiry blocks writes, never reads: a client must still be able to watch and
 * annotate what was already delivered to them even if the team stopped paying.
 * A null expiry stays "long term" because that is what every existing team has
 * (spec §10) — defaulting the other way would freeze production on deploy day.
 */
export function getTeamWriteBlockReason(team: { status: string; subscriptionPlan: string; subscriptionExpiresAt: Date | null } | null): TeamWriteBlockCode | null {
  if (!team || team.status !== 'ACTIVE') return 'TEAM_DISABLED' as const
  if (!isTeamSubscriptionActive(team)) return 'TEAM_EXPIRED' as const
  return null
}

/** Returns a ready-to-send 403, or null when the team may write. */
export async function requireTeamWritable(teamId: string) {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { status: true, subscriptionPlan: true, subscriptionExpiresAt: true },
  })
  const reason = getTeamWriteBlockReason(team)
  if (!reason) return null
  return NextResponse.json(
    {
      error: reason === 'TEAM_EXPIRED' ? '团队已到期，续费后可继续使用' : '团队已停用，请联系运营',
      code: reason,
    },
    { status: 403 },
  )
}

/**
 * Three of the six write paths key off a project in the request body, not off the
 * acting team: `authorizedTeamId` is only read by `projects/route.ts`,
 * `projects/[id]/route.ts` and `studio/project-groups/*` (`grep -rln authorizedTeamId src/app/api`),
 * while `videos` and `promote` authorize through `canAccessProject`, which resolves
 * membership from the project's own team (`src/lib/project-access.ts:63-72`). The third one is
 * `presign`: it authenticates via `verifyS3UploadAccess` (admin token *or* share token) and then
 * gates on `getUploadTargetProjectId(...)` for **both** branches, so an expired team's external
 * collaborators cannot keep pushing bytes in either.
 * Gating those on the acting team would let a user with two teams write into the expired one.
 */
export async function requireProjectWritable(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { teamId: true } })
  return project ? requireTeamWritable(project.teamId) : null
}
