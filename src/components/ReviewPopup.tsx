'use client'

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import styles from './review-popup.module.css'

interface ReviewPopupProps {
  id: string
  open: boolean
  onOpenChange: (open: boolean) => void
  anchor: RefObject<HTMLButtonElement | null>
  label: string
  role?: 'menu' | 'dialog'
  side?: 'top' | 'bottom'
  align?: 'start' | 'center' | 'end'
  width: number
  children: ReactNode
  returnFocus?: RefObject<HTMLElement | null>
}

export default function ReviewPopup(props: ReviewPopupProps) {
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange} modal={false}>
      <PopupContent {...props} />
    </Dialog.Root>
  )
}

function PopupContent({ id, open, onOpenChange, anchor, label, role = 'dialog', side = 'top', align = 'start', width, children, returnFocus }: ReviewPopupProps) {
  const [content, setContent] = useState<HTMLDivElement | null>(null)
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null)
  const outside = useRef(false)
  const escaped = useRef(false)
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden', '--popup-offset': side === 'top' ? '8px' : '-8px' } as CSSProperties)

  useLayoutEffect(() => {
    const updateContainer = () => {
      const fullscreen = document.fullscreenElement
      const reviewSurface = anchor.current?.closest<HTMLElement>('[data-review-surface]') ?? null
      setPortalContainer(fullscreen instanceof HTMLElement && fullscreen.contains(anchor.current) ? fullscreen : reviewSurface)
    }
    updateContainer()
    document.addEventListener('fullscreenchange', updateContainer)
    return () => document.removeEventListener('fullscreenchange', updateContainer)
  }, [anchor, open])

  useLayoutEffect(() => {
    if (!open || !content || !anchor.current) return
    outside.current = false
    escaped.current = false
    const trigger = anchor.current
    const place = () => {
      const rect = trigger.getBoundingClientRect()
      const viewport = window.visualViewport
      const leftEdge = (viewport?.offsetLeft ?? 0) + 8
      const topEdge = (viewport?.offsetTop ?? 0) + 8
      const rightEdge = leftEdge + (viewport?.width ?? window.innerWidth) - 16
      const bottomEdge = topEdge + (viewport?.height ?? window.innerHeight) - 16
      const above = Math.max(0, rect.top - topEdge - 4)
      const below = Math.max(0, bottomEdge - rect.bottom - 4)
      const naturalHeight = content.scrollHeight + 2
      const preferred = side === 'top' ? above : below
      const opposite = side === 'top' ? below : above
      const actualSide = preferred < naturalHeight && opposite > preferred ? (side === 'top' ? 'bottom' : 'top') : side
      const available = actualSide === 'top' ? above : below
      const height = Math.min(naturalHeight, available)
      const actualWidth = Math.min(width, rightEdge - leftEdge)
      const desiredLeft = align === 'center' ? rect.left + (rect.width - actualWidth) / 2 : align === 'end' ? rect.right - actualWidth : rect.left
      const left = Math.min(Math.max(leftEdge, desiredLeft), rightEdge - actualWidth)
      const top = actualSide === 'top' ? rect.top - 4 - height : rect.bottom + 4
      setPosition({
        left, top, width: actualWidth, maxHeight: available, visibility: 'visible',
        '--popup-origin': `${Math.max(0, Math.min(actualWidth, rect.left + rect.width / 2 - left))}px ${actualSide === 'top' ? '100%' : '0%'}`,
        '--popup-offset': actualSide === 'top' ? '8px' : '-8px',
      } as CSSProperties)
    }
    place()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    observer?.observe(content)
    observer?.observe(trigger)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    window.visualViewport?.addEventListener('resize', place)
    window.visualViewport?.addEventListener('scroll', place)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      window.visualViewport?.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('scroll', place)
    }
  }, [open, content, anchor, side, align, width])

  useLayoutEffect(() => {
    if (!content || position.visibility !== 'visible') return
    if (open) {
      const target = content.querySelector<HTMLElement>('[aria-checked="true"], [aria-selected="true"]') ?? content.querySelector<HTMLElement>('button:not(:disabled), select, input, [href]')
      target?.focus({ preventScroll: true })
    } else if (!outside.current && (document.activeElement === document.body || content.contains(document.activeElement))) {
      (escaped.current ? anchor.current : returnFocus?.current ?? anchor.current)?.focus({ preventScroll: true })
    }
  }, [open, content, position.visibility, anchor, returnFocus])

  return (
    <Dialog.Portal container={portalContainer}>
    <Dialog.Content
      ref={setContent}
      data-review-popup
      id={id}
      role={role}
      aria-label={label}
      aria-describedby={undefined}
      className={styles.surface}
      style={position}
      inert={!open ? true : undefined}
      aria-hidden={!open ? true : undefined}
      onOpenAutoFocus={(event) => event.preventDefault()}
      onCloseAutoFocus={(event) => {
        event.preventDefault()
        const active = document.activeElement
        const ownsFocus = active === document.body || active === anchor.current || (active && content?.contains(active))
        if (!outside.current && ownsFocus) (escaped.current ? anchor.current : returnFocus?.current ?? anchor.current)?.focus({ preventScroll: true })
      }}
      onInteractOutside={(event) => {
        if (anchor.current?.contains(event.target as Node)) {
          escaped.current = true
          event.preventDefault()
          return
        }
        if (!open) {
          event.preventDefault()
          return
        }
        outside.current = true
      }}
      onEscapeKeyDown={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (!event.currentTarget.contains(event.target as Node)) return
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          escaped.current = true
          onOpenChange(false)
          anchor.current?.focus({ preventScroll: true })
          return
        }
        if (event.key === 'Tab') {
          const tabbable = Array.from(document.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex], [contenteditable="true"]')).filter(element =>
            element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[inert]') && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden'
          )
          const inside = tabbable.filter(element => event.currentTarget.contains(element))
          const boundary = event.shiftKey ? inside[0] : inside[inside.length - 1]
          if (role === 'menu' || !inside.length || document.activeElement === boundary) {
            event.preventDefault()
            event.stopPropagation()
            const outsideItems = tabbable.filter(element => !event.currentTarget.contains(element))
            const anchorIndex = outsideItems.indexOf(anchor.current!)
            const next = event.shiftKey ? anchor.current : outsideItems[anchorIndex + 1] ?? anchor.current
            outside.current = true
            onOpenChange(false)
            next?.focus({ preventScroll: true })
          }
          return
        }
        if (role !== 'menu' || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]:not(:disabled), [role="menuitem"]:not(:disabled)'))
        if (!items.length) return
        event.preventDefault()
        event.stopPropagation()
        const current = items.indexOf(document.activeElement as HTMLElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
        items[next].focus()
      }}
    >
      <Dialog.Title className="sr-only">{label}</Dialog.Title>
      {children}
    </Dialog.Content>
    </Dialog.Portal>
  )
}
