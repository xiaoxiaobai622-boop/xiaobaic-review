'use client'

import { FormEvent, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import { setPlatformTokens } from '@/lib/platform-token-store'

export default function PlatformLoginPage() {
  const searchParams = useSearchParams()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/platform/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '登录失败')
      setPlatformTokens(data.tokens)
      const returnUrl = searchParams?.get('returnUrl')
      const target = returnUrl?.startsWith('/platform') ? returnUrl : '/platform'
      window.location.href = target
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-sm pt-16">
      <div className="mb-6 text-center">
        <ShieldCheck className="mx-auto h-10 w-10 text-primary" />
        <h1 className="mt-3 text-2xl font-semibold">平台运营登录</h1>
        <p className="mt-1 text-sm text-muted-foreground">此入口与团队后台分离</p>
      </div>
      <form onSubmit={submit} className="space-y-3 rounded-lg border border-border bg-card p-5 shadow-sm">
        <input
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          placeholder="平台账号"
          className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
        />
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="密码"
          className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="h-10 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {loading ? '登录中...' : '登录平台'}
        </button>
      </form>
    </div>
  )
}
