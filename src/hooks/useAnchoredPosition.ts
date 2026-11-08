'use client'

import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import {
  computeAnchoredPosition,
  type AnchoredPlacement,
  type AnchoredPosition,
} from '@/lib/anchored-position'

type AnchorPoint = { x: number; y: number } | null

export type AnchoredPositionState = AnchoredPosition & { ready: boolean }

const INITIAL: AnchoredPositionState = {
  left: 0,
  top: 0,
  width: 0,
  height: 0,
  maxHeight: 0,
  side: 'bottom',
  submenuSide: 'right',
  ready: false,
}

function samePosition(a: AnchoredPositionState, b: AnchoredPositionState) {
  const near = (x: number, y: number) => Math.abs(x - y) <= 0.5
  return a.ready === b.ready
    && near(a.left, b.left)
    && near(a.top, b.top)
    && near(a.width, b.width)
    && near(a.height, b.height)
    && near(a.maxHeight, b.maxHeight)
    && a.side === b.side
    && a.submenuSide === b.submenuSide
}

/**
 * Track a floating panel against its trigger. The panel is measured after it
 * mounts, then re-measured on scroll/resize/zoom and whenever either box
 * changes size. If the trigger leaves the viewport the owner is asked to close.
 */
export function useAnchoredPosition({
  open,
  anchorRef,
  anchorPoint,
  content,
  placement,
  onDismiss,
}: {
  open: boolean
  anchorRef?: RefObject<HTMLElement | null>
  anchorPoint?: AnchorPoint
  content: HTMLElement | null
  placement?: AnchoredPlacement
  onDismiss?: () => void
}): AnchoredPositionState {
  const [position, setPosition] = useState<AnchoredPositionState>(INITIAL)
  const placementRef = useRef(placement)
  const dismissRef = useRef(onDismiss)
  const pointX = anchorPoint?.x
  const pointY = anchorPoint?.y

  useLayoutEffect(() => {
    placementRef.current = placement
    dismissRef.current = onDismiss
  })

  useLayoutEffect(() => {
    if (!open || !content) return
    if (!anchorRef?.current && (pointX === undefined || pointY === undefined)) return

    let frame = 0
    let dismissed = false

    const dismiss = () => {
      if (dismissed) return
      dismissed = true
      dismissRef.current?.()
    }

    const measure = () => {
      if (dismissed) return
      const viewport = window.visualViewport
      const bounds = {
        left: viewport?.offsetLeft ?? 0,
        top: viewport?.offsetTop ?? 0,
        right: (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth),
        bottom: (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight),
      }

      let anchor: { left: number; top: number; right: number; bottom: number; width: number; height: number }
      const el = anchorRef?.current
      if (el) {
        const rect = el.getBoundingClientRect()
        anchor = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
        if (!el.isConnected || rect.bottom < bounds.top || rect.top > bounds.bottom || rect.right < bounds.left || rect.left > bounds.right) {
          dismiss()
          return
        }
      } else if (pointX !== undefined && pointY !== undefined) {
        anchor = { left: pointX, top: pointY, right: pointX, bottom: pointY, width: 0, height: 0 }
      } else {
        return
      }

      const computed = window.getComputedStyle(content)
      const measuredWidth = Number.parseFloat(computed.width) || content.offsetWidth
      const measuredHeight = Number.parseFloat(computed.height) || content.offsetHeight
      const result = computeAnchoredPosition({
        anchor,
        // getComputedStyle keeps the fractional layout box (and ignores the open
        // transition's scale). Round up so a flipped menu's nearest edge never
        // lands short of the placement gap.
        size: { width: Math.ceil(measuredWidth), height: Math.ceil(measuredHeight) },
        viewport: bounds,
        placement: placementRef.current,
      })
      const next: AnchoredPositionState = { ...result, ready: true }
      setPosition((current) => (samePosition(current, next) ? current : next))
    }

    const schedule = () => {
      if (frame || dismissed) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        measure()
      })
    }

    const onScroll = () => {
      // A pointer-anchored context menu has nothing that can follow the scroll,
      // so it closes instead of drifting away from the click position.
      if (pointX !== undefined && pointY !== undefined) {
        dismiss()
        return
      }
      schedule()
    }

    measure()

    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(schedule)
    observer?.observe(content)
    if (anchorRef?.current) observer?.observe(anchorRef.current)

    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('scroll', onScroll)

    return () => {
      dismissed = true
      if (frame) window.cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('scroll', onScroll)
    }
  }, [open, content, anchorRef, pointX, pointY])

  return position
}