/** Per-file cap for files attached to a comment. Independent of the larger video-upload setting. */
export const MAX_COMMENT_ATTACHMENT_BYTES = 5 * 1024 * 1024
export const MAX_COMMENT_ATTACHMENT_LABEL = '5 MB'

export function isCommentAttachmentTooLarge(size: number): boolean {
  return Number.isFinite(size) && size > MAX_COMMENT_ATTACHMENT_BYTES
}
