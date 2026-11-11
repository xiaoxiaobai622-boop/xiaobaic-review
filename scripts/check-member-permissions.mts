import type { ProjectAccessScope, ProjectRole, TeamRole } from '@prisma/client'
import {
  canChangeTeamRole,
  canDisableMember,
  canManageMember,
  canProject,
  canTeam,
  resolveProjectRole,
  type ProjectAction,
  type TeamAction,
} from '../src/lib/project-policy'

let failed = 0

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : ` → expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`)
}

function projectRole(input: {
  teamRole: TeamRole
  scope: ProjectAccessScope
  defaultRole: ProjectRole
  restricted?: boolean
  memberRole?: ProjectRole | null
}) {
  return resolveProjectRole({
    teamRole: input.teamRole,
    projectAccessScope: input.scope,
    defaultProjectRole: input.defaultRole,
    restricted: input.restricted ?? false,
    projectMemberRole: input.memberRole ?? null,
  })
}

const allProjectActions: ProjectAction[] = [
  'view', 'comment', 'download', 'upload', 'edit', 'delete',
  'manageMembers', 'manageSettings', 'share', 'approve', 'viewStats',
]

const allTeamActions: TeamAction[] = [
  'manageTeamSettings', 'manageBilling', 'inviteMember', 'removeMember',
  'removeAdmin', 'changeRole', 'disableMember', 'transferOwner', 'dissolveTeam',
  'createProject', 'archiveProject', 'deleteProject', 'manageClients', 'viewAudit',
]

// ── Team roles ────────────────────────────────────────────────────────────
check('OWNER team actions are all allowed', allTeamActions.every(action => canTeam('OWNER', action)), true)
check('ADMIN cannot bill/transfer/dissolve/change roles', [
  canTeam('ADMIN', 'manageBilling'),
  canTeam('ADMIN', 'transferOwner'),
  canTeam('ADMIN', 'dissolveTeam'),
  canTeam('ADMIN', 'changeRole'),
  canTeam('ADMIN', 'removeAdmin'),
], [false, false, false, false, false])
check('ADMIN can invite/disable/create projects/audit', [
  canTeam('ADMIN', 'inviteMember'),
  canTeam('ADMIN', 'disableMember'),
  canTeam('ADMIN', 'createProject'),
  canTeam('ADMIN', 'viewAudit'),
], [true, true, true, true])
check('MEMBER has no team management actions', allTeamActions.some(action => canTeam('MEMBER', action)), false)
check('role changes are OWNER-only', [
  canChangeTeamRole('OWNER'),
  canChangeTeamRole('ADMIN'),
  canChangeTeamRole('MEMBER'),
], [true, false, false])
check('ADMIN may remove MEMBER, not ADMIN/OWNER', [
  canManageMember('ADMIN', 'MEMBER'),
  canManageMember('ADMIN', 'ADMIN'),
  canManageMember('ADMIN', 'OWNER'),
], [true, false, false])
check('OWNER may remove ADMIN/MEMBER, not OWNER', [
  canManageMember('OWNER', 'MEMBER'),
  canManageMember('OWNER', 'ADMIN'),
  canManageMember('OWNER', 'OWNER'),
], [true, true, false])
check('disable follows the same target rule and never disables OWNER', [
  canDisableMember('ADMIN', 'MEMBER'),
  canDisableMember('ADMIN', 'ADMIN'),
  canDisableMember('OWNER', 'ADMIN'),
  canDisableMember('OWNER', 'OWNER'),
], [true, false, true, false])

// ── Project role resolution ───────────────────────────────────────────────
check('OWNER/ADMIN are implicit PROJECT_ADMIN on restricted projects without a row', [
  projectRole({ teamRole: 'OWNER', scope: 'ALL_PROJECTS', defaultRole: 'REVIEWER', restricted: true }),
  projectRole({ teamRole: 'ADMIN', scope: 'ASSIGNED_ONLY', defaultRole: 'REVIEWER', restricted: true }),
], ['PROJECT_ADMIN', 'PROJECT_ADMIN'])

check('MEMBER ALL uses default role on non-restricted projects', [
  projectRole({ teamRole: 'MEMBER', scope: 'ALL_PROJECTS', defaultRole: 'EDITOR' }),
  projectRole({ teamRole: 'MEMBER', scope: 'ALL_PROJECTS', defaultRole: 'REVIEWER' }),
], ['EDITOR', 'REVIEWER'])

check('MEMBER ALL cannot see restricted project without a row', projectRole({
  teamRole: 'MEMBER', scope: 'ALL_PROJECTS', defaultRole: 'EDITOR', restricted: true,
}), null)

check('MEMBER ALL with a restricted-project row uses the row role', projectRole({
  teamRole: 'MEMBER', scope: 'ALL_PROJECTS', defaultRole: 'EDITOR', restricted: true, memberRole: 'REVIEWER',
}), 'REVIEWER')

check('MEMBER ASSIGNED without a row has no project role', projectRole({
  teamRole: 'MEMBER', scope: 'ASSIGNED_ONLY', defaultRole: 'EDITOR',
}), null)

check('MEMBER ASSIGNED uses the row role', [
  projectRole({ teamRole: 'MEMBER', scope: 'ASSIGNED_ONLY', defaultRole: 'EDITOR', memberRole: 'EDITOR' }),
  projectRole({ teamRole: 'MEMBER', scope: 'ASSIGNED_ONLY', defaultRole: 'EDITOR', memberRole: 'PROJECT_ADMIN' }),
  projectRole({ teamRole: 'MEMBER', scope: 'ASSIGNED_ONLY', defaultRole: 'EDITOR', memberRole: 'REVIEWER' }),
], ['EDITOR', 'PROJECT_ADMIN', 'REVIEWER'])

check('ProjectMember row overrides default even on non-restricted ALL_PROJECTS', projectRole({
  teamRole: 'MEMBER', scope: 'ALL_PROJECTS', defaultRole: 'REVIEWER', memberRole: 'EDITOR',
}), 'EDITOR')

// ── Project actions ───────────────────────────────────────────────────────
check('PROJECT_ADMIN can perform every project action', allProjectActions.every(action => canProject('PROJECT_ADMIN', action)), true)

check('EDITOR can edit content but cannot manage/share/approve', {
  upload: canProject('EDITOR', 'upload'),
  edit: canProject('EDITOR', 'edit'),
  delete: canProject('EDITOR', 'delete'),
  comment: canProject('EDITOR', 'comment'),
  download: canProject('EDITOR', 'download'),
  viewStats: canProject('EDITOR', 'viewStats'),
  manageMembers: canProject('EDITOR', 'manageMembers'),
  manageSettings: canProject('EDITOR', 'manageSettings'),
  share: canProject('EDITOR', 'share'),
  approve: canProject('EDITOR', 'approve'),
}, {
  upload: true, edit: true, delete: true, comment: true, download: true, viewStats: true,
  manageMembers: false, manageSettings: false, share: false, approve: false,
})

check('REVIEWER can view/comment/download/stats only', {
  view: canProject('REVIEWER', 'view'),
  comment: canProject('REVIEWER', 'comment'),
  download: canProject('REVIEWER', 'download'),
  viewStats: canProject('REVIEWER', 'viewStats'),
  upload: canProject('REVIEWER', 'upload'),
  manageMembers: canProject('REVIEWER', 'manageMembers'),
  share: canProject('REVIEWER', 'share'),
  approve: canProject('REVIEWER', 'approve'),
}, {
  view: true, comment: true, download: true, viewStats: true,
  upload: false, manageMembers: false, share: false, approve: false,
})

check('no project role denies every action', allProjectActions.every(action => !canProject(null, action)), true)

console.log(`\n${failed === 0 ? 'ALL PASS' : `${failed} FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
