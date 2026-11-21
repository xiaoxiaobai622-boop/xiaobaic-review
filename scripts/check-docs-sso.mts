/**
 * Live check for the docs site SSO code exchange. Requires `npm run dev -- -p 3010`
 * and the repo's env pattern:
 *
 *   BASE_URL=http://localhost:3010 npm run check:docs-sso
 *   BASE_URL=http://localhost:3010 node --env-file=.env --import tsx scripts/check-docs-sso.mts
 *
 * Set DOCS_API_BASE to also verify the project-document teamId backfill.
 */
import { prisma } from '../src/lib/db'
import {
  DocsSsoValidationError,
  describeSsoCodeError,
  hashSsoCode,
} from '../src/lib/docs-sso'

const BASE = process.env.BASE_URL || 'http://localhost:3000'
const DEVICE = 'docs-sso-check-device'
const phone = process.env.ADMIN_PHONE!
const password = process.env.ADMIN_PASSWORD!
const state = 'check-state-1234567890'
const redirectUri = 'https://docs.vidx.cn/auth/callback'

async function json(url: string, init?: RequestInit) {
  const res = await fetch(url, init)
  const body = await res.json().catch(() => ({}))
  return { res, body }
}

function exchangeRequest(code: string, codeState: string, origin: string | null = 'https://docs.vidx.cn') {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-ViTransfer-Device-ID': DEVICE,
  }
  if (origin) headers.Origin = origin
  return json(`${BASE}/api/auth/sso/exchange`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ code, state: codeState }),
  })
}

// --- Error mapping (no mocks) -------------------------------------------------
// The route maps failures through `describeSsoCodeError`, so asserting the pure
// function covers the wire contract without standing up a failing DB or mocking
// the route: validation stays 400 + its message, everything else is 500 + generic.
const validationFailure = describeSsoCodeError(new DocsSsoValidationError('invalid state'))
if (validationFailure.status !== 400 || validationFailure.body.error !== 'invalid state') {
  throw new Error(`validation error should stay 400/invalid state, got ${validationFailure.status}`)
}

const internalDetail = 'PrismaClientKnownRequestError: connect ECONNREFUSED 127.0.0.1:5432 password=supersecret'
const internalFailure = describeSsoCodeError(new Error(internalDetail))
if (internalFailure.status !== 500) throw new Error(`internal error should be 500, got ${internalFailure.status}`)
const internalWire = JSON.stringify(internalFailure.body)
if (internalWire.includes('Prisma') || internalWire.includes('supersecret') || internalWire.includes(internalDetail)) {
  throw new Error('internal error response leaks details')
}

// --- Live flow ----------------------------------------------------------------
const login = await json(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-ViTransfer-Device-ID': DEVICE },
  body: JSON.stringify({ email: phone, password }),
})
if (!login.res.ok) throw new Error(`login failed: ${login.res.status}`)
const access = login.body.tokens.accessToken as string

async function issueCode(label: string) {
  const result = await json(`${BASE}/api/auth/sso/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` },
    body: JSON.stringify({ redirectUri, state }),
  })
  if (result.res.status !== 200 || !result.body.code) {
    throw new Error(`${label} code failed: ${result.res.status} ${JSON.stringify(result.body)}`)
  }
  return result.body.code as string
}

// All codes are issued before the first exchange: exchanging revokes the site
// session for this device, so the access token above is no longer usable after.
const successCode = await issueCode('success')
const originCode = await issueCode('origin')
const stateCode = await issueCode('state')
const expiredCode = await issueCode('expired')

// Wrong state must be rejected without consuming the code: the same code still
// redeems with the correct state afterwards.
const wrongState = await exchangeRequest(stateCode, 'check-state-0000000000')
if (wrongState.res.status !== 401) throw new Error(`wrong state should be 401, got ${wrongState.res.status}`)

const afterWrongState = await exchangeRequest(stateCode, state)
if (afterWrongState.res.status !== 200) {
  throw new Error(`wrong state burned the code: ${afterWrongState.res.status} ${JSON.stringify(afterWrongState.body)}`)
}
if (!afterWrongState.body.tokens?.accessToken) throw new Error('after-wrong-state exchange missing tokens')

// Expiry: push expiresAt into the past, then the code must be rejected.
await prisma.docsSsoCode.update({
  where: { codeHash: hashSsoCode(expiredCode) },
  data: { expiresAt: new Date(Date.now() - 60_000) },
})
const expired = await exchangeRequest(expiredCode, state)
if (expired.res.status !== 401) throw new Error(`expired code should be 401, got ${expired.res.status}`)

const exchange = await exchangeRequest(successCode, state)
if (exchange.res.status !== 200) throw new Error(`exchange failed: ${exchange.res.status} ${JSON.stringify(exchange.body)}`)
if (!exchange.body.tokens?.accessToken) throw new Error('exchange missing tokens')
if (!Array.isArray(exchange.body.teams) || exchange.body.teams.length === 0) throw new Error('exchange missing teams')

const reuse = await exchangeRequest(successCode, state)
if (reuse.res.status !== 401) throw new Error(`code reuse should be 401, got ${reuse.res.status}`)

// Spec §5: only https://docs.vidx.cn may redeem a code. A POST without the
// allowed Origin must be rejected, and the rejection must not consume the code.
const noOrigin = await exchangeRequest(originCode, state, null)
if (noOrigin.res.status !== 403) throw new Error(`exchange without Origin should be 403, got ${noOrigin.res.status}`)

const foreignOrigin = await exchangeRequest(originCode, state, 'https://docs.vidx.cn.evil.example')
if (foreignOrigin.res.status !== 403) throw new Error(`exchange with foreign Origin should be 403, got ${foreignOrigin.res.status}`)

const afterRejection = await exchangeRequest(originCode, state)
if (afterRejection.res.status !== 200) throw new Error(`rejected exchange consumed the code: ${afterRejection.res.status}`)

// --- Team-scoped docs tokens (Task 2) ----------------------------------------
// Every exchange registers a new session for this device and revokes the
// previous one, so the last successful exchange is the live access token.
const exchangeAccess = afterRejection.body.tokens.accessToken as string
const exchangeUserId = afterRejection.body.user.id as string
const team = afterRejection.body.teams[0] as { id: string; name: string }
const docsOrigin = 'https://docs.vidx.cn'

function tokenPayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString())
}

// Pick a project the token route's authorization accepts, so the project-token
// check proves team derivation rather than accidentally landing on a 403.
const membership = await prisma.teamMember.findUnique({
  where: { teamId_userId: { teamId: team.id, userId: exchangeUserId } },
  select: { role: true, projectAccessScope: true },
})
const project = await prisma.project.findFirst({
  where: {
    teamId: team.id,
    OR: [{ restricted: false }, { members: { some: { userId: exchangeUserId } } }],
    ...(membership?.role === 'MEMBER' && membership.projectAccessScope === 'ASSIGNED_ONLY'
      ? { members: { some: { userId: exchangeUserId } } }
      : {}),
  },
  select: { id: true },
})
if (!project) throw new Error('docs token check needs an accessible project in the first team')

const teamToken = await json(`${BASE}/api/docs/token?teamId=${encodeURIComponent(team.id)}&purpose=api`, {
  headers: { Authorization: `Bearer ${exchangeAccess}`, 'X-Team-Id': team.id, Origin: docsOrigin },
})
if (teamToken.res.status !== 200 || !teamToken.body.token) {
  throw new Error(`team docs token failed: ${teamToken.res.status} ${JSON.stringify(teamToken.body)}`)
}
if (tokenPayload(teamToken.body.token).teamId !== team.id) throw new Error('team token missing teamId')
if (teamToken.res.headers.get('access-control-allow-origin') !== docsOrigin) {
  throw new Error('team docs token missing docs CORS header')
}
console.log('team docs token check passed')

// Project page regression: projectId alone still works and derives teamId.
const projectToken = await json(`${BASE}/api/docs/token?projectId=${encodeURIComponent(project.id)}&purpose=api`, {
  headers: { Authorization: `Bearer ${exchangeAccess}`, 'X-Team-Id': team.id },
})
if (projectToken.res.status !== 200 || !projectToken.body.token) {
  throw new Error(`project docs token failed: ${projectToken.res.status} ${JSON.stringify(projectToken.body)}`)
}
const projectPayload = tokenPayload(projectToken.body.token)
if (projectPayload.teamId !== team.id) {
  throw new Error(`project token should derive teamId ${team.id}, got ${String(projectPayload.teamId)}`)
}
if (projectPayload.projectId !== project.id) throw new Error('project token missing projectId')
console.log('project docs token check passed')

const bogusTeamId = `check-no-team-${Date.now()}`
const bogusTeam = await json(`${BASE}/api/docs/token?teamId=${encodeURIComponent(bogusTeamId)}&purpose=api`, {
  headers: { Authorization: `Bearer ${exchangeAccess}`, Origin: docsOrigin },
})
if (bogusTeam.res.status !== 403) throw new Error(`bogus team token should be 403, got ${bogusTeam.res.status}`)
if (bogusTeam.res.headers.get('access-control-allow-origin') !== docsOrigin) {
  throw new Error('docs token error response missing docs CORS header')
}

const foreignTeam = await prisma.team.findFirst({
  where: { id: { not: team.id }, members: { none: { userId: exchangeUserId } } },
  select: { id: true },
})
if (foreignTeam) {
  const nonMember = await json(`${BASE}/api/docs/token?teamId=${encodeURIComponent(foreignTeam.id)}&purpose=api`, {
    headers: { Authorization: `Bearer ${exchangeAccess}` },
  })
  if (nonMember.res.status !== 403) throw new Error(`non-member team token should be 403, got ${nonMember.res.status}`)
}
console.log('non-member team token check passed')

// Query teamId wins over nothing: a valid project plus another team must not
// mint a token for either side.
const mismatchTeamId = foreignTeam?.id || bogusTeamId
const mismatch = await json(
  `${BASE}/api/docs/token?teamId=${encodeURIComponent(mismatchTeamId)}&projectId=${encodeURIComponent(project.id)}&purpose=api`,
  { headers: { Authorization: `Bearer ${exchangeAccess}`, 'X-Team-Id': team.id } },
)
if (mismatch.res.status !== 403) throw new Error(`project/team mismatch should be 403, got ${mismatch.res.status}`)
if (mismatch.body.error !== '项目与团队不匹配') throw new Error(`unexpected mismatch error: ${JSON.stringify(mismatch.body)}`)
console.log('project/team mismatch check passed')

const preflight = await fetch(`${BASE}/api/docs/token`, {
  method: 'OPTIONS',
  headers: {
    Origin: docsOrigin,
    'Access-Control-Request-Method': 'GET',
    'Access-Control-Request-Headers': 'authorization,x-team-id',
  },
})
if (preflight.status !== 204) throw new Error(`docs token preflight should be 204, got ${preflight.status}`)
const allowedHeaders = (preflight.headers.get('access-control-allow-headers') || '').toLowerCase()
if (!allowedHeaders.includes('x-team-id')) throw new Error(`docs token preflight should allow X-Team-Id, got ${allowedHeaders}`)

const refreshPreflight = await fetch(`${BASE}/api/auth/refresh`, {
  method: 'OPTIONS',
  headers: {
    Origin: docsOrigin,
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'authorization,x-vitransfer-device-id',
  },
})
if (refreshPreflight.status !== 204) throw new Error(`refresh preflight should be 204, got ${refreshPreflight.status}`)
if (refreshPreflight.headers.get('access-control-allow-origin') !== docsOrigin) {
  throw new Error('refresh preflight missing docs origin')
}

// The docs app must be able to read refresh failures, not just preflight them.
const refreshError = await fetch(`${BASE}/api/auth/refresh`, {
  method: 'POST',
  headers: { Origin: docsOrigin },
})
if (refreshError.status !== 401) throw new Error(`refresh without token should be 401, got ${refreshError.status}`)
if (refreshError.headers.get('access-control-allow-origin') !== docsOrigin) {
  throw new Error('refresh error response missing docs origin')
}
console.log('docs token CORS check passed')

// --- Project document teamId backfill (Task 5) --------------------------------
// Documents created from the project page predate team support, so docs-api
// needs the Project(id, teamId) mapping to make them visible to team views.
const docsApiBase = (process.env.DOCS_API_BASE || '').replace(/\/+$/, '')
if (docsApiBase) {
  const serviceSecret = process.env.DOCS_TOKEN_SECRET || process.env.JWT_SECRET
  if (!serviceSecret) {
    throw new Error('DOCS_API_BASE is set but DOCS_TOKEN_SECRET/JWT_SECRET is missing')
  }

  const projects = await prisma.project.findMany({ select: { id: true, teamId: true } })
  const projectTeams = new Map(projects.map((item) => [item.id, item.teamId]))

  async function backfill() {
    return json(`${docsApiBase}/api/admin/backfill-teams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceSecret}` },
      body: JSON.stringify({ projects }),
    })
  }

  const firstBackfill = await backfill()
  if (firstBackfill.res.status !== 200) {
    throw new Error(`docs backfill failed: ${firstBackfill.res.status} ${JSON.stringify(firstBackfill.body)}`)
  }
  if (typeof firstBackfill.body.updated !== 'number') {
    throw new Error(`docs backfill response missing updated count: ${JSON.stringify(firstBackfill.body)}`)
  }

  const secondBackfill = await backfill()
  if (secondBackfill.res.status !== 200) {
    throw new Error(`docs backfill rerun failed: ${secondBackfill.res.status} ${JSON.stringify(secondBackfill.body)}`)
  }
  if (secondBackfill.body.updated !== 0) {
    throw new Error(`docs backfill is not idempotent: rerun updated ${String(secondBackfill.body.updated)}`)
  }

  const teamDocs = await json(`${docsApiBase}/api/docs?teamId=${encodeURIComponent(team.id)}`, {
    headers: { Authorization: `Bearer ${teamToken.body.token}` },
  })
  if (teamDocs.res.status !== 200) {
    throw new Error(`docs list for team failed: ${teamDocs.res.status} ${JSON.stringify(teamDocs.body)}`)
  }
  if (!Array.isArray(teamDocs.body.docs)) throw new Error('docs list response missing docs array')
  for (const doc of teamDocs.body.docs as Array<{ id: string; teamId: string | null; projectId: string | null }>) {
    if (!doc.projectId) continue
    if (doc.teamId !== team.id) {
      throw new Error(`doc ${doc.id} should carry teamId ${team.id}, got ${String(doc.teamId)}`)
    }
    const mappedTeamId = projectTeams.get(doc.projectId)
    if (mappedTeamId && mappedTeamId !== team.id) {
      throw new Error(`doc ${doc.id} project ${doc.projectId} belongs to team ${mappedTeamId}`)
    }
  }
  console.log('docs backfill check passed')
} else {
  console.log('docs backfill check skipped (DOCS_API_BASE unset)')
}

await prisma.$disconnect()
console.log('docs sso check passed')
