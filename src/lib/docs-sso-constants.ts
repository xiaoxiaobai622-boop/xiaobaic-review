// Client-safe SSO constants. Kept out of `docs-sso.ts` so the authorize page can
// import the redirect whitelist without pulling `node:crypto`/Prisma into the
// browser bundle.
export const DOCS_SSO_REDIRECT_URI = 'https://docs.vidx.cn/auth/callback'
export const DOCS_SSO_TTL_MS = 60_000
