import 'dotenv/config'
import assert from 'node:assert/strict'
import type { Prisma } from '@prisma/client'
import { prisma } from '../src/lib/db'
import {
  emitApprovalInAppNotification,
  emitClientUploadInAppNotification,
  emitCommentInAppNotifications,
  emitDueDateInAppNotification,
  emitVideoReadyInAppNotification,
} from '../src/lib/in-app-notifications/emit'
import { isCommentVisibleToClients } from '../src/lib/comment-helpers'
import { getNotificationFeed, markNotificationsRead } from '../src/lib/in-app-notifications/queries'
import { issueAdminTokens, revokePresentedTokens } from '../src/lib/auth'
import { NextRequest } from 'next/server'
import { GET as getNotifications } from '../src/app/api/notifications/route'
import { POST as markRead } from '../src/app/api/notifications/read/route'
import { finalizeVideo } from '../src/worker/video-processor-helpers'

const suffix = `${Date.now()}`.slice(-6)
const teamAId = String(900000 + Math.floor(Math.random() * 99999))
const teamBId = String(Number(teamAId) + 1)
const userIds: string[] = []
const projectIds: string[] = []
let issuedTokens: Awaited<ReturnType<typeof issueAdminTokens>> | null = null
let userIndex = 0

async function waitForNotificationCount(
  where: Prisma.UserNotificationWhereInput,
  expected: number,
  timeoutMs = 5000,
): Promise<number> {
  const started = Date.now()
  let count = 0
  while (Date.now() - started < timeoutMs) {
    count = await prisma.userNotification.count({ where })
    if (count >= expected) return count
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return count
}

async function main() {
  const password = 'gate0-test-only'
  const makeUser = async (label: string, scope: 'ALL_PROJECTS' | 'ASSIGNED_ONLY' = 'ALL_PROJECTS') => {
    userIndex += 1
    const phone = `139${String(Number(suffix) + userIndex).padStart(8, '0').slice(-8)}`
    const user = await prisma.user.create({
      data: {
        email: `gate0-${label}-${suffix}@example.test`,
        password,
        phone,
        name: `Gate0 ${label}`,
        projectAccessScope: scope,
      },
    })
    userIds.push(user.id)
    return user
  }

  const owner = await makeUser('owner')
  const admin = await makeUser('admin')
  const memberAll = await makeUser('member-all')
  const memberAssigned = await makeUser('member-assigned', 'ASSIGNED_ONLY')
  const memberUnassigned = await makeUser('member-unassigned', 'ASSIGNED_ONLY')
  const disabled = await makeUser('disabled')
  const teamBUser = await makeUser('team-b')

  const teamA = await prisma.team.create({
    data: {
      id: teamAId,
      name: `Gate0 Team A ${suffix}`,
      slug: `gate0-a-${suffix}`,
      shareKey: `gate0-share-a-${suffix}`,
      createdById: owner.id,
    },
  })
  const teamB = await prisma.team.create({
    data: {
      id: teamBId,
      name: `Gate0 Team B ${suffix}`,
      slug: `gate0-b-${suffix}`,
      shareKey: `gate0-share-b-${suffix}`,
      createdById: teamBUser.id,
    },
  })

  await prisma.teamMember.createMany({
    data: [
      { teamId: teamA.id, userId: owner.id, role: 'OWNER' },
      { teamId: teamA.id, userId: admin.id, role: 'ADMIN' },
      { teamId: teamA.id, userId: memberAll.id, role: 'MEMBER' },
      { teamId: teamA.id, userId: memberAssigned.id, role: 'MEMBER' },
      { teamId: teamA.id, userId: memberUnassigned.id, role: 'MEMBER' },
      { teamId: teamA.id, userId: disabled.id, role: 'MEMBER', status: 'DISABLED' },
      { teamId: teamB.id, userId: teamBUser.id, role: 'OWNER' },
    ],
  })

  const projectA = await prisma.project.create({
    data: {
      projectCode: '001',
      title: `Gate0 Project A ${suffix}`,
      slug: `gate0-project-a-${suffix}`,
      shareSlug: `gate0-project-share-a-${suffix}`,
      teamId: teamA.id,
      createdById: owner.id,
      restricted: false,
    },
  })
  const projectB = await prisma.project.create({
    data: {
      projectCode: '001',
      title: `Gate0 Project B ${suffix}`,
      slug: `gate0-project-b-${suffix}`,
      shareSlug: `gate0-project-share-b-${suffix}`,
      teamId: teamB.id,
      createdById: teamBUser.id,
      restricted: false,
    },
  })
  projectIds.push(projectA.id, projectB.id)

  await prisma.projectMember.create({
    data: { projectId: projectA.id, userId: memberAssigned.id },
  })

  const videoA = await prisma.video.create({
    data: {
      projectId: projectA.id,
      name: `Gate0 Video ${suffix}`,
      version: 1,
      versionLabel: 'v1',
      originalFileName: `gate0-${suffix}.mp4`,
      originalFileSize: BigInt(1),
      originalStoragePath: `gate0/${suffix}.mp4`,
      duration: 60,
      width: 1920,
      height: 1080,
      status: 'READY',
      uploadedBy: owner.id,
      uploadedByName: owner.name,
    },
  })

  const fallbackMetadata = { duration: 30, width: 1920, height: 1080, fps: 25, codec: 'h264' }
  const fallbackV1 = await prisma.video.create({
    data: {
      projectId: projectA.id,
      name: `Gate0 Fallback ${suffix}`,
      version: 1,
      versionLabel: 'v1',
      originalFileName: `gate0-fallback-v1-${suffix}.mp4`,
      originalFileSize: BigInt(1),
      originalStoragePath: `gate0/fallback-v1-${suffix}.mp4`,
      duration: 30,
      width: 1920,
      height: 1080,
      status: 'PROCESSING',
      uploadedBy: memberAll.id,
      uploadedByName: memberAll.name,
    },
  })
  const fallbackV2 = await prisma.video.create({
    data: {
      projectId: projectA.id,
      name: `Gate0 Fallback ${suffix}`,
      version: 2,
      versionLabel: 'v2',
      originalFileName: `gate0-fallback-v2-${suffix}.mp4`,
      originalFileSize: BigInt(1),
      originalStoragePath: `gate0/fallback-v2-${suffix}.mp4`,
      duration: 30,
      width: 1920,
      height: 1080,
      status: 'PROCESSING',
      uploadedBy: memberAll.id,
      uploadedByName: memberAll.name,
    },
  })

  assert.equal(isCommentVisibleToClients({ visibility: 'INTERNAL' }, null), false)
  assert.equal(isCommentVisibleToClients({ visibility: 'PUBLIC' }, { visibility: 'INTERNAL' }), false)
  assert.equal(isCommentVisibleToClients({ visibility: 'PUBLIC' }, { visibility: 'PUBLIC' }), true)

  const videoReadyResult = await emitVideoReadyInAppNotification(videoA.id)
  assert.equal(videoReadyResult.recipients, 3, 'video READY should reach all viewers except the uploader')

  // 1b. Local-FFmpeg fallback finalizeVideo must reach the feed too, and a
  // second path must not duplicate rows (dedupeKey video+recipient).
  await finalizeVideo(fallbackV1.id, {}, null, fallbackMetadata)
  const fallbackV1Rows = await waitForNotificationCount(
    { teamId: teamA.id, videoId: fallbackV1.id, eventType: 'VIDEO_UPLOADED' },
    3,
  )
  assert.equal(fallbackV1Rows, 3, 'fallback finalize should emit VIDEO_UPLOADED once per viewer')
  const fallbackV1Replay = await emitVideoReadyInAppNotification(fallbackV1.id)
  assert.equal(fallbackV1Replay.insertedEvents, 0, 'replayed READY must be a no-op')
  assert.equal(
    await prisma.userNotification.count({ where: { teamId: teamA.id, videoId: fallbackV1.id } }),
    3,
    'replayed READY must not add rows',
  )

  await finalizeVideo(fallbackV2.id, {}, null, fallbackMetadata)
  const fallbackV2Rows = await waitForNotificationCount(
    { teamId: teamA.id, videoId: fallbackV2.id, eventType: 'VIDEO_VERSION' },
    3,
  )
  assert.equal(fallbackV2Rows, 3, 'fallback finalize should emit VIDEO_VERSION once per viewer')

  const clientTop = await prisma.comment.create({
    data: {
      projectId: projectA.id,
      videoId: videoA.id,
      timecode: '00:00:01:00',
      content: 'Client top-level comment',
      authorName: 'Gate0 Client',
      authorEmail: `gate0-client-${suffix}@example.test`,
      isInternal: false,
      visibility: 'PUBLIC',
    },
  })

  const memberTop = await prisma.comment.create({
    data: {
      projectId: projectA.id,
      videoId: videoA.id,
      timecode: '00:00:02:00',
      content: 'Member top-level comment',
      authorName: memberAll.name,
      userId: memberAll.id,
      isInternal: true,
      visibility: 'PUBLIC',
    },
  })

  const ownerTop = await prisma.comment.create({
    data: {
      projectId: projectA.id,
      videoId: videoA.id,
      timecode: '00:00:03:00',
      content: 'Owner top-level comment',
      authorName: owner.name,
      userId: owner.id,
      isInternal: true,
      visibility: 'PUBLIC',
    },
  })

  const reply = await prisma.comment.create({
    data: {
      projectId: projectA.id,
      videoId: videoA.id,
      timecode: '00:00:04:00',
      content: 'Owner replies to member',
      authorName: owner.name,
      userId: owner.id,
      isInternal: true,
      visibility: 'PUBLIC',
      parentId: memberTop.id,
    },
  })

  // 1. Client top-level comment: all ACTIVE viewers, actor is not a team user.
  const clientResult = await emitCommentInAppNotifications({ comment: clientTop, mentionedUserIds: [] })
  assert.equal(clientResult.recipients, 4, 'client comment should reach owner/admin/memberAll/memberAssigned')

  const clientRows = await prisma.userNotification.findMany({
    where: { teamId: teamA.id, commentId: clientTop.id },
    select: { recipientUserId: true, eventType: true, category: true },
  })
  assert.deepEqual(
    new Set(clientRows.map((row) => row.recipientUserId)),
    new Set([owner.id, admin.id, memberAll.id, memberAssigned.id]),
    'client comment recipient set',
  )
  assert.equal(clientRows.every((row) => row.eventType === 'COMMENT_NEW'), true)
  assert.equal(clientRows.some((row) => row.recipientUserId === disabled.id), false)
  assert.equal(clientRows.some((row) => row.recipientUserId === memberUnassigned.id), false)
  assert.equal(clientRows.some((row) => row.recipientUserId === teamBUser.id), false)

  // 2. Owner's comment: actor excluded, valid mention only, non-viewer mention dropped.
  const ownerResult = await emitCommentInAppNotifications({
    comment: ownerTop,
    mentionedUserIds: [memberAll.id, memberAssigned.id, teamBUser.id, memberUnassigned.id],
  })
  assert.equal(ownerResult.recipients, 3, 'owner comment should reach admin + memberAll + memberAssigned')
  const ownerRows = await prisma.userNotification.findMany({
    where: { teamId: teamA.id, commentId: ownerTop.id },
    select: { recipientUserId: true, eventType: true },
  })
  assert.equal(ownerRows.some((row) => row.recipientUserId === owner.id), false, 'actor excluded')
  assert.equal(ownerRows.some((row) => row.recipientUserId === admin.id), true)
  assert.equal(ownerRows.find((row) => row.recipientUserId === memberAll.id)?.eventType, 'COMMENT_MENTION')
  assert.equal(ownerRows.some((row) => row.recipientUserId === teamBUser.id), false)
  assert.equal(ownerRows.some((row) => row.recipientUserId === memberUnassigned.id), false)

  // 3. Reply: only the parent author gets a personal row.
  const replyResult = await emitCommentInAppNotifications({ comment: reply, mentionedUserIds: [] })
  assert.equal(replyResult.recipients, 1, 'reply should reach only the parent author')
  const replyRows = await prisma.userNotification.findMany({
    where: { teamId: teamA.id, commentId: reply.id },
    select: { recipientUserId: true, eventType: true, category: true },
  })
  assert.equal(replyRows.length, 1)
  assert.equal(replyRows[0].recipientUserId, memberAll.id)
  assert.equal(replyRows[0].eventType, 'COMMENT_REPLY')
  assert.equal(replyRows[0].category, 'MENTION')

  // 4. Client upload batch: one aggregate row per viewer, count 2.
  await emitClientUploadInAppNotification({
    projectId: projectA.id,
    fileName: `a-${suffix}.mp4`,
    uploaderName: 'Gate0 Client',
    uploaderEmail: `gate0-client-${suffix}@example.test`,
    uploadId: `upload-1-${suffix}`,
  })
  await emitClientUploadInAppNotification({
    projectId: projectA.id,
    fileName: `b-${suffix}.mp4`,
    uploaderName: 'Gate0 Client',
    uploaderEmail: `gate0-client-${suffix}@example.test`,
    uploadId: `upload-2-${suffix}`,
  })
  const uploadRows = await prisma.userNotification.findMany({
    where: {
      teamId: teamA.id,
      eventType: 'CLIENT_UPLOAD',
      recipientUserId: admin.id,
    },
  })
  assert.equal(uploadRows.length, 1, 'two files should aggregate into one row')
  assert.equal(uploadRows[0].aggregateCount, 2)
  assert.match(uploadRows[0].title, /2 个文件/)
  const payload = uploadRows[0].payload as { fileNames?: string[] } | null
  assert.equal(Array.isArray(payload?.fileNames) && payload.fileNames.length === 2, true)

  // 4b. Concurrent emits for the same aggregate key must all land. This is the
  // regression for the P2002 rollback: 5 files, one row, count 5, 5 events.
  const raceEmail = `gate0-race-${suffix}@example.test`
  const raceResults = await Promise.all(Array.from({ length: 5 }, (_, index) =>
    emitClientUploadInAppNotification({
      projectId: projectA.id,
      fileName: `race-${index + 1}.mov`,
      uploaderName: 'Gate0 Race Client',
      uploaderEmail: raceEmail,
      uploadId: `race-${suffix}-${index + 1}`,
    }),
  ))
  assert.equal(
    raceResults.every((result) => result.insertedEvents > 0),
    true,
    `concurrent emits lost events: ${JSON.stringify(raceResults)}`,
  )
  const raceRows = await prisma.userNotification.findMany({
    where: {
      teamId: teamA.id,
      recipientUserId: admin.id,
      actorName: 'Gate0 Race Client',
      eventType: 'CLIENT_UPLOAD',
    },
  })
  assert.equal(raceRows.length, 1, 'concurrent files must share one aggregate row')
  assert.equal(raceRows[0].aggregateCount, 5)
  const racePayload = raceRows[0].payload as { fileNames?: string[] } | null
  assert.equal(Array.isArray(racePayload?.fileNames) && racePayload.fileNames.length === 5, true)
  const raceEventCount = await prisma.userNotificationEvent.count({
    where: {
      teamId: teamA.id,
      recipientUserId: admin.id,
      dedupeKey: { startsWith: 'CLIENT_UPLOAD:race-' },
    },
  })
  assert.equal(raceEventCount, 5, 'all five concurrent events must be persisted')

  // 4c. Reopening a read aggregate resets count and fileNames together.
  const reopenEmail = `gate0-reopen-${suffix}@example.test`
  await emitClientUploadInAppNotification({
    projectId: projectA.id,
    fileName: 'reopen-first.mov',
    uploaderName: 'Gate0 Reopen Client',
    uploaderEmail: reopenEmail,
    uploadId: `reopen-1-${suffix}`,
  })
  await emitClientUploadInAppNotification({
    projectId: projectA.id,
    fileName: 'reopen-second.mov',
    uploaderName: 'Gate0 Reopen Client',
    uploaderEmail: reopenEmail,
    uploadId: `reopen-2-${suffix}`,
  })
  const reopenRow = await prisma.userNotification.findFirstOrThrow({
    where: {
      teamId: teamA.id,
      recipientUserId: admin.id,
      actorName: 'Gate0 Reopen Client',
      eventType: 'CLIENT_UPLOAD',
    },
  })
  assert.equal(reopenRow.aggregateCount, 2)
  await markNotificationsRead({ userId: admin.id, teamId: teamA.id, ids: [reopenRow.id] })
  await emitClientUploadInAppNotification({
    projectId: projectA.id,
    fileName: 'reopen-third.mov',
    uploaderName: 'Gate0 Reopen Client',
    uploaderEmail: reopenEmail,
    uploadId: `reopen-3-${suffix}`,
  })
  const reopened = await prisma.userNotification.findUniqueOrThrow({ where: { id: reopenRow.id } })
  assert.equal(reopened.readAt, null, 'reopened aggregate must be unread')
  assert.equal(reopened.aggregateCount, 1, 'reopened aggregate count must reset')
  assert.equal(reopened.title, 'Gate0 Reopen Client 上传了文件')
  const reopenedPayload = reopened.payload as { fileNames?: string[] } | null
  assert.deepEqual(reopenedPayload?.fileNames, ['reopen-third.mov'])

  // 5. Approval: leads only (admin + explicit project member), actor excluded.
  const approvalResult = await emitApprovalInAppNotification({
    projectId: projectA.id,
    videoId: videoA.id,
    approved: true,
    isComplete: false,
    actorUserId: owner.id,
    actorName: owner.name,
    occurredAt: new Date(),
  })
  assert.equal(approvalResult.recipients, 2, 'approval should reach admin + project member only')
  const approvalRows = await prisma.userNotification.findMany({
    where: { teamId: teamA.id, eventType: 'VIDEO_APPROVED' },
    select: { recipientUserId: true },
  })
  assert.deepEqual(
    new Set(approvalRows.map((row) => row.recipientUserId)),
    new Set([admin.id, memberAssigned.id]),
    'approval recipient set',
  )
  assert.equal(approvalRows.some((row) => row.recipientUserId === owner.id), false)

  // 6. Due date: all viewers.
  const dueResult = await emitDueDateInAppNotification({
    projectId: projectA.id,
    dueDate: new Date(Date.now() + 86400000),
    reminderType: 'tomorrow',
    dayKey: `gate0-${suffix}`,
  })
  assert.equal(dueResult.recipients, 4, 'due date should reach all project viewers')

  // 7. Server read state and cross-team isolation.
  const feedBefore = await getNotificationFeed({ userId: admin.id, teamId: teamA.id })
  assert.equal(feedBefore.unread.total > 0, true)
  const updated = await markNotificationsRead({ userId: admin.id, teamId: teamA.id, all: true })
  assert.equal(updated > 0, true)
  const feedAfter = await getNotificationFeed({ userId: admin.id, teamId: teamA.id })
  assert.equal(feedAfter.unread.total, 0)
  const crossTeam = await getNotificationFeed({ userId: teamBUser.id, teamId: teamA.id })
  assert.equal(crossTeam.items.length, 0, 'team B user must not read team A feed')

  // End-to-end HTTP: signed admin token + x-team-id against the local dev server.
  issuedTokens = await issueAdminTokens({
    id: memberAssigned.id,
    email: memberAssigned.email,
    name: memberAssigned.name,
    role: memberAssigned.role,
  })
  const headers = {
    Authorization: `Bearer ${issuedTokens.accessToken}`,
    'x-team-id': teamA.id,
  }
  const feedResponse = await getNotifications(new NextRequest('http://localhost/api/notifications?category=TEAM&filter=all&limit=50', { headers }))
  assert.equal(feedResponse.status, 200, `GET /api/notifications status ${feedResponse.status}`)
  const feedJson = await feedResponse.json() as { items: unknown[]; unread: { total: number } }
  assert.equal(Array.isArray(feedJson.items) && feedJson.items.length > 0, true)
  assert.equal(feedJson.unread.total > 0, true)

  const readResponse = await markRead(new NextRequest('http://localhost/api/notifications/read', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ all: true, category: 'TEAM' }),
  }))
  assert.equal(readResponse.status, 200, `POST /api/notifications/read status ${readResponse.status}`)
  const unreadAfterResponse = await getNotifications(new NextRequest('http://localhost/api/notifications?category=TEAM&filter=unread&limit=50', { headers }))
  const unreadAfterJson = await unreadAfterResponse.json() as { items: unknown[] }
  assert.equal(unreadAfterJson.items.length, 0, 'server unread must be zero after all-read')

  const crossResponse = await getNotifications(new NextRequest('http://localhost/api/notifications?category=TEAM', {
    headers: { ...headers, 'x-team-id': teamB.id },
  }))
  assert.equal(crossResponse.status, 403, 'team B header must be rejected for a team A user')

  // 8. Idempotency: replaying the same comment does not create another row.
  const beforeReplay = await prisma.userNotification.count({
    where: { teamId: teamA.id, commentId: clientTop.id },
  })
  await emitCommentInAppNotifications({ comment: clientTop, mentionedUserIds: [] })
  const afterReplay = await prisma.userNotification.count({
    where: { teamId: teamA.id, commentId: clientTop.id },
  })
  assert.equal(afterReplay, beforeReplay, 'replayed event must stay idempotent')

  const finalNotificationIds = (await prisma.userNotification.findMany({
    where: { teamId: teamA.id },
    select: { id: true },
  })).map((row) => row.id)
  console.log(JSON.stringify({
    ok: true,
    teamAId,
    teamBId,
    projectAId: projectA.id,
    notificationCount: finalNotificationIds.length,
    eventCount: await prisma.userNotificationEvent.count({ where: { teamId: teamA.id } }),
    deliveryCount: await prisma.userNotificationDelivery.count({ where: { notificationId: { in: finalNotificationIds } } }),
    sequentialUpload: {
      aggregateCount: uploadRows[0].aggregateCount,
      fileNames: payload?.fileNames,
    },
    race: {
      perCall: raceResults.map((result) => ({
        insertedEvents: result.insertedEvents,
        writtenNotifications: result.writtenNotifications,
      })),
      rowCount: raceRows.length,
      aggregateCount: raceRows[0].aggregateCount,
      fileNames: racePayload?.fileNames,
      eventCount: raceEventCount,
    },
    reopen: {
      aggregateCount: reopened.aggregateCount,
      fileNames: reopenedPayload?.fileNames,
      title: reopened.title,
    },
    fallback: {
      v1Rows: fallbackV1Rows,
      v2Rows: fallbackV2Rows,
    },
  }, null, 2))
}

async function cleanup() {
  if (issuedTokens) {
    await revokePresentedTokens({
      accessToken: issuedTokens.accessToken,
      refreshToken: issuedTokens.refreshToken,
    }).catch(() => {})
  }
  const teamIds = [teamAId, teamBId]
  const notificationIds = (await prisma.userNotification.findMany({
    where: { teamId: { in: teamIds } },
    select: { id: true },
  })).map((row) => row.id)
  await prisma.userNotificationDelivery.deleteMany({
    where: { notificationId: { in: notificationIds } },
  }).catch(() => {})
  await prisma.userNotification.deleteMany({ where: { teamId: { in: teamIds } } }).catch(() => {})
  await prisma.userNotificationEvent.deleteMany({ where: { teamId: { in: teamIds } } }).catch(() => {})
  await prisma.projectMember.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {})
  await prisma.comment.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {})
  await prisma.video.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {})
  await prisma.project.deleteMany({ where: { teamId: { in: teamIds } } }).catch(() => {})
  await prisma.teamMember.deleteMany({ where: { teamId: { in: teamIds } } }).catch(() => {})
  await prisma.team.deleteMany({ where: { id: { in: teamIds } } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {})
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await cleanup()
    await prisma.$disconnect()
    console.log('gate0 test data cleaned')
    process.exit(process.exitCode || 0)
  })
