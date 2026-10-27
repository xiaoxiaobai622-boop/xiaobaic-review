import { useEffect, type RefObject } from 'react'
import { clipBounds } from '@/lib/clip-bounds'

/**
 * After `open` becomes true, nudge the referenced element horizontally so it
 * stays inside every box that can cut it — the clipping ancestors as well as
 * the viewport. Useful for absolutely-positioned dropdowns that would
 * otherwise overflow.
 */
export function useViewportClamp(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  padding: number = 8
) {
  useEffect(() => {
    const el = ref.current
    if (!open || !el) return
    el.style.transform = ''
    const rect = el.getBoundingClientRect()
    const bounds = clipBounds(el, padding)
    let dx = 0
    if (rect.left < bounds.left) dx = bounds.left - rect.left
    else if (rect.right > bounds.right) dx = bounds.right - rect.right
    if (dx) el.style.transform = `translateX(${dx}px)`
  }, [ref, open, padding])
}
