'use client'

import { useCallback, useLayoutEffect, useState } from 'react'

export interface IndicatorRect {
  left: number
  width: number
}

/**
 * 分段选择/页签的高亮滑块：按当前项的实际几何测一次，切换时用 CSS transition 平移。
 * 用回调 ref 而不是 useRef —— 控件可能在数据加载后才挂上来，节点一变要重新量。
 */
export function useSlidingIndicator(activeIndex: number) {
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const [rect, setRect] = useState<IndicatorRect | null>(null)
  const containerRef = useCallback((node: HTMLElement | null) => setContainer(node), [])

  useLayoutEffect(() => {
    if (!container) return
    const measure = () => {
      const items = container.querySelectorAll<HTMLElement>('[data-segment]')
      const item = items[activeIndex]
      if (!item) return
      setRect((current) => (
        current && current.left === item.offsetLeft && current.width === item.offsetWidth
          ? current
          : { left: item.offsetLeft, width: item.offsetWidth }
      ))
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(container)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [activeIndex, container])

  return { containerRef, rect }
}
