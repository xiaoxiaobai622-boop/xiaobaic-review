export type ClipBounds = { left: number; right: number; top: number; bottom: number }

/**
 * The box an element is actually allowed to paint in: the viewport intersected
 * with every ancestor that scrolls or clips. A `right-0` panel anchored near a
 * scroll column's left edge otherwise loses its checkboxes and labels off the
 * side, and no scrollbar exists to reach them.
 */
export function clipBounds(el: HTMLElement, padding = 0): ClipBounds {
  const bounds: ClipBounds = {
    left: padding,
    right: window.innerWidth - padding,
    top: padding,
    bottom: window.innerHeight - padding,
  }
  for (let node: HTMLElement | null = el.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
      const rect = node.getBoundingClientRect()
      bounds.left = Math.max(bounds.left, rect.left + padding)
      bounds.right = Math.min(bounds.right, rect.right - padding)
      bounds.top = Math.max(bounds.top, rect.top + padding)
      bounds.bottom = Math.min(bounds.bottom, rect.bottom - padding)
    }
  }
  return bounds
}
