import { prisma } from './db'

/** Project events that a team OWNER/ADMIN may receive on the main surface. */
export const TEAM_NOTIFICATION_EVENT_TYPES = [
  'CLIENT_COMMENT',
  'CLIENT_UPLOAD',
  'VIDEO_APPROVAL',
  'DUE_DATE_REMINDER',
] as const

export type TeamAdminContact = { email: string; name: string | null }

export async function getTeamAdminContacts(teamId: string): Promise<TeamAdminContact[]> {
  const members = await prisma.teamMember.findMany({
    where: { teamId, status: 'ACTIVE', role: { in: ['OWNER', 'ADMIN'] } },
    select: { user: { select: { email: true, name: true } } },
  })

  const seen = new Set<string>()
  const contacts: TeamAdminContact[] = []
  for (const member of members) {
    const email = member.user.email?.trim()
    if (!email || seen.has(email)) continue
    seen.add(email)
    contacts.push({ email, name: member.user.name })
  }
  return contacts
}

export async function getProjectTeamAdminContacts(projectId: string): Promise<TeamAdminContact[]> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { teamId: true },
  })
  if (!project) return []
  return getTeamAdminContacts(project.teamId)
}

export async function getProjectTeamAdminEmails(projectId: string): Promise<string[]> {
  return (await getProjectTeamAdminContacts(projectId)).map((contact) => contact.email)
}
