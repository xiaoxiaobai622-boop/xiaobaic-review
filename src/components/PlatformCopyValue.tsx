'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { copyTextToClipboard } from '@/lib/clipboard'

/**
 * 后台里「一串要拿去别处对上的号」的同一份写法：按一下就复制，按成没按成都说话。
 * 运营拿这串去查接口日志、回工单、对客户报的那条地址，所以值必须看得见、也必须拿得走。
 */
export default function PlatformCopyValue({ label, value, className = '' }: {
  label: string
  value: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const copy = async () => {
    // clipboard 在非安全上下文里会直接失败：那时必须说「复制失败」，不能按了没动静。
    const ok = await copyTextToClipboard(value)
    setFailed(!ok)
    setCopied(ok)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setCopied(false)
      setFailed(false)
    }, 1600)
  }

  if (!value) return null

  return (
    <>
      <button
        type="button"
        onClick={copy}
        title={`复制${label}`}
        className={`group inline-flex items-baseline gap-1.5 rounded px-1 py-0.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary ${className}`}
      >
        <span className="shrink-0 text-[11px] text-muted-foreground">{label}</span>
        <span className="break-all font-medium tabular-nums text-foreground">{value}</span>
        {copied
          ? <Check className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
          : <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden />}
      </button>
      {failed && <span role="status" className="text-[11px] text-destructive">复制失败</span>}
      {copied && !failed && <span role="status" className="text-[11px] text-muted-foreground">已复制</span>}
    </>
  )
}
