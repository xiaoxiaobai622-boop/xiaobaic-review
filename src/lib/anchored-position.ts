export type AnchorRect = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export type OverlaySize = { width: number; height: number }

export type ViewportRect = { left: number; top: number; right: number; bottom: number }

export type AnchoredPlacement = {
  side?: 'bottom' | 'top'
  align?: 'start' | 'center' | 'end'
  gap?: number
  padding?: number
  /** Use the anchor width (plus widthDelta) instead of the content's intrinsic width. */
  anchorWidth?: boolean
  widthDelta?: number
  xOffset?: number
  submenuWidth?: number
  /** The anchor is a pointer: keep `gap` on both axes and flip left/up when a side cannot fit. */
  pointer?: boolean
}

export type AnchoredPosition = {
  left: number
  top: number
  width: number
  height: number
  maxHeight: number
  side: 'bottom' | 'top'
  submenuSide: 'left' | 'right'
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/**
 * Place a floating panel against an anchor rect. The panel's measured size is
 * authoritative: it is never derived from a hard-coded menu height. Horizontal
 * alignment is clamped to the viewport, vertical placement prefers `side` and
 * flips when that side cannot fit.
 */
export function computeAnchoredPosition({
  anchor,
  size,
  viewport,
  placement = {},
}: {
  anchor: AnchorRect
  size: OverlaySize
  viewport: ViewportRect
  placement?: AnchoredPlacement
}): AnchoredPosition {
  const padding = placement.padding ?? 8
  const gap = placement.gap ?? 6
  const align = placement.align ?? 'start'
  const preferredSide = placement.side ?? 'bottom'
  const xOffset = placement.xOffset ?? 0

  const availableWidth = Math.max(0, viewport.right - viewport.left - padding * 2)
  const width = Math.min(
    Math.max(0, placement.anchorWidth ? anchor.width + (placement.widthDelta ?? 0) : size.width),
    availableWidth,
  )
  const maxHeight = Math.max(0, viewport.bottom - viewport.top - padding * 2)
  const height = Math.min(Math.max(0, size.height), maxHeight)

  const minLeft = viewport.left + padding
  const maxLeft = Math.max(minLeft, viewport.right - padding - width)
  const naturalLeft = align === 'center'
    ? anchor.left + (anchor.width - width) / 2 + xOffset
    : align === 'end'
      ? anchor.right - width + xOffset
      : anchor.left + xOffset
  const left = placement.pointer
    ? pointerLeft({ anchor, width, viewport, gap, padding, xOffset, minLeft, maxLeft })
    : clamp(naturalLeft, minLeft, maxLeft)

  const belowTop = anchor.bottom + gap
  const aboveTop = anchor.top - gap - height
  const minTop = viewport.top + padding
  const maxTop = Math.max(minTop, viewport.bottom - padding - height)
  const fitsBelow = belowTop + height <= viewport.bottom - padding
  const fitsAbove = aboveTop >= minTop
  const spaceBelow = viewport.bottom - padding - belowTop
  const spaceAbove = anchor.top - gap - minTop

  let side = preferredSide
  if (preferredSide === 'bottom') {
    if (!fitsBelow) side = fitsAbove || spaceAbove >= spaceBelow ? 'top' : 'bottom'
  } else if (!fitsAbove) {
    side = fitsBelow || spaceBelow >= spaceAbove ? 'bottom' : 'top'
  }

  const top = clamp(side === 'bottom' ? belowTop : aboveTop, minTop, maxTop)
  const actualSide: 'bottom' | 'top' = top >= anchor.bottom
    ? 'bottom'
    : top + height <= anchor.top
      ? 'top'
      : side

  const submenuWidth = placement.submenuWidth ?? 168
  const submenuSide = left + width + 6 + submenuWidth <= viewport.right - padding ? 'right' : 'left'

  return { left, top, width, height, maxHeight, side: actualSide, submenuSide }
}

/** A pointer menu opens down-right, then flips to whichever side of the pointer fits. */
function pointerLeft({
  anchor, width, viewport, gap, padding, xOffset, minLeft, maxLeft,
}: {
  anchor: AnchorRect
  width: number
  viewport: ViewportRect
  gap: number
  padding: number
  xOffset: number
  minLeft: number
  maxLeft: number
}): number {
  const rightLeft = anchor.left + gap + xOffset
  const leftLeft = anchor.left - gap - width + xOffset
  if (rightLeft + width <= viewport.right - padding) return rightLeft
  if (leftLeft >= viewport.left + padding) return leftLeft
  return clamp(rightLeft, minLeft, maxLeft)
}