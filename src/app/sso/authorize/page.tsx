'use client'
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { apiFetch } from '@/lib/api-client'
import { useAuth } from '@/components/AuthProvider'
import { DOCS_SSO_REDIRECT_URI } from '@/lib/docs-sso-constants'

function AuthorizeInner() {
  const params = useSearchParams()
  const { user } = useAuth()
  const [error, setError] = useState('')
  useEffect(() => {
    if (!user) return
    const redirectUri = params?.get('redirect_uri') || ''
    const state = params?.get('state') || ''
    if (redirectUri !== DOCS_SSO_REDIRECT_URI) { setError('redirect_uri 不合法'); return }
    apiFetch('/api/auth/sso/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirectUri, state }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.code) throw new Error(data.error || '授权失败')
        window.location.replace(`${redirectUri}?code=${encodeURIComponent(data.code)}&state=${encodeURIComponent(state)}`)
      })
      .catch((e) => setError(e instanceof Error ? e.message : '授权失败'))
  }, [user, params])
  return <div style={{ padding: 24 }}>{error || '正在跳转到飞阅文档…'}</div>
}

export default function SsoAuthorizePage() {
  return <Suspense fallback={<div style={{ padding: 24 }}>加载中…</div>}><AuthorizeInner /></Suspense>
}
