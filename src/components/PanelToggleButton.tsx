'use client'

import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * 面板显隐开关，对标 Frame.io 右上角那一对。
 * 状态主要靠 aria-pressed 传给读屏，颜色只是辅助：主色 = 面板还显示，次要色 = 已收起。
 */
export default function PanelToggleButton({ icon: Icon, label, active, onToggle, className }: {
  icon: LucideIcon
  label: string
  active: boolean
  onToggle: () => void
  className?: string
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-pressed={active}
      title={label}
      aria-label={label}
      onClick={onToggle}
      className={cn('h-9 w-9 shrink-0', active ? 'text-primary' : 'text-muted-foreground', className)}
    >
      <Icon />
    </Button>
  )
}
