import assert from 'node:assert/strict'
import { prisma } from '../src/lib/db'
import { hashPassword } from '../src/lib/encryption'
import { allocateTeamId } from '../src/lib/team-id'

/**
 * 手机号加密扩展只该重写 phone 字段，不能顺手把它旁边的 Date 也重建掉：
 *  - 写入 TeamInvite 的 expiresAt 必须仍然是 Date（线上 10-27 的 500 就是它变成 {}）。
 *  - 读出 User/TeamInvite 的 createdAt/expiresAt 必须仍然是 Date（API 会序列化成 ISO）。
 *  - phone 仍要落库为密文、读回明文，扩展原有的能力不能被这次修复弄丢。
 */
const stamp = Date.now()
const email = `phone-extension-${stamp}@example.invalid`
const phone = `132${String(stamp).slice(-8)}`
let userId: string | undefined
let teamId: string | undefined
let inviteId: string | undefined
try {
  const user = await prisma.user.create({
    data: { email, password: await hashPassword(`phone-${stamp}`), name: 'Phone Extension', phone },
  })
  userId = user.id

  const stored = await prisma.$queryRaw<Array<{ phone: string | null }>>`select "phone" from "User" where "id" = ${user.id}`
  assert.ok(stored[0]?.phone, 'phone must be persisted')
  assert.match(stored[0].phone, /^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/i, 'phone must be stored as ciphertext')

  const reread = await prisma.user.findUnique({ where: { id: user.id } })
  assert.equal(reread?.phone, phone, 'phone must read back decrypted')
  assert.ok(reread?.createdAt instanceof Date, `User.createdAt must stay a Date, got ${JSON.stringify(reread?.createdAt)}`)

  teamId = await prisma.$transaction(async tx => {
    const id = await allocateTeamId(tx)
    const team = await tx.team.create({ data: { id: id, name: `Phone ${stamp}`, slug: `ph${stamp}`, shareKey: `tm_ph_${stamp}`, createdById: user.id } })
    await tx.teamMember.create({ data: { teamId: team.id, userId: user.id, role: 'OWNER' } })
    return team.id
  })

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const invite = await prisma.teamInvite.create({
    data: { teamId, email: null, phone, role: 'ADMIN', createdById: user.id, token: `invite-${stamp}`, expiresAt },
  })
  inviteId = invite.id
  assert.ok(invite.expiresAt instanceof Date, `TeamInvite.expiresAt must stay a Date, got ${JSON.stringify(invite.expiresAt)}`)
  assert.equal(invite.expiresAt.getTime(), expiresAt.getTime())

  const inviteRead = await prisma.teamInvite.findUnique({ where: { id: invite.id } })
  assert.ok(inviteRead?.expiresAt instanceof Date, `TeamInvite.expiresAt must read back as a Date, got ${JSON.stringify(inviteRead?.expiresAt)}`)
  assert.ok(inviteRead?.createdAt instanceof Date, `TeamInvite.createdAt must read back as a Date, got ${JSON.stringify(inviteRead?.createdAt)}`)
  assert.equal(inviteRead?.phone, phone, 'invite phone must read back decrypted')

  console.log('PASS phone extension preserves Date fields and still encrypts phones')
} finally {
  if (inviteId) await prisma.teamInvite.delete({ where: { id: inviteId } }).catch(() => {})
  if (teamId) {
    await prisma.teamMember.deleteMany({ where: { teamId } }).catch(() => {})
    await prisma.teamQuota.deleteMany({ where: { teamId } }).catch(() => {})
    await prisma.team.delete({ where: { id: teamId } }).catch(() => {})
  }
  if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {})
  await prisma.$disconnect()
}
