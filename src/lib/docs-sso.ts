import crypto from 'node:crypto'
import { prisma } from '@/lib/db'

export { DOCS_SSO_REDIRECT_URI, DOCS_SSO_TTL_MS } from '@/lib/docs-sso-constants'
import { DOCS_SSO_REDIRECT_URI, DOCS_SSO_TTL_MS } from '@/lib/docs-sso-constants'

export function hashSsoCode(code: string) {
  return crypto.createHash('sha256').update(code).digest('base64url')
}

export async function createSsoCode(userId: string, state: string, redirectUri: string) {
  if (redirectUri !== DOCS_SSO_REDIRECT_URI) throw new Error('invalid redirect uri')
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(state)) throw new Error('invalid state')
  const code = crypto.randomBytes(32).toString('base64url')
  await prisma.docsSsoCode.create({
    data: {
      codeHash: hashSsoCode(code),
      userId,
      state,
      redirectUri,
      expiresAt: new Date(Date.now() + DOCS_SSO_TTL_MS),
    },
  })
  return code
}

export async function consumeSsoCode(code: string, state: string) {
  const codeHash = hashSsoCode(code)
  const record = await prisma.docsSsoCode.findUnique({ where: { codeHash } })
  if (!record || record.state !== state) return null
  if (record.usedAt || record.expiresAt.getTime() < Date.now()) return null
  const claimed = await prisma.docsSsoCode.updateMany({
    where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  })
  return claimed.count === 1 ? record : null
}
