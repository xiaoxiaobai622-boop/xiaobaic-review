import { hashPhone } from './phone-field'

const PHONE_ONLY_EMAIL_DOMAIN = 'phone.local'

/**
 * Placeholder mailbox for an account that only has a phone number. It must not carry the
 * number: that would move the plaintext into the email column and undo the encryption of the
 * phone column. The digest prefix is deterministic, so re-deriving it for the same number
 * yields the same address and the unique index behaves as it did before. `phone-` plus 40 hex
 * stays inside the 64-character local part.
 */
export function createPhoneOnlyEmail(phone: string): string {
  const digest = hashPhone(phone)
  if (!digest) throw new Error('无法生成占位邮箱：手机号无效')
  return `phone-${digest.slice(0, 40)}@${PHONE_ONLY_EMAIL_DOMAIN}`
}

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
