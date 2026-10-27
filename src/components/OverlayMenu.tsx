'use client'

import { ReactNode, RefObject, useEffect, useRef } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import motion from '@/components/ui/surface-motion.module.css'
import { cn } from '@/lib/utils'

interface OverlayMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  label: string
  left: number
  top: number
  width?: number
  side?: 'top' | 'bottom'
  triggerRef?: RefObject<HTMLElement | null>
  returnFocusRef?: RefObject<HTMLElement | null>
  menuRef?: RefObject<HTMLDivElement | null>
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void
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
  triggerRef, returnFocusRef, menuRef, onKeyDown, onEscape, className, children,
}: OverlayMenuProps) {
  const contentRef = useRef<HTMLDivElement | null>(null)
  const outside = useRef(false)

  const focusOwner = () => (returnFocusRef?.current ?? triggerRef?.current) ?? null

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      contentRef.current?.querySelector<HTMLElement>('[role="menuitem"], button:not([disabled])')?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [open])

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
          ref={(node) => {
            contentRef.current = node
            if (menuRef) menuRef.current = node
          }}
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
          className={cn(
            'fixed z-[90] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-xl outline-none',
            motion.surface,
            motion.anchoredMenu,
            className,
          )}
          style={{
            left,
            top,
            width,
            ['--surface-y' as string]: side === 'bottom' ? '-8px' : '8px',
          }}
        >
          <Dialog.Title className="sr-only">{label}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
