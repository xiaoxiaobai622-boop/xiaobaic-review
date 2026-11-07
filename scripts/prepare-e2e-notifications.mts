import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import { prisma } from '../src/lib/db'
import { issueAdminTokens } from '../src/lib/auth'
import {
  emitClientUploadInAppNotification,
  emitCommentInAppNotifications,
} from '../src/lib/in-app-notifications/emit'

const suffix = `${Date.now()}`.slice(-6)
const teamId = String(950000 + Math.floor(Math.random() * 49999))

async function main() {
  const password = 'gate0-e2e-only'
  const phoneBase = Number(`139${suffix.padStart(8, '0').slice(0, 8)}`)
  const owner = await prisma.user.create({
    data: {
      email: `gate0-e2e-owner-${suffix}@example.test`,
      password,
      phone: String(phoneBase + 1),
      name: 'E2E Owner',
    },
  })
  const member = await prisma.user.create({
    data: {
      email: `gate0-e2e-member-${suffix}@example.test`,
      password,
      phone: String(phoneBase + 2),
      name: 'E2E Member',
    },
  })
  const team = await prisma.team.create({
    data: {
      id: teamId,
      name: `Gate0 E2E Team ${suffix}`,
      slug: `gate0-e2e-${suffix}`,
      shareKey: `gate0-e2e-share-${suffix}`,
      createdById: owner.id,
    },
  })
  await prisma.teamMember.createMany({
    data: [
      { teamId: team.id, userId: owner.id, role: 'OWNER' },
      { teamId: team.id, userId: member.id, role: 'MEMBER' },
    ],
  })
  const project = await prisma.project.create({
    data: {
      projectCode: '001',
      title: `Gate0 E2E Project ${suffix}`,
      slug: `gate0-e2e-project-${suffix}`,
      shareSlug: `gate0-e2e-project-share-${suffix}`,
      teamId: team.id,
      createdById: owner.id,
    },
  })
  const video = await prisma.video.create({
    data: {
      projectId: project.id,
      name: `Gate0 E2E Video ${suffix}`,
      version: 1,
      versionLabel: 'v1',
      originalFileName: `gate0-e2e-${suffix}.mp4`,
      originalFileSize: BigInt(1),
      originalStoragePath: `gate0-e2e/${suffix}.mp4`,
      duration: 30,
      width: 1920,
      height: 1080,
      status: 'READY',
      uploadedBy: owner.id,
      uploadedByName: owner.name,
    },
  })

  await emitClientUploadInAppNotification({
    projectId: project.id,
    fileName: 'first-cut.mp4',
    uploaderName: 'E2E Client',
    uploaderEmail: `gate0-e2e-client-${suffix}@example.test`,
    uploadId: `e2e-upload-1-${suffix}`,
  })
  await emitClientUploadInAppNotification({
    projectId: project.id,
    fileName: 'second-cut.mp4',
    uploaderName: 'E2E Client',
    uploaderEmail: `gate0-e2e-client-${suffix}@example.test`,
    uploadId: `e2e-upload-2-${suffix}`,
  })

  const mentionComment = await prisma.comment.create({
    data: {
      projectId: project.id,
      videoId: video.id,
      timecode: '00:00:03:00',
      content: 'E2E member mentions the owner',
      authorName: member.name,
      userId: member.id,
      isInternal: true,
      visibility: 'PUBLIC',
    },
  })
  await emitCommentInAppNotifications({
    comment: mentionComment,
    mentionedUserIds: [owner.id],
  })

  const tokens = await issueAdminTokens({
    id: owner.id,
    email: owner.email,
    name: owner.name,
    role: owner.role,
  })

  const payload = {
    teamId: team.id,
    projectId: project.id,
    videoId: video.id,
    ownerId: owner.id,
    memberId: member.id,
    mentionCommentId: mentionComment.id,
    refreshToken: tokens.refreshToken,
    suffix,
  }
  writeFileSync('/tmp/gate0-e2e.json', JSON.stringify(payload, null, 2))
  console.log(JSON.stringify({ ok: true, ...payload, refreshToken: '<redacted>' }, null, 2))
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
