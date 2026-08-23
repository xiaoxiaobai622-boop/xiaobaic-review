'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { Pencil, Undo2, X, Minus, Plus, ChevronUp, ChevronDown, ArrowUpRight, Square } from 'lucide-react'
import { AnnotationColor, ANNOTATION_COLORS, DrawingTool } from '@/types/annotations'
import { cn } from '@/lib/utils'

interface AnnotationToolbarProps {
  activeTool: DrawingTool
  activeColor: AnnotationColor
  strokeWidth: number
  opacity: number
  canUndo: boolean
  onColorChange: (color: AnnotationColor) => void
  onToolChange: (tool: DrawingTool) => void
  onStrokeWidthChange: (width: number) => void
  onOpacityChange: (opacity: number) => void
  onUndo: () => void
  onCancel: () => void
  placement?: 'overlay' | 'composer'
}

// Tailwind ring classes for color swatches
const COLOR_RING: Record<string, string> = {
  '#FFFFFF': 'ring-gray-300',
  '#000000': 'ring-gray-600',
  '#EF4444': 'ring-red-400',
  '#EAB308': 'ring-yellow-400',
  '#22C55E': 'ring-green-400',
  '#3B82F6': 'ring-blue-400',
}

// Predefined stroke width steps for quick adjustment
const STROKE_STEPS = [0.002, 0.004, 0.008, 0.015, 0.03]

function closestStepIndex(value: number): number {
  let closest = 0
  let minDiff = Math.abs(value - STROKE_STEPS[0])
  for (let i = 1; i < STROKE_STEPS.length; i++) {
    const diff = Math.abs(value - STROKE_STEPS[i])
    if (diff < minDiff) {
      minDiff = diff
      closest = i
    }
  }
  return closest
}

export default function AnnotationToolbar({
  activeTool,
  activeColor,
  strokeWidth,
  opacity,
  canUndo,
  onColorChange,
  onToolChange,
  onStrokeWidthChange,
  onOpacityChange,
  onUndo,
  onCancel,
  placement = 'overlay',
}: AnnotationToolbarProps) {
  const t = useTranslations('controls')
  const tCommon = useTranslations('common')
  const [minimized, setMinimized] = useState(false)
  const currentStepIndex = closestStepIndex(strokeWidth)

  const decreaseWidth = () => {
    const newIndex = Math.max(0, currentStepIndex - 1)
    onStrokeWidthChange(STROKE_STEPS[newIndex])
  }

  const increaseWidth = () => {
    const newIndex = Math.min(STROKE_STEPS.length - 1, currentStepIndex + 1)
    onStrokeWidthChange(STROKE_STEPS[newIndex])
  }

  // Opacity steps: 25%, 50%, 75%, 100%
  const OPACITY_STEPS = [0.25, 0.5, 0.75, 1]
  const currentOpacityIndex = OPACITY_STEPS.reduce((closest, val, i) =>
    Math.abs(val - opacity) < Math.abs(OPACITY_STEPS[closest] - opacity) ? i : closest, 0)

  const decreaseOpacity = () => {
    const newIndex = Math.max(0, currentOpacityIndex - 1)
    onOpacityChange(OPACITY_STEPS[newIndex])
  }

  const increaseOpacity = () => {
    const newIndex = Math.min(OPACITY_STEPS.length - 1, currentOpacityIndex + 1)
    onOpacityChange(OPACITY_STEPS[newIndex])
  }

  if (placement === 'composer') {
    const propertiesTarget = typeof document !== 'undefined'
      ? document.getElementById('review-annotation-properties')
      : null

    return propertiesTarget ? createPortal(
        <div className="flex h-8 w-max max-w-full items-center gap-0.5 overflow-x-auto rounded-md border border-border/70 bg-popover px-0.5 text-popover-foreground shadow-sm">
          <div className="flex shrink-0 items-center gap-1 px-0.5" aria-label="批注颜色">
            {ANNOTATION_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => onColorChange(color)}
                className={cn(
                  'h-4 w-4 rounded-full border border-border shadow-sm transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  activeColor === color && 'scale-110 ring-2 ring-primary ring-offset-1 ring-offset-popover'
                )}
                style={{ backgroundColor: color }}
                title={color}
                aria-label={`选择颜色 ${color}`}
                aria-pressed={activeColor === color}
              />
            ))}
          </div>

          <div className="h-4 w-px shrink-0 bg-border" />

          <div className="flex shrink-0 items-center gap-0.5" title={t('strokeThickness')}>
            <button
              type="button"
              onClick={decreaseWidth}
              disabled={currentStepIndex === 0}
              aria-label="减小笔刷粗细"
              className="inline-flex h-6 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="flex h-5 w-5 items-center justify-center rounded bg-muted" aria-label={`笔刷粗细 ${currentStepIndex + 1}`}>
              <span
                className="rounded-full bg-foreground"
                style={{
                  width: Math.max(4, 4 + currentStepIndex * 2),
                  height: Math.max(4, 4 + currentStepIndex * 2),
                }}
              />
            </span>
            <button
              type="button"
              onClick={increaseWidth}
              disabled={currentStepIndex === STROKE_STEPS.length - 1}
              aria-label="增大笔刷粗细"
              className="inline-flex h-6 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="h-4 w-px shrink-0 bg-border" />

          <div className="flex shrink-0 items-center gap-0.5" title={t('opacity')}>
            <button
              type="button"
              onClick={decreaseOpacity}
              disabled={currentOpacityIndex === 0}
              aria-label="降低透明度"
              className="inline-flex h-6 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="w-8 text-center text-[10px] font-medium tabular-nums text-foreground">
              {Math.round(opacity * 100)}%
            </span>
            <button
              type="button"
              onClick={increaseOpacity}
              disabled={currentOpacityIndex === OPACITY_STEPS.length - 1}
              aria-label="提高透明度"
              className="inline-flex h-6 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="h-4 w-px shrink-0 bg-border" />

          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
            title={t('undo')}
            aria-label={t('undo')}
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            title={tCommon('cancel')}
            aria-label={tCommon('cancel')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>, propertiesTarget) : null
  }

  // Minimized: small floating pill button
  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        className={cn(
          'z-30 flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-black/85 px-2.5 py-1.5 text-white/80 shadow-2xl backdrop-blur-sm transition-colors hover:text-white',
          placement === 'overlay' && 'absolute left-3 top-3'
        )}
        title={t('showDrawingTools')}
      >
        <Pencil className="w-3.5 h-3.5" />
        <ChevronDown className="w-3 h-3" />
      </button>
    )
  }

  return (
    <div
      className={cn(
        'z-30 flex w-max items-center gap-1.5 rounded-xl border border-white/10 bg-black/85 px-2.5 py-2 shadow-2xl backdrop-blur-sm sm:px-3',
        placement === 'overlay'
          ? 'absolute left-1/2 top-3 max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-col'
          : 'relative flex-row'
      )}
    >
      {/* Row 1: Drawing tools */}
      <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
        {([
          ['freehand', Pencil, '画笔'],
          ['arrow', ArrowUpRight, '箭头'],
          ['rectangle', Square, '矩形'],
        ] as const).map(([tool, Icon, label]) => (
          <button
            key={tool}
            type="button"
            onClick={() => onToolChange(tool)}
            className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${activeTool === tool ? 'bg-white text-black' : 'text-white/75 hover:bg-white/10 hover:text-white'}`}
            title={label}
            aria-label={label}
            aria-pressed={activeTool === tool}
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}

        {/* Separator */}
        <div className="w-px h-5 sm:h-6 bg-white/20 mx-0.5 sm:mx-1" />

        {/* Color Swatches */}
        {ANNOTATION_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => onColorChange(color)}
            className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full transition-transform ring-2 ring-inset ${
              COLOR_RING[color] || 'ring-white/30'
            } ${activeColor === color ? 'scale-125 ring-offset-1 ring-offset-black/80' : 'hover:scale-110'}`}
            style={{ backgroundColor: color }}
            title={color}
            aria-label={`选择颜色 ${color}`}
            aria-pressed={activeColor === color}
          />
        ))}

        {/* Separator */}
        <div className="w-px h-5 sm:h-6 bg-white/20 mx-0.5 sm:mx-1" />

        {/* Stroke Width */}
        <div className="flex items-center gap-0.5" title={t('strokeThickness')}>
          <button
            type="button"
            onClick={decreaseWidth}
            disabled={currentStepIndex === 0}
            aria-label="减小笔刷粗细"
            className={`p-1 sm:p-1.5 rounded-lg transition-colors ${
              currentStepIndex > 0
                ? 'text-white/60 hover:text-white hover:bg-white/10'
                : 'text-white/20 cursor-not-allowed'
            }`}
          >
            <Minus className="w-3 h-3" />
          </button>
          <div className="w-5 sm:w-6 flex items-center justify-center" title={`Thickness ${currentStepIndex + 1}/${STROKE_STEPS.length}`}>
            <div
              className="rounded-full bg-white"
              style={{
                width: Math.max(4, 4 + currentStepIndex * 3),
                height: Math.max(4, 4 + currentStepIndex * 3),
              }}
            />
          </div>
          <button
            type="button"
            onClick={increaseWidth}
            disabled={currentStepIndex === STROKE_STEPS.length - 1}
            aria-label="增大笔刷粗细"
            className={`p-1 sm:p-1.5 rounded-lg transition-colors ${
              currentStepIndex < STROKE_STEPS.length - 1
                ? 'text-white/60 hover:text-white hover:bg-white/10'
                : 'text-white/20 cursor-not-allowed'
            }`}
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>

        {/* Separator */}
        <div className="w-px h-5 sm:h-6 bg-white/20 mx-0.5 sm:mx-1" />

        {/* Opacity */}
        <div className="flex items-center gap-0.5" title={t('opacity')}>
          <button
            type="button"
            onClick={decreaseOpacity}
            disabled={currentOpacityIndex === 0}
            aria-label="降低透明度"
            className={`p-1 sm:p-1.5 rounded-lg transition-colors ${
              currentOpacityIndex > 0
                ? 'text-white/60 hover:text-white hover:bg-white/10'
                : 'text-white/20 cursor-not-allowed'
            }`}
          >
            <Minus className="w-3 h-3" />
          </button>
          <span className="text-[10px] text-white/80 font-mono w-7 text-center">
            {Math.round(opacity * 100)}%
          </span>
          <button
            type="button"
            onClick={increaseOpacity}
            disabled={currentOpacityIndex === OPACITY_STEPS.length - 1}
            aria-label="提高透明度"
            className={`p-1 sm:p-1.5 rounded-lg transition-colors ${
              currentOpacityIndex < OPACITY_STEPS.length - 1
                ? 'text-white/60 hover:text-white hover:bg-white/10'
                : 'text-white/20 cursor-not-allowed'
            }`}
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>

        {/* Separator */}
        <div className="w-px h-5 sm:h-6 bg-white/20 mx-0.5 sm:mx-1" />

        {/* Hide toolbar */}
        <button
          type="button"
          onClick={() => setMinimized(true)}
          className="p-1 sm:p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          title={t('hideToolbar')}
          aria-label={t('hideToolbar')}
        >
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Row 2: Actions */}
      <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
        {/* Undo */}
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          className={`p-1.5 sm:p-2 rounded-lg transition-colors flex items-center gap-1 ${
            canUndo
              ? 'text-white/60 hover:text-white hover:bg-white/10'
              : 'text-white/20 cursor-not-allowed'
          }`}
          title={t('undo')}
        >
          <Undo2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span className="text-xs">{t('undo')}</span>
        </button>

        {/* Separator */}
        <div className="w-px h-5 sm:h-6 bg-white/20 mx-0.5 sm:mx-1" />

        {/* Cancel */}
        <button
          type="button"
          onClick={onCancel}
          className="p-1.5 sm:p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors flex items-center gap-1"
          title={tCommon('cancel')}
        >
          <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span className="text-xs">{tCommon('cancel')}</span>
        </button>

      </div>
    </div>
  )
}
