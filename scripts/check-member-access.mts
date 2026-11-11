/**
 * Live check for P0 project-access changes. Requires `npm run dev` on :3000.
 * Creates two temporary teams/users/projects, exercises restricted PATCH and
 * per-team ALL_PROJECTS/ASSIGNED_ONLY, then removes every fixture.
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { resolveProjectViewers } from '../src/lib/in-app-notifications/recipients'

const prisma = new PrismaClient()
const BASE = 'http://localhost:3000'
const stamp = Date.now().toString(36)
const pw = `P0!${stamp}`
const teamIds: string[] = []
const userIds: string[] = []
const projectIds: string[] = []
let failed = 0

function check(label: string, ok: boolean, detail: unknown = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : ` → ${JSON.stringify(detail)}`}`)
}

async function login(email: string) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: pw }),
  })
  const json: any = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`login ${email} -> ${res.status} ${JSON.stringify(json)}`)
  return json.tokens.accessToken as string
}

async function api(path: string, token: string, teamId: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'x-team-id': teamId,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const json: any = await res.json().catch(() => null)
  return { status: res.status, json }
}

try {
  const hash = await bcrypt.hash(pw, 10)
  const mkUser = async (label: string) => {
    const user = await prisma.user.create({
      data: {
        email: `p0-${label}-${stamp}-${Math.random().toString(36).slice(2, 6)}@example.test`,
        phone: `19${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`,
        password: hash,
        name: `P0 ${label}`,
        role: 'MEMBER',
        onboardingCompleted: true,
      },
    })
    userIds.push(user.id)
    return user
  }
  const mkTeam = async (name: string) => {
    const owner = await mkUser('owner')
    const team = await prisma.team.create({
      data: {
        id: String(720000 + Math.floor(Math.random() * 70000)),
        name,
        slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${stamp}`,
        shareKey: `tm_${stamp}_${Math.random().toString(36).slice(2, 8)}`,
        createdById: owner.id,
        subscriptionPlan: 'BETA',
      },
    })
    teamIds.push(team.id)
    await prisma.teamMember.create({ data: { teamId: team.id, userId: owner.id, role: 'OWNER' } })
    return { team, owner }
  }
  const mkProject = async (teamId: string, createdById: string, title: string) => {
    const project = await prisma.project.create({
      data: {
        projectCode: String(100 + Math.floor(Math.random() * 800)),
        title,
        slug: `${title.toLowerCase().replace(/\s+/g, '-')}-${stamp}`,
        shareSlug: `s-${title.toLowerCase().replace(/\s+/g, '-')}-${stamp}`,
        teamId,
        createdById,
      },
    })
    projectIds.push(project.id)
    return project
  }

  const a = await mkTeam('P0 A')
  const b = await mkTeam('P0 B')
  const member = await mkUser('member')
  const invitee = await mkUser('invitee')
  const collab = await mkUser('collab')
  const projectAdmin = await mkUser('project-admin')
  const viewer = await mkUser('viewer')
  const adminJoin = await mkUser('admin-join')
  const disabledAdmin = await mkUser('disabled-admin')
  await prisma.teamMember.create({
    data: { teamId: a.team.id, userId: member.id, role: 'MEMBER', projectAccessScope: 'ALL_PROJECTS', defaultProjectRole: 'REVIEWER' },
  })
  await prisma.teamMember.create({
    data: { teamId: b.team.id, userId: member.id, role: 'MEMBER', projectAccessScope: 'ASSIGNED_ONLY', defaultProjectRole: 'REVIEWER' },
  })
  await prisma.teamMember.createMany({
    data: [
      { teamId: a.team.id, userId: projectAdmin.id, role: 'MEMBER', projectAccessScope: 'ASSIGNED_ONLY', defaultProjectRole: 'REVIEWER' },
      { teamId: a.team.id, userId: viewer.id, role: 'MEMBER', projectAccessScope: 'ASSIGNED_ONLY', defaultProjectRole: 'REVIEWER' },
      { teamId: a.team.id, userId: adminJoin.id, role: 'ADMIN' },
      { teamId: a.team.id, userId: disabledAdmin.id, role: 'ADMIN', status: 'DISABLED' },
    ],
  })
  await prisma.teamJoinRequest.createMany({
    data: [
      { teamId: a.team.id, userId: adminJoin.id, status: 'PENDING' },
      { teamId: a.team.id, userId: disabledAdmin.id, status: 'PENDING' },
    ],
  })
  const aNormal = await mkProject(a.team.id, a.owner.id, 'A Normal')
  const aRoles = await mkProject(a.team.id, a.owner.id, 'A Roles')
  const bNormal = await mkProject(b.team.id, b.owner.id, 'B Normal')
  const bAssigned = await mkProject(b.team.id, b.owner.id, 'B Assigned')
  await prisma.teamQuota.create({ data: { teamId: a.team.id, maxMembers: 10, maxProjects: 0, maxVideos: 0, maxStorageGB: 0 } })
  await prisma.projectMember.create({ data: { projectId: bAssigned.id, userId: member.id, role: 'REVIEWER' } })
  await prisma.projectMember.createMany({
    data: [
      { projectId: aRoles.id, userId: projectAdmin.id, role: 'PROJECT_ADMIN' },
      { projectId: aRoles.id, userId: viewer.id, role: 'REVIEWER' },
    ],
  })

  const ownerToken = await login(a.owner.email)
  const memberToken = await login(member.email)
  const inviteeToken = await login(invitee.email)
  const collabToken = await login(collab.email)
  const projectAdminToken = await login(projectAdmin.email)
  const viewerToken = await login(viewer.email)

  const invite = await api(`/api/teams/${a.team.id}/invitations`, ownerToken, a.team.id, {
    method: 'POST',
    body: JSON.stringify({ phone: invitee.phone, role: 'MEMBER' }),
  })
  const inviteToken = invite.json?.invite?.token
  check('invite creation returns a token', invite.status === 201 && Boolean(inviteToken), invite)
  if (inviteToken) {
    const accepted = await api(`/api/teams/${a.team.id}/invitations/${inviteToken}/accept`, inviteeToken, a.team.id, { method: 'POST' })
    const membership = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: a.team.id, userId: invitee.id } },
      select: { projectAccessScope: true, defaultProjectRole: true },
    })
    check('normal invite accepts', accepted.status === 200, accepted)
    check('normal invite defaults to ALL_PROJECTS + EDITOR', JSON.stringify(membership) === JSON.stringify({
      projectAccessScope: 'ALL_PROJECTS', defaultProjectRole: 'EDITOR',
    }), membership)
  }

  const collabInvite = await api(`/api/teams/${a.team.id}/invitations`, ownerToken, a.team.id, {
    method: 'POST',
    body: JSON.stringify({
      phone: collab.phone,
      role: 'MEMBER',
      projectAccessScope: 'ASSIGNED_ONLY',
      defaultProjectRole: 'REVIEWER',
      projects: [{ projectId: aRoles.id, role: 'EDITOR' }],
    }),
  })
  const collabTokenValue = collabInvite.json?.invite?.token
  check('collaborator invite carries project grants', collabInvite.status === 201 && collabInvite.json?.invite?.projects?.length === 1, collabInvite)
  if (collabTokenValue) {
    const accepted = await api(`/api/teams/${a.team.id}/invitations/${collabTokenValue}/accept`, collabToken, a.team.id, { method: 'POST' })
    const collabMember = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: a.team.id, userId: collab.id } },
      select: { projectAccessScope: true, defaultProjectRole: true },
    })
    const collabGrant = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: aRoles.id, userId: collab.id } },
      select: { role: true },
    })
    const collabProjects = await api('/api/projects', collabToken, a.team.id)
    const collabTitles = (collabProjects.json?.projects || []).map((project: any) => project.title).sort()
    check('collaborator invite accepts', accepted.status === 200, accepted)
    check('collaborator member is ASSIGNED_ONLY', collabMember?.projectAccessScope === 'ASSIGNED_ONLY', collabMember)
    check('collaborator project role is EDITOR', collabGrant?.role === 'EDITOR', collabGrant)
    check('collaborator sees only the assigned project', JSON.stringify(collabTitles) === JSON.stringify(['A Roles']), collabTitles)
    check('collaborator cannot open an unassigned project', (await api(`/api/projects/${aNormal.id}`, collabToken, a.team.id)).status === 403)
  }

  const folderByEditor = await api(`/api/projects/${aRoles.id}/folders`, inviteeToken, a.team.id, {
    method: 'POST',
    body: JSON.stringify({ name: `Editor ${stamp}` }),
  })
  const folderByViewer = await api(`/api/projects/${aRoles.id}/folders`, viewerToken, a.team.id, {
    method: 'POST',
    body: JSON.stringify({ name: `Viewer ${stamp}` }),
  })
  const folderByProjectAdmin = await api(`/api/projects/${aRoles.id}/folders`, projectAdminToken, a.team.id, {
    method: 'POST',
    body: JSON.stringify({ name: `Admin ${stamp}` }),
  })
  check('EDITOR can create a folder', folderByEditor.status === 201, folderByEditor)
  check('REVIEWER cannot create a folder', folderByViewer.status === 403, folderByViewer)
  check('PROJECT_ADMIN can create a folder', folderByProjectAdmin.status === 201, folderByProjectAdmin)

  const uploadByViewer = await api('/api/videos', viewerToken, a.team.id, {
    method: 'POST',
    body: JSON.stringify({
      projectId: aRoles.id,
      originalFileName: `viewer-${stamp}.mp4`,
      originalFileSize: 1024,
      name: `Viewer Upload ${stamp}`,
      mimeType: 'video/mp4',
    }),
  })
  const uploadByEditor = await api('/api/videos', inviteeToken, a.team.id, {
    method: 'POST',
    body: JSON.stringify({
      projectId: aRoles.id,
      originalFileName: `editor-${stamp}.mp4`,
      originalFileSize: 1024,
      name: `Editor Upload ${stamp}`,
      mimeType: 'video/mp4',
    }),
  })
  check('REVIEWER cannot upload', uploadByViewer.status === 403, uploadByViewer)
  check('EDITOR can upload', uploadByEditor.status === 200, uploadByEditor)

  const settingsByEditor = await api(`/api/projects/${aRoles.id}`, inviteeToken, a.team.id, {
    method: 'PATCH',
    body: JSON.stringify({ restricted: false }),
  })
  const settingsByProjectAdmin = await api(`/api/projects/${aRoles.id}`, projectAdminToken, a.team.id, {
    method: 'PATCH',
    body: JSON.stringify({ restricted: false }),
  })
  check('EDITOR cannot manage project settings', settingsByEditor.status === 403, settingsByEditor)
  check('PROJECT_ADMIN can manage project settings', settingsByProjectAdmin.status === 200, settingsByProjectAdmin)

  const shareByEditor = await api(`/api/projects/${aRoles.id}/share-links`, inviteeToken, a.team.id, {
    method: 'POST',
    body: JSON.stringify({ type: 'REVIEW', permissions: ['view'] }),
  })
  check('EDITOR cannot create share links', shareByEditor.status === 403, shareByEditor)

  const addMemberByProjectAdmin = await api(`/api/projects/${aRoles.id}/members`, projectAdminToken, a.team.id, {
    method: 'POST',
    body: JSON.stringify({ userId: viewer.id, role: 'REVIEWER' }),
  })
  check('PROJECT_ADMIN can manage project members', addMemberByProjectAdmin.status === 200, addMemberByProjectAdmin)

  const analyticsByViewer = await api(`/api/analytics/${aRoles.id}`, viewerToken, a.team.id)
  check('REVIEWER can read project analytics', analyticsByViewer.status === 200, analyticsByViewer)

  const roleByEditor = await api(`/api/projects/${aRoles.id}/members/${viewer.id}`, inviteeToken, a.team.id, {
    method: 'PATCH',
    body: JSON.stringify({ role: 'EDITOR' }),
  })
  const roleByProjectAdmin = await api(`/api/projects/${aRoles.id}/members/${viewer.id}`, projectAdminToken, a.team.id, {
    method: 'PATCH',
    body: JSON.stringify({ role: 'EDITOR' }),
  })
  check('EDITOR cannot change project roles', roleByEditor.status === 403, roleByEditor)
  check('PROJECT_ADMIN can change project roles', roleByProjectAdmin.status === 200, roleByProjectAdmin)
  const folderAfterRole = await api(`/api/projects/${aRoles.id}/folders`, viewerToken, a.team.id, {
    method: 'POST',
    body: JSON.stringify({ name: `Promoted ${stamp}` }),
  })
  check('role change takes effect immediately', folderAfterRole.status === 201, folderAfterRole)

  const createProjectByProjectAdmin = await api('/api/projects', projectAdminToken, a.team.id, {
    method: 'POST',
    body: JSON.stringify({ title: `Nope ${stamp}` }),
  })
  check('PROJECT_ADMIN cannot create a team project', createProjectByProjectAdmin.status === 403, createProjectByProjectAdmin)

  const aBefore = await api('/api/projects', memberToken, a.team.id)
  const aBeforeTitles = (aBefore.json?.projects || []).map((p: any) => p.title).sort()
  check('team A ALL_PROJECTS sees its normal project before restriction', aBeforeTitles.includes('A Normal'), aBeforeTitles)

  const patch = await api(`/api/projects/${aNormal.id}`, ownerToken, a.team.id, {
    method: 'PATCH',
    body: JSON.stringify({ restricted: true }),
  })
  const row = await prisma.project.findUnique({ where: { id: aNormal.id }, select: { restricted: true } })
  check('restricted PATCH returns 200', patch.status === 200, patch)
  check('restricted PATCH persists true', row?.restricted === true, row)

  const aList = await api('/api/projects', memberToken, a.team.id)
  const bList = await api('/api/projects', memberToken, b.team.id)
  const aTitles = (aList.json?.projects || []).map((p: any) => p.title).sort()
  const bTitles = (bList.json?.projects || []).map((p: any) => p.title).sort()
  check('team A ALL_PROJECTS loses the newly restricted project', !aTitles.includes('A Normal'), aTitles)
  check('team B ASSIGNED_ONLY sees only assigned project', JSON.stringify(bTitles) === JSON.stringify(['B Assigned']), bTitles)

  const aRoleNotifications = await resolveProjectViewers(aRoles.id)
  const bNormalNotifications = await resolveProjectViewers(bNormal.id)
  const bAssignedNotifications = await resolveProjectViewers(bAssigned.id)
  check('notification recipients use team A ALL_PROJECTS scope', aRoleNotifications.some((recipient) => recipient.userId === member.id))
  check('notification recipients exclude team B ASSIGNED_ONLY on unassigned project', !bNormalNotifications.some((recipient) => recipient.userId === member.id))
  check('notification recipients include team B assigned project', bAssignedNotifications.some((recipient) => recipient.userId === member.id))

  const ownerCapabilities = await api(`/api/projects/${aRoles.id}`, ownerToken, a.team.id)
  const editorCapabilities = await api(`/api/projects/${aRoles.id}`, inviteeToken, a.team.id)
  const viewerCapabilities = await api(`/api/projects/${aRoles.id}`, memberToken, a.team.id)
  check('PROJECT_ADMIN capabilities include settings/upload/share/approve', (
    ownerCapabilities.json?.capabilities?.canManageSettings === true
    && ownerCapabilities.json?.capabilities?.canUpload === true
    && ownerCapabilities.json?.capabilities?.canShare === true
    && ownerCapabilities.json?.capabilities?.canApprove === true
  ), ownerCapabilities.json?.capabilities)
  check('EDITOR capabilities include upload but not settings/share/approve', (
    editorCapabilities.json?.capabilities?.canUpload === true
    && editorCapabilities.json?.capabilities?.canManageSettings === false
    && editorCapabilities.json?.capabilities?.canShare === false
    && editorCapabilities.json?.capabilities?.canApprove === false
  ), editorCapabilities.json?.capabilities)
  check('REVIEWER capabilities are view/comment/download/stats only', (
    viewerCapabilities.json?.capabilities?.canUpload === false
    && viewerCapabilities.json?.capabilities?.canManageSettings === false
    && viewerCapabilities.json?.capabilities?.canShare === false
    && viewerCapabilities.json?.capabilities?.canViewStats === true
  ), viewerCapabilities.json?.capabilities)

  const restrictedDetail = await api(`/api/projects/${aNormal.id}`, ownerToken, a.team.id)
  const restrictedMembers = await api(`/api/projects/${aNormal.id}/members`, ownerToken, a.team.id)
  const restrictedMemberIds = new Set((restrictedMembers.json?.members || []).map((row: any) => row.id))
  const restrictedCandidateIds = new Set((restrictedMembers.json?.candidates || []).map((row: any) => row.id))
  check('restricted project count excludes MEMBER+ALL without a row', restrictedDetail.json?.memberCount === 2, restrictedDetail.json?.memberCount)
  check('restricted member panel excludes MEMBER+ALL without a row', !restrictedMemberIds.has(member.id) && !restrictedMemberIds.has(invitee.id), [...restrictedMemberIds])
  check('restricted project candidate pool includes ALL_PROJECTS members', restrictedCandidateIds.has(member.id) && restrictedCandidateIds.has(invitee.id), [...restrictedCandidateIds])

  const noRowRoleChange = await api(`/api/projects/${aRoles.id}/members/${member.id}`, ownerToken, a.team.id, {
    method: 'PATCH', body: JSON.stringify({ role: 'EDITOR' }),
  })
  check('project role change without a ProjectMember row returns NOT_ASSIGNED', noRowRoleChange.status === 404 && noRowRoleChange.json?.code === 'NOT_ASSIGNED', noRowRoleChange)
  const addRestrictedRow = await api(`/api/projects/${aNormal.id}/members`, ownerToken, a.team.id, {
    method: 'POST', body: JSON.stringify({ userId: member.id, role: 'EDITOR' }),
  })
  const changeRestrictedRole = await api(`/api/projects/${aNormal.id}/members/${member.id}`, ownerToken, a.team.id, {
    method: 'PATCH', body: JSON.stringify({ role: 'REVIEWER' }),
  })
  const restrictedRowAfter = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: aNormal.id, userId: member.id } },
    select: { role: true },
  })
  check('ALL_PROJECTS member can be added to a restricted project', addRestrictedRow.status === 200, addRestrictedRow)
  check('project role can be changed for a restricted-project row', changeRestrictedRole.status === 200 && restrictedRowAfter?.role === 'REVIEWER', { changeRestrictedRole, restrictedRowAfter })

  const accessByOwner = await api(`/api/teams/${a.team.id}/members/${member.id}`, ownerToken, a.team.id, {
    method: 'PATCH',
    body: JSON.stringify({ projectAccessScope: 'ASSIGNED_ONLY', defaultProjectRole: 'EDITOR' }),
  })
  const memberAccess = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId: a.team.id, userId: member.id } },
    select: { projectAccessScope: true, defaultProjectRole: true },
  })
  check('OWNER can change a member scope/default role', accessByOwner.status === 200, accessByOwner)
  check('member access fields persist', JSON.stringify(memberAccess) === JSON.stringify({
    projectAccessScope: 'ASSIGNED_ONLY', defaultProjectRole: 'EDITOR',
  }), memberAccess)

  const disableViewer = await api(`/api/teams/${a.team.id}/members/${viewer.id}`, ownerToken, a.team.id, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'DISABLED' }),
  })
  const disabledViewerAccess = await api(`/api/projects/${aRoles.id}`, viewerToken, a.team.id)
  const seatsAfterDisable = await api(`/api/teams/${a.team.id}/overview`, ownerToken, a.team.id)
  check('OWNER can disable a member', disableViewer.status === 200, disableViewer)
  check('DISABLED member loses project access', disabledViewerAccess.status === 403, disabledViewerAccess)
  check('DISABLED member frees a seat', seatsAfterDisable.json?.usage?.members === 6, seatsAfterDisable.json?.usage)
  const notificationViewersAfterDisable = await resolveProjectViewers(aRoles.id)
  check('DISABLED member is excluded from notification recipients', !notificationViewersAfterDisable.some((recipient) => recipient.userId === viewer.id))

  const enableViewer = await api(`/api/teams/${a.team.id}/members/${viewer.id}`, ownerToken, a.team.id, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'ACTIVE' }),
  })
  const enabledViewerAccess = await api(`/api/projects/${aRoles.id}`, viewerToken, a.team.id)
  const seatsAfterEnable = await api(`/api/teams/${a.team.id}/overview`, ownerToken, a.team.id)
  check('OWNER can re-enable a member', enableViewer.status === 200, enableViewer)
  check('re-enabled member regains project access', enabledViewerAccess.status === 200, enabledViewerAccess)
  check('re-enabled member takes a seat again', seatsAfterEnable.json?.usage?.members === 7, seatsAfterEnable.json?.usage)
  const notificationViewersAfterEnable = await resolveProjectViewers(aRoles.id)
  check('re-enabled member returns to notification recipients', notificationViewersAfterEnable.some((recipient) => recipient.userId === viewer.id))

  const removeViewer = await api(`/api/teams/${a.team.id}/members/${viewer.id}`, ownerToken, a.team.id, { method: 'DELETE' })
  const projectRowsAfterRemove = await prisma.projectMember.count({ where: { projectId: aRoles.id, userId: viewer.id } })
  check('OWNER can remove a member', removeViewer.status === 200, removeViewer)
  check('removal clears project grants', projectRowsAfterRemove === 0, { projectRowsAfterRemove })
  const notificationViewersAfterRemove = await resolveProjectViewers(aRoles.id)
  check('REMOVED member is excluded from notification recipients', !notificationViewersAfterRemove.some((recipient) => recipient.userId === viewer.id))

  await prisma.teamMember.create({
    data: { teamId: a.team.id, userId: viewer.id, role: 'MEMBER', projectAccessScope: 'ASSIGNED_ONLY', defaultProjectRole: 'REVIEWER' },
  })
  const readdedViewerAccess = await api(`/api/projects/${aRoles.id}`, viewerToken, a.team.id)
  check('re-added member does not regain old project access', readdedViewerAccess.status === 403, readdedViewerAccess)

  const auditRows = await prisma.teamAuditEvent.groupBy({
    by: ['action'],
    where: { teamId: a.team.id },
    _count: { _all: true },
  })
  const auditActions = new Set(auditRows.map((row) => row.action))
  check('member lifecycle is audited', [
    'INVITE_CREATED', 'INVITE_ACCEPTED', 'MEMBER_ACCESS_CHANGED',
    'PROJECT_ROLE_CHANGED', 'MEMBER_DISABLED', 'MEMBER_ENABLED', 'MEMBER_REMOVED',
  ].every((action) => auditActions.has(action)), [...auditActions])
  const auditPage = await api(`/api/teams/${a.team.id}/audit?limit=100`, ownerToken, a.team.id)
  const auditFiltered = await api(`/api/teams/${a.team.id}/audit?action=MEMBER_REMOVED`, ownerToken, a.team.id)
  const auditByMember = await api(`/api/teams/${a.team.id}/audit`, memberToken, a.team.id)
  check('OWNER can read the audit page API', auditPage.status === 200 && Array.isArray(auditPage.json?.events), auditPage.status)
  check('audit action filter works', auditFiltered.status === 200 && auditFiltered.json?.events?.every((event: any) => event.action === 'MEMBER_REMOVED'), auditFiltered.json)
  check('MEMBER cannot read the audit page API', auditByMember.status === 403, auditByMember.status)

  const c = await mkTeam('P0 C')
  await prisma.teamQuota.create({ data: { teamId: c.team.id, maxMembers: 2, maxProjects: 0, maxVideos: 0, maxStorageGB: 0 } })
  const capA = await mkUser('cap-a')
  const capB = await mkUser('cap-b')
  const capOwnerToken = await login(c.owner.email)
  const capAToken = await login(capA.email)
  const capBToken = await login(capB.email)
  const capInviteA = await api(`/api/teams/${c.team.id}/invitations`, capOwnerToken, c.team.id, {
    method: 'POST', body: JSON.stringify({ phone: capA.phone, role: 'MEMBER' }),
  })
  const capInviteB = await api(`/api/teams/${c.team.id}/invitations`, capOwnerToken, c.team.id, {
    method: 'POST', body: JSON.stringify({ phone: capB.phone, role: 'MEMBER' }),
  })
  const capTokenA = capInviteA.json?.invite?.token
  const capTokenB = capInviteB.json?.invite?.token
  if (capTokenA && capTokenB) {
    const [acceptA, acceptB] = await Promise.all([
      api(`/api/teams/${c.team.id}/invitations/${capTokenA}/accept`, capAToken, c.team.id, { method: 'POST' }),
      api(`/api/teams/${c.team.id}/invitations/${capTokenB}/accept`, capBToken, c.team.id, { method: 'POST' }),
    ])
    const statuses = [acceptA.status, acceptB.status].sort((a, b) => a - b)
    const active = await prisma.teamMember.count({ where: { teamId: c.team.id, status: 'ACTIVE' } })
    check('concurrent accepts cannot oversell seats', JSON.stringify(statuses) === JSON.stringify([200, 403]), { statuses, active })
    check('seat count never exceeds maxMembers', active === 2, { active })
    const fullAcceptCodes = [acceptA, acceptB].map((response) => response.json?.code).filter(Boolean)
    check('seat rejection uses SEAT_LIMIT_REACHED', fullAcceptCodes.includes('SEAT_LIMIT_REACHED'), fullAcceptCodes)

    const capC = await mkUser('cap-c')
    const capCInvite = await api(`/api/teams/${c.team.id}/invitations`, capOwnerToken, c.team.id, {
      method: 'POST', body: JSON.stringify({ phone: capC.phone, role: 'MEMBER' }),
    })
    check('invite creation at full uses SEAT_LIMIT_REACHED', capCInvite.status === 403 && capCInvite.json?.code === 'SEAT_LIMIT_REACHED', capCInvite)

    const capDisabled = await mkUser('cap-disabled')
    await prisma.teamMember.create({
      data: { teamId: c.team.id, userId: capDisabled.id, role: 'MEMBER', status: 'DISABLED' },
    })
    const enableAtFull = await api(`/api/teams/${c.team.id}/members/${capDisabled.id}`, capOwnerToken, c.team.id, {
      method: 'PATCH', body: JSON.stringify({ status: 'ACTIVE' }),
    })
    check('enable at full uses SEAT_LIMIT_REACHED', enableAtFull.status === 403 && enableAtFull.json?.code === 'SEAT_LIMIT_REACHED', enableAtFull)
    const seatLimitAudits = await prisma.teamAuditEvent.count({ where: { teamId: c.team.id, action: 'SEAT_LIMIT_HIT' } })
    check('SEAT_LIMIT_HIT is audited', seatLimitAudits >= 2, seatLimitAudits)

    const newOwner = await prisma.teamMember.findFirst({
      where: { teamId: c.team.id, status: 'ACTIVE', role: 'MEMBER' },
      select: { userId: true },
    })
    if (newOwner) {
      const transfer = await api(`/api/teams/${c.team.id}/transfer-owner`, capOwnerToken, c.team.id, {
        method: 'POST',
        body: JSON.stringify({ targetUserId: newOwner.userId }),
      })
      const roles = await prisma.teamMember.findMany({
        where: { teamId: c.team.id },
        select: { userId: true, role: true },
      })
      const teamAfter = await prisma.team.findUnique({ where: { id: c.team.id }, select: { createdById: true } })
      check('OWNER can transfer the team', transfer.status === 200, transfer)
      check('transfer swaps OWNER/ADMIN and updates team creator', (
        teamAfter?.createdById === newOwner.userId
        && roles.find((row) => row.userId === newOwner.userId)?.role === 'OWNER'
        && roles.find((row) => row.userId === c.owner.id)?.role === 'ADMIN'
      ), { roles, createdById: teamAfter?.createdById })
    } else {
      check('transfer fixture has a new owner candidate', false, { newOwner })
    }
  } else {
    check('concurrent seat fixture created two invites', false, { capInviteA, capInviteB })
  }

  const adminJoinRequest = await prisma.teamJoinRequest.findFirst({
    where: { teamId: a.team.id, userId: adminJoin.id, status: 'PENDING' },
    select: { id: true },
  })
  const disabledAdminJoinRequest = await prisma.teamJoinRequest.findFirst({
    where: { teamId: a.team.id, userId: disabledAdmin.id, status: 'PENDING' },
    select: { id: true },
  })
  const approveAdminJoin = adminJoinRequest
    ? await api(`/api/teams/${a.team.id}/join-requests/${adminJoinRequest.id}`, ownerToken, a.team.id, {
        method: 'PATCH', body: JSON.stringify({ status: 'APPROVED' }),
      })
    : null
  const approveDisabledAdminJoin = disabledAdminJoinRequest
    ? await api(`/api/teams/${a.team.id}/join-requests/${disabledAdminJoinRequest.id}`, ownerToken, a.team.id, {
        method: 'PATCH', body: JSON.stringify({ status: 'APPROVED' }),
      })
    : null
  const adminAfterJoin = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId: a.team.id, userId: adminJoin.id } },
    select: { role: true, status: true },
  })
  const disabledAdminAfterJoin = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId: a.team.id, userId: disabledAdmin.id } },
    select: { role: true, status: true },
  })
  check('join approval does not demote an ADMIN', approveAdminJoin?.status === 200 && adminAfterJoin?.role === 'ADMIN', { approveAdminJoin, adminAfterJoin })
  check('join approval restores a DISABLED ADMIN with the same role', approveDisabledAdminJoin?.status === 200 && disabledAdminAfterJoin?.role === 'ADMIN' && disabledAdminAfterJoin?.status === 'ACTIVE', { approveDisabledAdminJoin, disabledAdminAfterJoin })
} catch (error) {
  console.error('FATAL', error)
  failed += 1
} finally {
  await prisma.projectMember.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => null)
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } }).catch(() => null)
  await prisma.teamMember.deleteMany({ where: { teamId: { in: teamIds } } }).catch(() => null)
  await prisma.team.deleteMany({ where: { id: { in: teamIds } } }).catch(() => null)
  await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => null)
  await prisma.$disconnect()
  console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}
