export interface Point {
  x: number
  y: number
}

export interface FreehandShape {
  id: string
  type: 'freehand'
  color: string
  strokeWidth: number
  opacity?: number
  points: Point[]
}

export interface LineShape {
  id: string
  type: 'arrow' | 'rectangle'
  color: string
  strokeWidth: number
  opacity?: number
  start: Point
  end: Point
}

export type DrawingTool = 'freehand' | 'arrow' | 'rectangle'
export type Shape = FreehandShape | LineShape

export interface AnnotationData {
  version: 1
  shapes: Shape[]
}

export const ANNOTATION_COLORS = [
  '#FFFFFF',
  '#000000',
  '#EF4444',
  '#EAB308',
  '#22C55E',
  '#3B82F6',
] as const

export type AnnotationColor = (typeof ANNOTATION_COLORS)[number]

export const DEFAULT_STROKE_WIDTH = 0.008
export const MIN_STROKE_WIDTH = 0.001
export const MAX_STROKE_WIDTH = 0.05
export const DEFAULT_OPACITY = 1
