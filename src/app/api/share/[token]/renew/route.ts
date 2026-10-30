import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { rateLimit } from '@/lib/rate-limit'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import { getRateLimitSettings, getShareTokenTtlSeconds } from '@/lib/settings'
import {
  parseBearerToken,
  signShareToken,
  verifyShareTokenForRenewal,
  type ShareTokenFailure,
} from '@/lib/auth'
import { revokeShareSession } from '@/lib/session-invalidation'
import { revokeToken } from '@/lib/token-revocation'
import {
  isShareLinkActive,
  linkPermissions,
  resolveShareMetadata,
  shareAuthFingerprint,
  sharePolicyFingerprint,
} from '@/lib/share-links'
import { SHARE_ERROR_CODES } from '@/lib/share-error-codes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function failureResponse(failure: ShareTokenFailure, message: string) {
  return NextResponse.json({ error: message, code: failure.code }, { status: 401 })
}

/**
 * Trade a dead viewer bearer for one minted under the current policy.
 *
 * The expired bearer is the proof of the session; its link, auth stamp and
 * session id are all re-checked, and a permission edit is picked up here
 * instead of waiting for the old credential to lapse.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const shareMessages = messages?.share
  const { shareSessionRateLimit } = await getRateLimitSettings().catch(() => ({ shareSessionRateLimit: 300 }))
  const { token } = await params

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: shareSessionRateLimit || 300,
    message: shareMessages?.tooManyRequestsGeneric || 'Too many requests. Please try again later.',
  }, `share-renew:${token}`)
  if (limited) return limited

  const bearer = parseBearerToken(request, 'x-share-token') || parseBearerToken(request)
  if (!bearer) {
    return NextResponse.json(
      { error: shareMessages?.authenticationRequired || 'Authentication required', code: SHARE_ERROR_CODES.AUTH_REQUIRED },
      { status: 401 },
    )
  }

  const verified = await verifyShareTokenForRenewal(bearer)
  if (!verified.payload) {
    return failureResponse(
      verified.failure,
      shareMessages?.sessionExpiredRefresh || 'Session expired. Please refresh the page.',
    )
  }

  const payload = verified.payload
  if (payload.shareId !== token) {
    return NextResponse.json(
      { error: shareMessages?.accessDenied || 'Access denied', code: SHARE_ERROR_CODES.TOKEN_SCOPE_MISMATCH },
      { status: 401 },
    )
  }

  const resolved = await resolveShareMetadata(token)
  if (!resolved.policy || !resolved.project) {
    return NextResponse.json(
      { error: shareMessages?.sessionExpiredRefresh || 'Session expired. Please refresh the page.', code: SHARE_ERROR_CODES.LINK_MISSING },
      { status: 401 },
    )
  }
  if (!isShareLinkActive(resolved.policy)) {
    return NextResponse.json(
      { error: shareMessages?.linkInvalid || 'This share link is no longer active', code: SHARE_ERROR_CODES.LINK_INACTIVE },
      { status: 410 },
    )
  }

  // A changed password or auth mode invalidates the proof the old bearer
  // carries; the visitor has to clear that gate again rather than renew
  // straight past it.
  const currentAuth = shareAuthFingerprint(resolved.policy)
  if (payload.authFingerprint ? payload.authFingerprint !== currentAuth : resolved.policy.authMode !== 'NONE') {
    return NextResponse.json(
      { error: shareMessages?.sessionExpiredOrInvalid || 'Session expired or invalid. Please authenticate again.', code: SHARE_ERROR_CODES.AUTH_CHANGED },
      { status: 401 },
    )
  }

  if (payload.guest && !resolved.project.guestMode) {
    return NextResponse.json(
      { error: shareMessages?.sessionExpiredRefresh || 'Session expired. Please refresh the page.', code: SHARE_ERROR_CODES.TOKEN_REVOKED },
      { status: 401 },
    )
  }

  const ttlSeconds = await getShareTokenTtlSeconds()
  const permissions = payload.guest ? ['view'] : linkPermissions(resolved.policy)

  // Rotation is single-use: the dead bearer may mint exactly one replacement.
  // Blacklist that bearer itself. NONE links use a deterministic session shared
  // by every token for this link + address; revoking it would make every later
  // no-token token 401. Only per-token (non-NONE) sessions are retired.
  const retirementTtl = 365 * 24 * 60 * 60
  await revokeToken(bearer, retirementTtl)
  if (payload.sessionId && !payload.sessionId.startsWith('none:')) {
    await revokeShareSession(payload.sessionId, retirementTtl)
  }

  const shareToken = signShareToken({
    shareId: token,
    projectId: resolved.project.id,
    permissions,
    guest: Boolean(payload.guest),
    sessionId: crypto.randomBytes(16).toString('base64url'),
    recipientId: payload.recipientId,
    authMode: resolved.policy.authMode,
    adminOverride: payload.adminOverride,
    policyFingerprint: sharePolicyFingerprint(resolved.policy, resolved.project) ?? undefined,
    authFingerprint: currentAuth ?? undefined,
    ttlSeconds,
  })

  return NextResponse.json({
    success: true,
    shareToken,
    permissions,
    expiresAt: Date.now() + ttlSeconds * 1000,
  })
}
