'use client'

import { useRef, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'

interface ProjectOverlayProps {
  /** data-tutorial 前缀：设置窗沿用 project-settings，成员窗用 project-members。 */
  tutorial: string
  title: string
  /** 窗头第二行（设置窗是项目名，成员窗是人数）；没有就不画，别留一行空的省略号。 */
  subtitle?: string
  /** 窗头右侧那枚控件：设置窗是「保存更改」，成员窗没有就不传。 */
  actions?: ReactNode
  /**
   * 弹窗宽，px 走 style 而不是 max-w-* 类：控件阶梯会把 Tailwind 的尺寸名压平，
   * 而这张卡片要的就是「屏宽不够时自己缩、够的时候钉死这个数」。
   */
  width: number
  onClose?: () => void
  children: ReactNode
}

/**
 * 项目页那两扇窗（设置／成员）共用的外壳——本站那种小弹窗：居中一张卡，半透明遮罩盖住整屏，
 * 窗头钉着不动、正文自己滚。
 * 走 ui/dialog 那枚 Radix 原语而不是自己再搭一层：焦点陷阱、背后滚动锁住、Escape 只关最上面那层
 * （移除成员那一步的确认框叠在它上面时不该把窗也带走）、关掉把焦点还给打开它的按钮——
 * 这四件事复制第二遍，下次只会修其中一遍。
 */
export function ProjectOverlay({ tutorial, title, subtitle, actions, width, onClose, children }: ProjectOverlayProps) {
  const tc = useTranslations('common')
  /**
   * Radix 把这扇窗的焦点还原交给 Dialog.Trigger，而这两扇窗是页面用 open 状态控的、没有 Trigger 那枚子节点，
   * 所以开窗那一刻的焦点得自己记下（Radix 把焦点收进窗之前先调这个回调），关窗时交还给它。
   */
  const openerRef = useRef<HTMLElement | null>(null)

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose?.() }}>
      <DialogContent
        hideClose
        aria-label={title}
        aria-modal="true"
        data-tutorial={`${tutorial}-panel`}
        overlayProps={{ 'data-tutorial': `${tutorial}-overlay` }}
        onOpenAutoFocus={() => { openerRef.current = document.activeElement as HTMLElement | null }}
        onCloseAutoFocus={(event) => { event.preventDefault(); openerRef.current?.focus() }}
        className="flex flex-col gap-0 overflow-hidden rounded-[8px] border-0 bg-popover p-0 shadow-elevation-lg sm:p-0"
        style={{ width: 'calc(100% - 2rem)', maxWidth: width }}
      >
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2 sm:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              data-tutorial={`${tutorial}-close`}
              onClick={onClose}
              aria-label={tc('close')}
              className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <DialogTitle className="truncate text-lg font-semibold">{title}</DialogTitle>
              {subtitle ? <DialogDescription className="truncate text-xs text-muted-foreground">{subtitle}</DialogDescription> : null}
            </div>
          </div>
          {actions}
        </div>
        <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto">{children}</div>
      </DialogContent>
    </Dialog>
  )
}
