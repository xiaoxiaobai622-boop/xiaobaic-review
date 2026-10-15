'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { copyTextToClipboard } from '@/lib/clipboard'

type IdentityTeam = { id: string; slug: string; shareKey?: string | null }

const LABELS = { id: '团队 ID', slug: '团队标识', shareKey: '分享键' } as const
type Field = keyof typeof LABELS

/**
 * 运营后台里那三串号的同一份写法：ID 用来定位（接口、日志、工单），团队标识是加入链接那一段，
 * 分享键是客户手上那条地址最前面那串。列表卡片、授权详情页、首页团队表共用这一份——
 * 分三处各写一遍就是「叫法各漂一次」的开始。
 */
export default function PlatformTeamIdentity({
  team,
  fields = ['id', 'slug', 'shareKey'],
  className = '',
}: {
  team: IdentityTeam
  fields?: Field[]
  className?: string
}) {
  const [copiedValue, setCopiedValue] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const copy = async (value: string) => {
    // 按了没反应和复制成功是两件事：clipboard 在非安全上下文里会直接失败，那时必须说出来。
    const ok = await copyTextToClipboard(value)
    setFailed(!ok)
    setCopiedValue(ok ? value : null)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setCopiedValue(null)
      setFailed(false)
    }, 1600)
  }

  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 ${className}`}>
      {fields.map((field) => {
        const value = team[field]
        if (!value) return null
        return (
          <button
            key={field}
            type="button"
            onClick={() => copy(value)}
            title={`复制${LABELS[field]}`}
            className="group inline-flex items-baseline gap-1.5 rounded px-1 py-0.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className="shrink-0 text-[11px] text-muted-foreground">{LABELS[field]}</span>
            <span className="break-all font-medium tabular-nums text-foreground">{value}</span>
            {copiedValue === value
              ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
              : <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden />}
          </button>
        )
      })}
      {failed && <span role="status" className="text-[11px] text-destructive">复制失败</span>}
      {!failed && copiedValue && <span role="status" className="text-[11px] text-muted-foreground">已复制</span>}
    </div>
  )
}
