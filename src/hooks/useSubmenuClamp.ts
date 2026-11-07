'use client'

import { useLayoutEffect, type RefObject } from 'react'

/**
 * Keep a side submenu attached to its menu row while clamping it inside the
 * visual viewport. Inline `left`/`top` win over the Tailwind `left-full` /
 * `right-full` fallback classes, so no positioning library is needed.
 */
export function useSubmenuClamp(
  panelRef: RefObject<HTMLElement | null>,
  open: boolean,
  side: 'left' | 'right',
) {
  useLayoutEffect(() => {
    if (!open || !panelRef.current) return
    const panel = panelRef.current
    const parent = panel.offsetParent as HTMLElement | null
    if (!parent) return

    let frame = 0

    const place = () => {
      const viewport = window.visualViewport
      const leftEdge = (viewport?.offsetLeft ?? 0) + 8
      const topEdge = (viewport?.offsetTop ?? 0) + 8
      const rightEdge = leftEdge + (viewport?.width ?? window.innerWidth) - 16
      const bottomEdge = topEdge + (viewport?.height ?? window.innerHeight) - 16
      const parentRect = parent.getBoundingClientRect()
      const width = panel.offsetWidth
      const height = panel.offsetHeight

      let left = side === 'right' ? parent.offsetWidth - 1 : -width + 1
      if (parentRect.left + left + width > rightEdge) left = rightEdge - width - parentRect.left
      if (parentRect.left + left < leftEdge) left = leftEdge - parentRect.left

      let top = 0
      if (parentRect.top + top + height > bottomEdge) top = bottomEdge - height - parentRect.top
      if (parentRect.top + top < topEdge) top = topEdge - parentRect.top

      panel.style.left = `${Math.round(left)}px`
      panel.style.right = 'auto'
      panel.style.top = `${Math.round(top)}px`
    }

    place()
    const schedule = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        place()
      })
    }
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('scroll', schedule)

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('scroll', schedule)
    }
  }, [panelRef, open, side])
}