'use client'

import { useEffect, useRef } from 'react'
import { Flow } from '@/lib/light-mist-flow'
import { strokeSplats, type FluidSplat, type PointerPoint } from '@/lib/light-mist-input'

export default function LightMist() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
    let flow: Flow | null = null
    let frame = 0
    let lastTime = 0
    let onScreen = false
    let focused = document.hasFocus()
    let reduced = reducedMotion.matches
    let previous: PointerPoint | null = null
    let pointerId: number | null = null
    let pending: FluidSplat[] = []
    let width = canvas.clientWidth
    let height = canvas.clientHeight
    let pixelRatio = devicePixelRatio

    const canAnimate = () => Boolean(flow && onScreen && focused && !document.hidden && !reduced)
    const clearInput = () => {
      previous = null
      pointerId = null
      pending = []
    }
    const stop = () => {
      cancelAnimationFrame(frame)
      frame = 0
      clearInput()
    }
    const animate = (now: number) => {
      frame = 0
      if (!flow || !canAnimate()) return
      const elapsed = (now - lastTime) / 1000
      if (elapsed >= 1 / 65) {
        lastTime = now
        const points = pending
        pending = []
        flow.step(Math.min(elapsed, 1 / 30), points)
      }
      frame = requestAnimationFrame(animate)
    }
    const sync = () => {
      stop()
      canvas.dataset.lightMist = flow ? (canAnimate() ? 'running' : 'paused') : 'unavailable'
      if (canAnimate()) {
        lastTime = performance.now()
        frame = requestAnimationFrame(animate)
      }
    }
    const initialize = () => {
      try {
        flow = new Flow(canvas)
        canvas.style.visibility = 'visible'
      } catch {
        flow?.destroy()
        flow = null
        canvas.style.visibility = 'hidden'
      }
      sync()
    }
    const resize = () => {
      if (width === canvas.clientWidth && height === canvas.clientHeight && pixelRatio === devicePixelRatio) return
      width = canvas.clientWidth
      height = canvas.clientHeight
      pixelRatio = devicePixelRatio
      clearInput()
      flow?.resize()
    }
    const move = (event: PointerEvent) => {
      if (!canAnimate()) return
      if (event.target instanceof Element && event.target.closest('a, button, input, select, textarea, [role="button"]')) {
        previous = null
        return
      }
      if (event.pointerType === 'touch' && event.pointerId !== pointerId) return
      const rect = canvas.getBoundingClientRect()
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top, time: event.timeStamp }
      if (point.x < 0 || point.y < 0 || point.x > rect.width || point.y > rect.height) {
        previous = null
        return
      }
      pending.push(...strokeSplats(previous, point, rect.width, rect.height))
      if (pending.length > 64) pending = pending.slice(-64)
      previous = point
    }
    const down = (event: PointerEvent) => {
      if (!canAnimate() || (pointerId !== null && pointerId !== event.pointerId)) return
      pointerId = event.pointerId
      previous = null
      move(event)
    }
    const up = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return
      pointerId = null
      if (event.pointerType === 'touch') previous = null
    }
    const blur = () => { focused = false; sync() }
    const focus = () => { focused = document.hasFocus(); sync() }
    const motionChange = (event: MediaQueryListEvent) => { reduced = event.matches; sync() }
    const contextLost = (event: Event) => {
      event.preventDefault()
      stop()
      flow?.destroy()
      flow = null
      canvas.style.visibility = 'hidden'
      sync()
    }
    const observer = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting
      sync()
    })
    const resizer = new ResizeObserver(resize)
    canvas.addEventListener('webglcontextlost', contextLost)
    canvas.addEventListener('webglcontextrestored', initialize)
    initialize()
    observer.observe(canvas)
    resizer.observe(canvas)
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerdown', down, { passive: true })
    window.addEventListener('pointerup', up, { passive: true })
    window.addEventListener('pointercancel', clearInput, { passive: true })
    window.addEventListener('scroll', clearInput, { passive: true })
    window.addEventListener('resize', resize)
    window.addEventListener('blur', blur)
    window.addEventListener('focus', focus)
    window.addEventListener('pagehide', blur)
    window.addEventListener('pageshow', focus)
    document.documentElement.addEventListener('pointerleave', clearInput)
    document.addEventListener('visibilitychange', sync)
    reducedMotion.addEventListener('change', motionChange)

    return () => {
      stop()
      observer.disconnect()
      resizer.disconnect()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', clearInput)
      window.removeEventListener('scroll', clearInput)
      window.removeEventListener('resize', resize)
      window.removeEventListener('blur', blur)
      window.removeEventListener('focus', focus)
      window.removeEventListener('pagehide', blur)
      window.removeEventListener('pageshow', focus)
      document.documentElement.removeEventListener('pointerleave', clearInput)
      document.removeEventListener('visibilitychange', sync)
      reducedMotion.removeEventListener('change', motionChange)
      canvas.removeEventListener('webglcontextlost', contextLost)
      canvas.removeEventListener('webglcontextrestored', initialize)
      flow?.destroy()
      flow = null
    }
  }, [])

  return <canvas ref={canvasRef} data-light-mist="loading" aria-hidden="true" style={{ display: 'block', width: '100%', height: '100%', pointerEvents: 'none' }} />
}
