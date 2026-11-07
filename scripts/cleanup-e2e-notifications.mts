import 'dotenv/config'
import { readFileSync, unlinkSync } from 'node:fs'
import { prisma } from '../src/lib/db'

async function main() {
  const raw = readFileSync('/tmp/gate0-e2e.json', 'utf8')
  const data = JSON.parse(raw) as {
    teamId: string
    projectId: string
    ownerId: string
    memberId: string
  }
  const notificationIds = (await prisma.userNotification.findMany({
    where: { teamId: data.teamId },
    select: { id: true },
  })).map((row) => row.id)
  await prisma.userNotificationDelivery.deleteMany({ where: { notificationId: { in: notificationIds } } })
  await prisma.userNotification.deleteMany({ where: { teamId: data.teamId } })
  await prisma.userNotificationEvent.deleteMany({ where: { teamId: data.teamId } })
  await prisma.comment.deleteMany({ where: { projectId: data.projectId } })
  await prisma.video.deleteMany({ where: { projectId: data.projectId } })
  await prisma.projectMember.deleteMany({ where: { projectId: data.projectId } })
  await prisma.project.deleteMany({ where: { id: data.projectId } })
  await prisma.teamMember.deleteMany({ where: { teamId: data.teamId } })
  await prisma.team.deleteMany({ where: { id: data.teamId } })
  await prisma.user.deleteMany({ where: { id: { in: [data.ownerId, data.memberId] } } })
  unlinkSync('/tmp/gate0-e2e.json')
  console.log('e2e data cleaned')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
    process.exit(process.exitCode || 0)
  })
