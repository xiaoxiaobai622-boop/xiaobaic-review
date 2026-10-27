/** Machine-readable reasons shared by the share APIs and the visitor client. */
export const SHARE_ERROR_CODES = {
  AUTH_REQUIRED: 'SHARE_AUTH_REQUIRED',
  TOKEN_EXPIRED: 'SHARE_TOKEN_EXPIRED',
  TOKEN_INVALID: 'SHARE_TOKEN_INVALID',
  TOKEN_REVOKED: 'SHARE_TOKEN_REVOKED',
  TOKEN_SCOPE_MISMATCH: 'SHARE_TOKEN_SCOPE_MISMATCH',
  POLICY_CHANGED: 'SHARE_POLICY_CHANGED',
  AUTH_CHANGED: 'SHARE_AUTH_CHANGED',
  LINK_INACTIVE: 'SHARE_LINK_INACTIVE',
  LINK_MISSING: 'SHARE_LINK_MISSING',
  PERMISSION_DENIED: 'SHARE_PERMISSION_DENIED',
  COMMENTS_DISABLED: 'SHARE_COMMENTS_DISABLED',
  GUEST_RESTRICTED: 'SHARE_GUEST_RESTRICTED',
  SCOPE_DENIED: 'SHARE_SCOPE_DENIED',
  UPLOAD_NOT_ALLOWED: 'SHARE_UPLOAD_NOT_ALLOWED',
  LOGIN_REQUIRED: 'SHARE_LOGIN_REQUIRED',
} as const

export type ShareErrorCode = (typeof SHARE_ERROR_CODES)[keyof typeof SHARE_ERROR_CODES]

/**
 * A dead bearer can be traded for a fresh one only when the session still
 * exists. Revocation and auth changes are terminal and must surface to the
 * visitor instead of spinning on a renewal that can never succeed.
 */
export const SHARE_RENEWABLE_CODES: ReadonlySet<string> = new Set([
  SHARE_ERROR_CODES.TOKEN_EXPIRED,
  SHARE_ERROR_CODES.POLICY_CHANGED,
])
