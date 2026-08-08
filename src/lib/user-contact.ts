const PHONE_ONLY_EMAIL_DOMAIN = 'phone.local'

export function createPhoneOnlyEmail(phone: string): string {
  return `phone-${phone}@${PHONE_ONLY_EMAIL_DOMAIN}`
}

export function isPhoneOnlyEmail(email: string | null | undefined): boolean {
  return Boolean(email?.endsWith(`@${PHONE_ONLY_EMAIL_DOMAIN}`))
}

export function getDisplayEmail(email: string | null | undefined): string {
  return isPhoneOnlyEmail(email) ? '' : (email || '')
}
