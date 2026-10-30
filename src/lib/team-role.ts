export type TeamRoleName = 'OWNER' | 'ADMIN' | 'MEMBER'

const ROLE_RANK: Record<TeamRoleName, number> = {
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
}

/**
 * Accepting an invite must never remove a privilege the account already has.
 * A lower-role invite can add a membership, but it cannot demote an active
 * owner or admin; a higher-role invite may still promote.
 */
export function resolveAcceptedRole(
  existing: TeamRoleName | null | undefined,
  invited: TeamRoleName,
): TeamRoleName {
  if (!existing) return invited
  return ROLE_RANK[existing] >= ROLE_RANK[invited] ? existing : invited
}
