/**
 * Live check for the docs site SSO code exchange. Requires `npm run dev -- -p 3010`
 * and the repo's env pattern:
 *
 *   BASE_URL=http://localhost:3010 npm run check:docs-sso
 *   BASE_URL=http://localhost:3010 node --env-file=.env --import tsx scripts/check-docs-sso.mts
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

await prisma.$disconnect()
console.log('docs sso check passed')
