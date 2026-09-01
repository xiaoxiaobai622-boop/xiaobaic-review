'use client'

import { memo, useMemo, useState, useEffect, RefObject } from 'react'
import { AnnotationData, Shape } from '@/types/annotations'
import { timecodeToSeconds } from '@/lib/timecode'
import { useMediaPosition } from '@/hooks/useMediaPosition'

interface PendingAnnotation {
  annotations: AnnotationData
  timecode: string
  timecodeEnd?: string | null
}

interface AnnotationOverlayProps {
  comments: Array<{
    id: string
    timecode: string
    timecodeEnd?: string | null
    annotations?: AnnotationData | null
  }>
  currentTime: number
  videoFps: number
  containerRef: RefObject<HTMLDivElement | null>
  videoRef: RefObject<HTMLVideoElement | null>
  videoKey?: string
  hidden?: boolean
  pendingAnnotation?: PendingAnnotation | null
}

interface TimedAnnotation {
  commentId: string
  shapes: Shape[]
  startTime: number
  endTime: number
  tolerance: number
}

interface VisibleAnnotation {
  commentId: string
  shapes: Shape[]
}

function renderShape(shape: Shape, renderWidth: number, renderHeight: number, key: string) {
  const sw = shape.strokeWidth * renderWidth
  const shapeOpacity = (shape as any).opacity ?? 1

  if (shape.type === 'freehand') {
    if (shape.points.length < 2) return null
    const points = shape.points
      .map((p) => `${p.x * renderWidth},${p.y * renderHeight}`)
      .join(' ')
    return (
      <polyline
        key={key}
        points={points}
        fill="none"
        stroke={shape.color}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={shapeOpacity}
      />
    )
  }


  if (shape.type === 'rectangle') {
    const x = Math.min(shape.start.x, shape.end.x) * renderWidth
    const y = Math.min(shape.start.y, shape.end.y) * renderHeight
    return <rect key={key} x={x} y={y} width={Math.abs(shape.end.x - shape.start.x) * renderWidth} height={Math.abs(shape.end.y - shape.start.y) * renderHeight} fill="none" stroke={shape.color} strokeWidth={sw} opacity={shapeOpacity} />
  }

  if (shape.type === 'arrow') {
    const x1 = shape.start.x * renderWidth
    const y1 = shape.start.y * renderHeight
    const x2 = shape.end.x * renderWidth
    const y2 = shape.end.y * renderHeight
    const angle = Math.atan2(y2 - y1, x2 - x1)
    const head = Math.max(10, sw * 4)
    return (
      <g key={key} fill="none" stroke={shape.color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" opacity={shapeOpacity}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} />
        <polyline points={`${x2 - head * Math.cos(angle - Math.PI / 6)},${y2 - head * Math.sin(angle - Math.PI / 6)} ${x2},${y2} ${x2 - head * Math.cos(angle + Math.PI / 6)},${y2 - head * Math.sin(angle + Math.PI / 6)}`} />
      </g>
    )
  }

  return null
}

function getVideoRect(
  video: HTMLVideoElement,
  container: HTMLDivElement
): { offsetX: number; offsetY: number; width: number; height: number } | null {
  const videoWidth = video.videoWidth
  const videoHeight = video.videoHeight
  if (!videoWidth || !videoHeight) return null

  const containerWidth = container.clientWidth
  const containerHeight = container.clientHeight
  if (!containerWidth || !containerHeight) return null

  const containerAspect = containerWidth / containerHeight
  const videoAspect = videoWidth / videoHeight

  let rw: number, rh: number, ox: number, oy: number

  if (videoAspect > containerAspect) {
    rw = containerWidth
    rh = rw / videoAspect
    ox = 0
    oy = (containerHeight - rh) / 2
  } else {
    rh = containerHeight
    rw = rh * videoAspect
    oy = 0
    ox = (containerWidth - rw) / 2
  }

  return { offsetX: ox, offsetY: oy, width: rw, height: rh }
}

interface AnnotationShapesProps {
  visibleShapes: VisibleAnnotation[]
  renderWidth: number
  renderHeight: number
  offsetX: number
  offsetY: number
}

function areAnnotationShapesEqual(
  previous: AnnotationShapesProps,
  next: AnnotationShapesProps,
): boolean {
  if (
    previous.renderWidth !== next.renderWidth ||
    previous.renderHeight !== next.renderHeight ||
    previous.offsetX !== next.offsetX ||
    previous.offsetY !== next.offsetY ||
    previous.visibleShapes.length !== next.visibleShapes.length
  ) {
    return false
  }

  return previous.visibleShapes.every((entry, index) => {
    const nextEntry = next.visibleShapes[index]
    return entry.commentId === nextEntry.commentId && entry.shapes === nextEntry.shapes
  })
}

/** Keep SVG geometry isolated while the playhead moves within one range. */
const AnnotationShapes = memo(function AnnotationShapes({
  visibleShapes,
  renderWidth,
  renderHeight,
  offsetX,
  offsetY,
}: AnnotationShapesProps) {
  return (
    <svg
      className="absolute pointer-events-none z-10"
      style={{
        left: offsetX,
        top: offsetY,
        width: renderWidth,
        height: renderHeight,
      }}
      viewBox={`0 0 ${renderWidth} ${renderHeight}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      {visibleShapes.map(({ commentId, shapes }) =>
        shapes.map((shape, index) =>
          renderShape(shape, renderWidth, renderHeight, `${commentId}-${shape.id}-${index}`)
        )
      )}
    </svg>
  )
}, areAnnotationShapesEqual)

function AnnotationOverlay({
  comments,
  currentTime,
  videoFps,
  containerRef,
  videoRef,
  videoKey,
  hidden = false,
  pendingAnnotation = null,
}: AnnotationOverlayProps) {
  const mediaCurrentTime = useMediaPosition(videoRef, currentTime, videoKey)
  const [rect, setRect] = useState<{ offsetX: number; offsetY: number; width: number; height: number } | null>(null)

  useEffect(() => {
    const recalc = () => {
      const video = videoRef.current
      const container = containerRef.current
      if (!video || !container) return
      const r = getVideoRect(video, container)
      if (r) {
        setRect((previous) => (
          previous &&
          previous.offsetX === r.offsetX &&
          previous.offsetY === r.offsetY &&
          previous.width === r.width &&
          previous.height === r.height
            ? previous
            : r
        ))
      }
    }

    recalc()

    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver(recalc)
    observer.observe(container)

    const video = videoRef.current
    if (video) {
      video.addEventListener('loadedmetadata', recalc)
    }

    return () => {
      observer.disconnect()
      if (video) video.removeEventListener('loadedmetadata', recalc)
    }
  }, [containerRef, videoKey, videoRef])

  const renderWidth = rect?.width || 0
  const renderHeight = rect?.height || 0
  const offsetX = rect?.offsetX || 0
  const offsetY = rect?.offsetY || 0

  // Normalize annotation payloads and parse timecodes only when comments or
  // the source frame rate changes. Playback updates now only filter this
  // compact list instead of walking every raw comment payload.
  const timedAnnotations = useMemo<TimedAnnotation[]>(() => {
    const frameDuration = 1 / (videoFps || 24)
    const result: TimedAnnotation[] = []

    for (const comment of comments) {
      const ann = comment.annotations as any
      if (!ann || typeof ann !== 'object') continue

      // Support both new format (shapes) and legacy format (keyframes)
      let shapes: Shape[] | undefined
      if (Array.isArray(ann.shapes) && ann.shapes.length > 0) {
        shapes = ann.shapes
      } else if (Array.isArray(ann.keyframes)) {
        // Legacy: collect shapes from all keyframes
        const all: Shape[] = []
        for (const kf of ann.keyframes) {
          if (Array.isArray(kf.shapes)) all.push(...kf.shapes)
        }
        if (all.length > 0) shapes = all
      }
      if (!shapes) continue

      let startTime: number
      let endTime: number
      try {
        startTime = timecodeToSeconds(comment.timecode, videoFps)
        endTime = comment.timecodeEnd
          ? timecodeToSeconds(comment.timecodeEnd, videoFps)
          : startTime + frameDuration
      } catch {
        // A malformed legacy timecode should not interrupt video playback.
        continue
      }

      // Use a small tolerance to account for floating point drift in timecode round-trips
      const tolerance = frameDuration * 0.5
      result.push({ commentId: comment.id, shapes, startTime, endTime, tolerance })
    }

    return result
  }, [comments, videoFps])

  const visibleShapes = useMemo<VisibleAnnotation[]>(() => {
    if (!renderWidth || !renderHeight) return []

    const result: VisibleAnnotation[] = timedAnnotations
      .filter(({ startTime, endTime, tolerance }) => (
        mediaCurrentTime >= startTime - tolerance && mediaCurrentTime <= endTime + tolerance
      ))
      .map(({ commentId, shapes }) => ({ commentId, shapes }))

    // Always show pending annotation — it was just drawn at the current frame
    if (pendingAnnotation) {
      const ann = pendingAnnotation.annotations
      if (Array.isArray(ann.shapes) && ann.shapes.length > 0) {
        result.push({ commentId: 'pending', shapes: ann.shapes })
      }
    }

    return result
  }, [mediaCurrentTime, pendingAnnotation, renderHeight, renderWidth, timedAnnotations])

  if (!renderWidth || !renderHeight || visibleShapes.length === 0 || hidden) return null

  return (
    <AnnotationShapes
      visibleShapes={visibleShapes}
      renderWidth={renderWidth}
      renderHeight={renderHeight}
      offsetX={offsetX}
      offsetY={offsetY}
    />
  )
}

export default memo(AnnotationOverlay)
