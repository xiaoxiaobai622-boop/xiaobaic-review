import type { ProjectAccessScope, ProjectRole, TeamRole } from '@prisma/client'

export type ProjectAction =
  | 'view'
  | 'comment'
  | 'download'
  | 'upload'
  | 'edit'
  | 'delete'
  | 'manageMembers'
  | 'manageSettings'
  | 'share'
  | 'approve'
  | 'viewStats'

export type TeamAction =
  | 'manageTeamSettings'
  | 'manageBilling'
  | 'inviteMember'
  | 'removeMember'
  | 'removeAdmin'
  | 'changeRole'
  | 'disableMember'
  | 'transferOwner'
  | 'dissolveTeam'
  | 'createProject'
  | 'archiveProject'
  | 'deleteProject'
  | 'manageClients'
  | 'viewAudit'

const PROJECT_ACTIONS: Record<ProjectRole, ReadonlySet<ProjectAction>> = {
  PROJECT_ADMIN: new Set([
    'view',
    'comment',
    'download',
    'upload',
    'edit',
    'delete',
    'manageMembers',
    'manageSettings',
    'share',
    'approve',
    'viewStats',
  ]),
  EDITOR: new Set([
    'view',
    'comment',
    'download',
    'upload',
    'edit',
    'delete',
    'viewStats',
  ]),
  REVIEWER: new Set([
    'view',
    'comment',
    'download',
    'viewStats',
  ]),
}

const TEAM_ACTIONS: Record<TeamRole, ReadonlySet<TeamAction>> = {
  OWNER: new Set([
    'manageTeamSettings',
    'manageBilling',
    'inviteMember',
    'removeMember',
    'removeAdmin',
    'changeRole',
    'disableMember',
    'transferOwner',
    'dissolveTeam',
    'createProject',
    'archiveProject',
    'deleteProject',
    'manageClients',
    'viewAudit',
  ]),
  ADMIN: new Set([
    'manageTeamSettings',
    'inviteMember',
    'removeMember',
    'disableMember',
    'createProject',
    'archiveProject',
    'deleteProject',
    'manageClients',
    'viewAudit',
  ]),
  MEMBER: new Set(),
}

/**
 * The single project-role resolution rule.
 *
 * - OWNER/ADMIN are implicit PROJECT_ADMIN everywhere.
 * - A ProjectMember row is an explicit override.
 * - MEMBER + ALL_PROJECTS falls back to defaultProjectRole on non-restricted projects.
 * - MEMBER + ASSIGNED_ONLY without a row has no access.
 * - restricted projects require a ProjectMember row even for ALL_PROJECTS members.
 */
export function resolveProjectRole(input: {
  teamRole: TeamRole
  projectAccessScope: ProjectAccessScope
  defaultProjectRole: ProjectRole
  restricted: boolean
  projectMemberRole?: ProjectRole | null
}): ProjectRole | null {
  if (input.teamRole === 'OWNER' || input.teamRole === 'ADMIN') return 'PROJECT_ADMIN'
  if (input.projectMemberRole) return input.projectMemberRole
  if (input.projectAccessScope === 'ASSIGNED_ONLY') return null
  if (input.restricted) return null
  return input.defaultProjectRole
}

export function canProject(role: ProjectRole | null, action: ProjectAction): boolean {
  return role !== null && PROJECT_ACTIONS[role].has(action)
}

export function canTeam(role: TeamRole, action: TeamAction): boolean {
  return TEAM_ACTIONS[role].has(action)
}

/** ADMIN may remove MEMBER only; OWNER may remove ADMIN/MEMBER; OWNER is never removable. */
export function canManageMember(actor: TeamRole, target: TeamRole): boolean {
  if (target === 'OWNER') return false
  if (actor === 'OWNER') return true
  return actor === 'ADMIN' && target === 'MEMBER'
}

/** Same target rule as removal, but OWNER/ADMIN can never be disabled by anyone. */
export function canDisableMember(actor: TeamRole, target: TeamRole): boolean {
  if (target === 'OWNER') return false
  if (actor === 'OWNER') return target === 'ADMIN' || target === 'MEMBER'
  return actor === 'ADMIN' && target === 'MEMBER'
}

export function canChangeTeamRole(actor: TeamRole): boolean {
  return actor === 'OWNER'
}
