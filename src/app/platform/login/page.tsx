'use client'

import { FormEvent, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Fingerprint, ShieldCheck } from 'lucide-react'
import { startAuthentication } from '@simplewebauthn/browser'
import { isPlatformPwaMode, setPlatformPwaAccessToken, setPlatformTokens } from '@/lib/platform-token-store'

export default function PlatformLoginPage() {
  const searchParams = useSearchParams()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [twoFactorToken, setTwoFactorToken] = useState('')
  const [passkeyLoading, setPasskeyLoading] = useState(false)

  const finishLogin = (tokens: { accessToken?: string; refreshToken?: string } | undefined, pwa: boolean) => {
    if (!tokens?.accessToken) throw new Error('登录响应缺少令牌')
    if (pwa) setPlatformPwaAccessToken(tokens.accessToken)
    else setPlatformTokens({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken })
    const returnUrl = searchParams?.get('returnUrl')
    const target = returnUrl?.startsWith('/platform') ? returnUrl : '/platform'
    window.location.href = target
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      const pwa = isPlatformPwaMode()
      const response = await fetch('/api/platform/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ identifier, password, pwa }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '登录失败')
      if (data.requiresPasskey) {
        setTwoFactorToken(data.twoFactorToken || '')
        return
      }
      finishLogin(data.tokens, pwa)
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }

  const submitPasskey = async () => {
    if (!twoFactorToken) return
    setPasskeyLoading(true)
    setError('')
    try {
      const pwa = isPlatformPwaMode()
      const optionsResponse = await fetch('/api/platform/auth/passkey/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ twoFactorToken }),
      })
      const optionsData = await optionsResponse.json()
      if (!optionsResponse.ok || !optionsData.options) throw new Error(optionsData.error || '无法获取通行密钥选项')
      const assertion = await startAuthentication({ optionsJSON: optionsData.options })
      const verifyResponse = await fetch('/api/platform/auth/passkey/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ response: assertion, twoFactorToken, pwa }),
      })
      const verifyData = await verifyResponse.json()
      if (!verifyResponse.ok || !verifyData.success) throw new Error(verifyData.error || '通行密钥验证失败')
      finishLogin(verifyData.tokens, pwa)
    } catch (err) {
      setError(err instanceof Error ? err.message : '通行密钥验证失败')
    } finally {
      setPasskeyLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-sm pt-16">
      <div className="mb-6 text-center">
        <ShieldCheck className="mx-auto h-10 w-10 text-primary" />
        <h1 className="mt-3 text-2xl font-semibold">平台运营登录</h1>
        <p className="mt-1 text-sm text-muted-foreground">此入口与团队后台分离</p>
      </div>
      {twoFactorToken ? (
        <div className="space-y-4 rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Fingerprint className="h-4 w-4 text-primary" />
            密码已通过，请用通行密钥确认
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            这一步会调用设备上的 Face ID / Touch ID。若没有可用通行密钥，请联系另一个平台管理员重置。
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button
            type="button"
            onClick={() => void submitPasskey()}
            disabled={passkeyLoading}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            <Fingerprint className="h-4 w-4" />
            {passkeyLoading ? '等待设备确认...' : '使用 Face ID / 通行密钥'}
          </button>
          <button
            type="button"
            onClick={() => { setTwoFactorToken(''); setError('') }}
            className="w-full text-xs text-muted-foreground underline"
          >
            返回密码登录
          </button>
        </div>
      ) : (
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
      )}
    </div>
  )
}
