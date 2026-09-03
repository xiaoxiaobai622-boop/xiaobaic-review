'use client'

import { useEffect, useState } from 'react'
import { Check, Copy, KeyRound, Plus } from 'lucide-react'
import { getPlatformAccessToken } from '@/lib/platform-token-store'

type CardItem = {
  id: string
  codeLast4: string
  planKey: string
  durationDays: number
  maxMembers: number
  maxStorageGB: number
  status: string
  redeemedAt: string | null
  createdAt: string
}

function headers(json = false) {
  const token = getPlatformAccessToken()
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

export default function PlatformCardsPage() {
  const [cards, setCards] = useState<CardItem[]>([])
  const [quantity, setQuantity] = useState('1')
  const [newCodes, setNewCodes] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [message, setMessage] = useState('')

  const loadCards = async () => {
    const response = await fetch('/api/platform/cards', { headers: headers() })
    if (response.ok) setCards((await response.json()).cards || [])
    setLoading(false)
  }

  useEffect(() => { void loadCards() }, [])

  const generate = async () => {
    if (generating) return
    setGenerating(true)
    setMessage('')
    const response = await fetch('/api/platform/cards', {
      method: 'POST',
      headers: headers(true),
      body: JSON.stringify({ quantity: Number(quantity) || 1 }),
    })
    const data = await response.json().catch(() => null)
    if (response.ok) {
      setNewCodes((data.cards || []).map((card: { code: string }) => card.code))
      setMessage(`已生成 ${data.cards?.length || 0} 张月卡`)
      await loadCards()
    } else {
      setMessage(data?.error || '生成失败')
    }
    setGenerating(false)
  }

  const copyCodes = async () => {
    if (newCodes.length === 0) return
    await navigator.clipboard.writeText(newCodes.join('\n'))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><KeyRound className="h-4 w-4 text-primary" />卡密管理</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-normal">生成月卡</h1>
        <p className="mt-1 text-sm text-muted-foreground">月卡有效期 30 天，10 名成员，50 GB 存储；项目和视频数量不限。</p>
      </div>

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <label className="block max-w-[180px] space-y-1.5 text-sm font-medium">
            <span>生成数量</span>
            <input type="number" min={1} max={100} value={quantity} onChange={(event) => setQuantity(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary" />
          </label>
          <button type="button" onClick={generate} disabled={generating} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"><Plus className="h-4 w-4" />{generating ? '生成中...' : '生成月卡'}</button>
        </div>
        {message && <p className="mt-4 text-sm text-muted-foreground" role="status">{message}</p>}
        {newCodes.length > 0 && <div className="mt-4 rounded-md border border-primary/30 bg-primary-visible p-4"><div className="flex items-center justify-between gap-3"><p className="text-sm font-medium">本次生成的卡密</p><button type="button" onClick={copyCodes} className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"><Copy className="h-3.5 w-3.5" />{copied ? '已复制' : '复制全部'}</button></div><pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-sm leading-6">{newCodes.join('\n')}</pre><p className="mt-3 text-xs text-muted-foreground">卡密只在生成后显示完整内容，请立即保存。</p></div>}
      </section>

      <section className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-4"><h2 className="text-sm font-semibold">生成记录</h2><span className="text-xs text-muted-foreground">最近 200 张</span></div>
        {loading ? <div className="p-8 text-center text-sm text-muted-foreground">正在加载...</div> : cards.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">暂无卡密记录。</div> : <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-sm"><thead><tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground"><th className="px-5 py-3 font-medium">卡密</th><th className="px-3 py-3 font-medium">规格</th><th className="px-3 py-3 font-medium">状态</th><th className="px-3 py-3 font-medium">生成时间</th></tr></thead><tbody>{cards.map((card) => <tr key={card.id} className="border-b border-border last:border-0"><td className="px-5 py-3 font-mono text-xs">••••-{card.codeLast4}</td><td className="px-3 py-3 text-muted-foreground">30 天 · {card.maxMembers} 人 · {card.maxStorageGB} GB</td><td className="px-3 py-3"><span className={`inline-flex items-center gap-1.5 text-xs font-medium ${card.status === 'AVAILABLE' ? 'text-emerald-600' : 'text-muted-foreground'}`}>{card.status === 'AVAILABLE' && <Check className="h-3.5 w-3.5" />}{card.status === 'AVAILABLE' ? '可使用' : '已使用'}</span></td><td className="px-3 py-3 text-muted-foreground">{new Date(card.createdAt).toLocaleString('zh-CN')}</td></tr>)}</tbody></table></div>}
      </section>
    </div>
  )
}
