/**
 * Live check for the docs site SSO code exchange. Requires `npm run dev -- -p 3010`
 * and the repo's env pattern:
 *
 *   BASE_URL=http://localhost:3010 node --env-file=.env --import tsx scripts/check-docs-sso.mts
 */
const BASE = process.env.BASE_URL || 'http://localhost:3000'
const DEVICE = 'docs-sso-check-device'
const phone = process.env.ADMIN_PHONE!
const password = process.env.ADMIN_PASSWORD!
const state = 'check-state-1234567890'

async function json(url: string, init?: RequestInit) {
  const res = await fetch(url, init)
  const body = await res.json().catch(() => ({}))
  return { res, body }
}

const login = await json(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-ViTransfer-Device-ID': DEVICE },
  body: JSON.stringify({ email: phone, password }),
})
if (!login.res.ok) throw new Error(`login failed: ${login.res.status}`)
const access = login.body.tokens.accessToken as string

const codeRes = await json(`${BASE}/api/auth/sso/code`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` },
  body: JSON.stringify({ redirectUri: 'https://docs.vidx.cn/auth/callback', state }),
})
if (codeRes.res.status !== 200 || !codeRes.body.code) throw new Error(`code failed: ${codeRes.res.status}`)

// Issued before the first exchange: exchanging revokes the site session for this
// device, so the access token above is no longer usable afterwards.
const originCode = await json(`${BASE}/api/auth/sso/code`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` },
  body: JSON.stringify({ redirectUri: 'https://docs.vidx.cn/auth/callback', state }),
})
if (originCode.res.status !== 200 || !originCode.body.code) throw new Error(`origin code failed: ${originCode.res.status}`)

const exchange = await json(`${BASE}/api/auth/sso/exchange`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-ViTransfer-Device-ID': DEVICE,
    Origin: 'https://docs.vidx.cn',
  },
  body: JSON.stringify({ code: codeRes.body.code, state }),
})
if (exchange.res.status !== 200) throw new Error(`exchange failed: ${exchange.res.status} ${JSON.stringify(exchange.body)}`)
if (!exchange.body.tokens?.accessToken) throw new Error('exchange missing tokens')
if (!Array.isArray(exchange.body.teams) || exchange.body.teams.length === 0) throw new Error('exchange missing teams')

const reuse = await json(`${BASE}/api/auth/sso/exchange`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-ViTransfer-Device-ID': DEVICE,
    Origin: 'https://docs.vidx.cn',
  },
  body: JSON.stringify({ code: codeRes.body.code, state }),
})
if (reuse.res.status !== 401) throw new Error(`code reuse should be 401, got ${reuse.res.status}`)

// Spec §5: only https://docs.vidx.cn may redeem a code. A POST without the
// allowed Origin must be rejected, and the rejection must not consume the code.
const noOrigin = await json(`${BASE}/api/auth/sso/exchange`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-ViTransfer-Device-ID': DEVICE },
  body: JSON.stringify({ code: originCode.body.code, state }),
})
if (noOrigin.res.status !== 403) throw new Error(`exchange without Origin should be 403, got ${noOrigin.res.status}`)

const foreignOrigin = await json(`${BASE}/api/auth/sso/exchange`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-ViTransfer-Device-ID': DEVICE,
    Origin: 'https://docs.vidx.cn.evil.example',
  },
  body: JSON.stringify({ code: originCode.body.code, state }),
})
if (foreignOrigin.res.status !== 403) throw new Error(`exchange with foreign Origin should be 403, got ${foreignOrigin.res.status}`)

const afterRejection = await json(`${BASE}/api/auth/sso/exchange`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-ViTransfer-Device-ID': DEVICE,
    Origin: 'https://docs.vidx.cn',
  },
  body: JSON.stringify({ code: originCode.body.code, state }),
})
if (afterRejection.res.status !== 200) throw new Error(`rejected exchange consumed the code: ${afterRejection.res.status}`)

console.log('docs sso check passed')
