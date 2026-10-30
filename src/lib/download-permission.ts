export interface MediaDownloadGrant {
  isAdmin?: boolean
  /** Comment attachments uploaded by a client keep their download affordance. */
  isClientUploadedAsset?: boolean
  permissions?: string[] | null
}

/**
 * Download is a link permission, not a playback capability. Tokens minted
 * before this field existed therefore fail closed: they can still play, but
 * cannot turn into a download until the page mints a fresh token.
 */
export function canDownloadMedia(grant: MediaDownloadGrant): boolean {
  if (grant.isAdmin) return true
  if (grant.isClientUploadedAsset) return true
  return Array.isArray(grant.permissions) && grant.permissions.includes('download')
}
