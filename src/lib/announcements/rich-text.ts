import DOMPurify from 'isomorphic-dompurify'

/**
 * Article HTML is stored separately from the plain-text `content` excerpt.
 * Keep the allow-list to what the editor can produce: headings, inline
 * formatting, lists, quotes, links and inline images. Event handlers, styles,
 * frames and scripts never survive.
 */
const ARTICLE_TAGS = [
  'p', 'div', 'br',
  'h2', 'h3',
  'strong', 'b', 'em', 'i', 'u', 's',
  'ul', 'ol', 'li',
  'blockquote',
  'a', 'img',
  'hr', 'pre', 'code', 'span',
]

const ARTICLE_ATTRS = ['href', 'target', 'rel', 'src', 'alt', 'title']

export function sanitizeAnnouncementHtml(html: string | null | undefined): string | null {
  if (!html || !html.trim()) return null

  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ARTICLE_TAGS,
    ALLOWED_ATTR: ARTICLE_ATTRS,
    ALLOWED_URI_REGEXP: /^(?:(?:https?):|\/(?!\/))/i,
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    SAFE_FOR_TEMPLATES: true,
    FORCE_BODY: true,
  })

  // External article links open in a new tab; the href itself has already been
  // restricted to http(s) or a site-relative path by DOMPurify.
  const withSafeLinks = clean.replace(
    /<a\s+([^>]*?)href="([^"]*)"([^>]*?)>/gi,
    (match, before, href, after) => {
      if (!href.startsWith('/')) {
        return `<a ${before}href="${href}"${after} target="_blank" rel="noopener noreferrer">`
      }
      return match
    },
  )

  // A javascript:/data: src or href is removed by the URI allow-list, but the
  // inert empty tag would remain. Drop empty images and unwrap href-less links.
  const withoutEmptyImages = withSafeLinks.replace(/<img(?![^>]*\bsrc=)[^>]*>/gi, '')
  const withoutEmptyLinks = withoutEmptyImages.replace(/<a(?![^>]*\bhref=)[^>]*>([\s\S]*?)<\/a>/gi, '$1')

  return withoutEmptyLinks.trim() || null
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Old plain-text RELEASE rows stay editable as paragraphs instead of raw markup. */
export function plainTextToArticleHtml(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return ''
  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('')
}