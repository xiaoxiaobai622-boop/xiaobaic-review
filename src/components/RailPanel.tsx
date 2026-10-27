'use client'

import { ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import motion from '@/components/ui/surface-motion.module.css'
import { cn } from '@/lib/utils'

interface RailPanelProps {
  name: string
  label: string
  closeLabel: string
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: ReactNode
  actions?: ReactNode
  children: ReactNode
}

/** 窄栏旁那块 288px 栏面的共用外壳：开合动效、Esc/点外面关闭、焦点进出都归这里。 */
export default function RailPanel({ name, label, closeLabel, open, onOpenChange, trigger, actions, children }: RailPanelProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Content
          data-rail-panel={name}
          aria-describedby={undefined}
          className={cn(
            'fixed bottom-0 left-14 top-0 z-50 flex w-[288px] flex-col border-r border-border bg-popover outline-none lg:left-[56px]',
            motion.surface,
            motion.railPanel,
          )}
        >
          <div className="flex h-9 shrink-0 items-center justify-between px-3">
            <Dialog.Title className="text-sm font-medium text-foreground">{label}</Dialog.Title>
            <span className="flex items-center gap-1">
              {actions}
              <Dialog.Close
                aria-label={closeLabel}
                className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-4 w-4" aria-hidden />
              </Dialog.Close>
            </span>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
