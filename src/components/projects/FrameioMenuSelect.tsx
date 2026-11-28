'use client'

import { useId, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import ReviewPopup from '@/components/ReviewPopup'
import { cn } from '@/lib/utils'

export interface FrameioMenuSelectOption {
  value: string
  label: string
}

interface FrameioMenuSelectProps {
  value: string
  options: FrameioMenuSelectOption[]
  onChange: (value: string) => void
  ariaLabel: string
  variant?: 'inline' | 'field'
  align?: 'start' | 'end'
  className?: string
}

export default function FrameioMenuSelect({
  value,
  options,
  onChange,
  ariaLabel,
  variant = 'inline',
  align = 'end',
  className,
}: FrameioMenuSelectProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const id = useId()
  const selected = options.find((option) => option.value === value)
  const field = variant === 'field'

  return (
    <div className={cn(field ? 'w-full' : 'relative shrink-0', className)}>
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          'flex items-center gap-1 rounded-[4px] text-[13px] font-[420] leading-5 text-[#181b29] outline-none transition-colors hover:bg-[#2c30410d] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#63677d] dark:text-foreground dark:hover:bg-foreground/10 dark:focus-visible:outline-muted-foreground',
          field
            ? 'h-8 w-full justify-between rounded-[6px] border border-[#dee0ed] bg-white px-2 dark:border-border dark:bg-secondary'
            : 'h-6 justify-end px-2'
        )}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={ariaLabel}
      >
        <span className="truncate">{selected?.label ?? ''}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[#4c5067] dark:text-muted-foreground" aria-hidden="true" />
      </button>

      <ReviewPopup
        id={id}
        open={open}
        onOpenChange={setOpen}
        anchor={triggerRef}
        label={ariaLabel}
        role="menu"
        side="bottom"
        align={align}
        width={field ? 240 : 180}
        menuSurface
      >
        <div data-frameio-select-layer="true" className="py-2" role="none">
          {options.map((option) => {
            const active = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className="flex min-h-[34px] w-full items-center gap-2 px-4 text-left text-[13px] font-[420] leading-5 text-[#181b29] outline-none hover:bg-[#2c30410d] focus-visible:bg-[#2c30410d] dark:text-foreground dark:hover:bg-foreground/10 dark:focus-visible:bg-foreground/10"
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                  triggerRef.current?.focus({ preventScroll: true })
                }}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {active && <Check className="h-4 w-4 shrink-0 text-[#181b29] dark:text-foreground" aria-hidden="true" />}
              </button>
            )
          })}
        </div>
      </ReviewPopup>
    </div>
  )
}
