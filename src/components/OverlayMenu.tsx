'use client'

import { ReactNode, RefObject, useCallback, useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import motion from '@/components/ui/surface-motion.module.css'
import { cn } from '@/lib/utils'
import { useAnchoredPosition } from '@/hooks/useAnchoredPosition'
import type { AnchoredPlacement } from '@/lib/anchored-position'

interface OverlayMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  label: string
  /** Desired top-left; only used when no anchor is supplied. */
  left?: number
  top?: number
  width?: number
  side?: 'top' | 'bottom'
  /** Geometry anchor. Defaults to triggerRef when present. */
  anchorRef?: RefObject<HTMLElement | null>
  /** Pointer anchor for context menus. */
  anchorPoint?: { x: number; y: number } | null
  placement?: AnchoredPlacement
  triggerRef?: RefObject<HTMLElement | null>
  returnFocusRef?: RefObject<HTMLElement | null>
  menuRef?: RefObject<HTMLDivElement | null>
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void
  onClick?: React.MouseEventHandler<HTMLDivElement>
  /** Return true when the Escape key was consumed (e.g. a submenu closed instead of the root). */
  onEscape?: () => boolean
  className?: string
  children: ReactNode
}

/**
 * 定位在视口坐标上的菜单外壳（右键菜单、卡片「⋯」等）：
 * 开合动效、点外面/Esc 关闭、关闭后的焦点归属都由这里统一处理。
 */
export default function OverlayMenu({
  open, onOpenChange, label, left, top, width = 208, side = 'bottom',
  anchorRef, anchorPoint, placement, triggerRef, returnFocusRef, menuRef, onKeyDown, onClick, onEscape, className, children,
}: OverlayMenuProps) {
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [content, setContent] = useState<HTMLDivElement | null>(null)
  const outside = useRef(false)
  const anchored = anchorRef != null || triggerRef != null || anchorPoint != null
  const position = useAnchoredPosition({
    open,
    anchorRef: anchorRef ?? triggerRef,
    anchorPoint,
    content,
    placement: {
      side,
      gap: 6,
      padding: 8,
      ...placement,
    },
    onDismiss: () => {
      // The trigger scrolled away: close without yanking focus (and the page
      // scroll position) back to it.
      outside.current = true
      onOpenChange(false)
    },
  })

  const focusOwner = () => (returnFocusRef?.current ?? triggerRef?.current) ?? null
  const attachContent = useCallback((node: HTMLDivElement | null) => {
    contentRef.current = node
    setContent(node)
    if (menuRef) menuRef.current = node
  }, [menuRef])

  useEffect(() => {
    // Focusing while the menu is still hidden (before its first measurement)
    // is a no-op, so wait until the anchored position is ready.
    if (!open || (anchored && !position.ready)) return
    const frame = requestAnimationFrame(() => {
      contentRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled]):not([aria-disabled="true"]), button:not([disabled])')?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [open, anchored, position.ready])

  return (
    <Dialog.Root open={open} onOpenChange={(next) => {
      if (next) { onOpenChange(true); return }
      const active = document.activeElement
      const ownsFocus = active === document.body || Boolean(contentRef.current?.contains(active)) || Boolean(triggerRef?.current?.contains(active))
      const restore = !outside.current && ownsFocus
      outside.current = false
      onOpenChange(false)
      if (restore) focusOwner()?.focus({ preventScroll: true })
    }} modal={false}>
      <Dialog.Portal>
        <Dialog.Content
          ref={attachContent}
          role="menu"
          aria-label={label}
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            event.preventDefault()
            if (onEscape?.()) return
            onOpenChange(false)
            focusOwner()?.focus({ preventScroll: true })
          }}
          onInteractOutside={(event) => {
            if (triggerRef?.current?.contains(event.target as Node)) {
              event.preventDefault()
              return
            }
            outside.current = true
          }}
          onKeyDown={onKeyDown}
          onClick={onClick}
          className={cn(
            'fixed z-[90] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-xl outline-none',
            motion.surface,
            motion.anchoredMenu,
            className,
          )}
          style={{
            left: anchored ? position.left : left,
            top: anchored ? position.top : top,
            width: anchored ? (placement?.anchorWidth ? (position.ready ? position.width : undefined) : (position.ready ? position.width : width)) : width,
            visibility: anchored && !position.ready ? 'hidden' : undefined,
            maxHeight: anchored && position.ready ? position.maxHeight : undefined,
            overflowY: anchored && position.ready && position.height >= position.maxHeight ? 'auto' : undefined,
            ['--surface-y' as string]: (anchored ? position.side : side) === 'bottom' ? '-8px' : '8px',
          }}
        >
          <Dialog.Title className="sr-only">{label}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
