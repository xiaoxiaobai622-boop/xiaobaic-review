// Pure string shaping only: this module is imported by client components (StudioRail and
// friends read getContactEmail to label the signed-in user), so nothing here may reach
// src/lib/encryption.ts — that would ship the server's key validation into the browser bundle.

export const PHONE_ONLY_EMAIL_DOMAIN = 'phone.local'

export function isPhoneOnlyEmail(email: string | null | undefined): boolean {
  return Boolean(email?.endsWith(`@${PHONE_ONLY_EMAIL_DOMAIN}`))
}

export function getDisplayEmail(email: string | null | undefined): string {
  return isPhoneOnlyEmail(email) ? '' : (email || '')
}

const WECHAT_LOCAL_SUFFIX = '@wechat.local'

/**
 * Mailbox suitable for handing to another system. Accounts created from a
 * phone-only or WeChat scan carry a placeholder address, not a real mailbox.
 */
export function getContactEmail(email: string | null | undefined): string {
  if (isPhoneOnlyEmail(email) || email?.endsWith(WECHAT_LOCAL_SUFFIX)) return ''
  return email || ''
}
