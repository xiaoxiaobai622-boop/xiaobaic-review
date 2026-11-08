export type ContextMenuPoint = { x: number; y: number }

export function isEditableContextTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

/**
 * Chrome reports detail=0 for every contextmenu event, including a real right
 * click, so the pointer signals are button=2 or a Mac Ctrl+click (button=0
 * with ctrlKey). Keyboard-invoked menus have no pointer position and anchor to
 * the focused element instead.
 */
export function contextMenuPoint(
  event: { clientX: number; clientY: number; button?: number; ctrlKey?: boolean; nativeEvent?: Event },
  fallback: Element | null,
): ContextMenuPoint | null {
  const native = event.nativeEvent as (Event & { sourceCapabilities?: { firesTouchEvents?: boolean } }) | undefined
  if (native?.sourceCapabilities?.firesTouchEvents) return null
  if (event.button !== 2 && !event.ctrlKey) {
    return fallback ? elementContextPoint(fallback) : null
  }
  return { x: event.clientX, y: event.clientY }
}

export function elementContextPoint(element: Element): ContextMenuPoint {
  const rect = element.getBoundingClientRect()
  return { x: rect.left, y: rect.bottom }
}
