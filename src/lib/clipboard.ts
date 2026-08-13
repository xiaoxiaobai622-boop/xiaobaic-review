'use client'

/**
 * Copies text in secure contexts and on HTTP LAN addresses where the modern
 * Clipboard API is unavailable.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text || typeof document === 'undefined') return false

  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to the legacy copy path.
    }
  }

  const activeElement = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null
  const selection = document.getSelection()
  const savedRanges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange())
    : []
  const textarea = document.createElement('textarea')

  textarea.value = text
  textarea.readOnly = true
  textarea.tabIndex = -1
  textarea.setAttribute('aria-hidden', 'true')
  Object.assign(textarea.style, {
    position: 'fixed',
    inset: '0 auto auto -9999px',
    width: '1px',
    height: '1px',
    opacity: '0',
    pointerEvents: 'none',
  })

  document.body.appendChild(textarea)
  textarea.focus({ preventScroll: true })
  textarea.select()
  textarea.setSelectionRange(0, textarea.value.length)

  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  } finally {
    textarea.remove()
    if (selection) {
      selection.removeAllRanges()
      savedRanges.forEach(range => selection.addRange(range))
    }
    activeElement?.focus({ preventScroll: true })
  }

  return copied
}
