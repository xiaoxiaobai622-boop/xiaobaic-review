export const COMMENT_AUTHOR_NAME_MAX_LENGTH = 50

// Names are international text: letters, combining marks, numbers, spaces and
// Unicode punctuation (full-width brackets, middle dots, curly apostrophes).
// Markup delimiters and control characters stay out even when their Unicode
// category would otherwise qualify (`&` is punctuation).
const ALLOWED_AUTHOR_NAME = /^[\p{L}\p{M}\p{N}\p{Zs}\p{P}]+$/u
const FORBIDDEN_AUTHOR_NAME = /[<>&\u0000-\u001F\u007F]/u

export type CommentAuthorNameValidation =
  | { valid: true; name: string }
  | { valid: false; error: 'characters' | 'length' }

export function validateCommentAuthorName(rawName: string): CommentAuthorNameValidation {
  const name = rawName.trim().normalize('NFC')

  if (!ALLOWED_AUTHOR_NAME.test(name) || FORBIDDEN_AUTHOR_NAME.test(name)) {
    return { valid: false, error: 'characters' }
  }

  if (name.length > COMMENT_AUTHOR_NAME_MAX_LENGTH) {
    return { valid: false, error: 'length' }
  }

  return { valid: true, name }
}
