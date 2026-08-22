'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Pencil, Undo2, X, Minus, Plus, ChevronUp, ChevronDown, ArrowUpRight, Square } from 'lucide-react'
import { AnnotationColor, ANNOTATION_COLORS, DrawingTool } from '@/types/annotations'

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

  // Minimized: small floating pill button
  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        className="absolute top-3 left-3 z-30 flex items-center gap-1.5 bg-black/85 backdrop-blur-sm rounded-lg px-2.5 py-1.5 shadow-2xl border border-white/10 text-white/80 hover:text-white transition-colors"
        title={t('showDrawingTools')}
      >
        <Pencil className="w-3.5 h-3.5" />
        <ChevronDown className="w-3 h-3" />
      </button>
    )
  }

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-1.5 bg-black/85 backdrop-blur-sm rounded-xl px-2.5 sm:px-3 py-2 shadow-2xl border border-white/10 max-w-[calc(100%-1.5rem)]">
      {/* Row 1: Drawing tools */}
      <div className="flex items-center gap-1 sm:gap-1.5">
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
      <div className="flex items-center gap-1 sm:gap-1.5">
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
