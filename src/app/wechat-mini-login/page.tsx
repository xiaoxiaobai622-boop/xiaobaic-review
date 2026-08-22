'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import BrandLogo from '@/components/BrandLogo'
import { setTokens } from '@/lib/token-store'
import { ArrowLeft, Loader2 } from 'lucide-react'

function safeReturnUrl(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/portal'
  return value
}

function WechatMiniLoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnUrl = safeReturnUrl(searchParams?.get('returnUrl'))
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'success'>('loading')
  const [qrImage, setQrImage] = useState('')
  const [message, setMessage] = useState('正在生成微信小程序码...')
  const stoppedRef = useRef(false)

  useEffect(() => {
    let cancelled = false

    async function start() {
      try {
        const response = await fetch('/api/auth/wechat/mini/qr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ returnUrl }),
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || '生成小程序码失败')
        if (cancelled) return
        setQrImage(data.qrImage)
        setState('ready')
        setMessage('请使用微信扫码')
        pollStatus()
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : '生成小程序码失败')
          setState('error')
        }
      }
    }

    async function pollStatus() {
      if (stoppedRef.current) return
      try {
        const response = await fetch('/api/auth/wechat/mini/qr/status', { cache: 'no-store' })
        const data = await response.json()
        if (cancelled || stoppedRef.current) return
        if (data.status === 'success') {
          if (data.adminTokens?.accessToken && data.adminTokens?.refreshToken) {
            setTokens({
              accessToken: data.adminTokens.accessToken,
              refreshToken: data.adminTokens.refreshToken,
            })
          }
          setState('success')
          setMessage('登录成功')
          window.setTimeout(() => {
            const target = data.needsOnboarding
              ? `/onboarding?returnUrl=${encodeURIComponent(safeReturnUrl(data.returnUrl))}`
              : safeReturnUrl(data.returnUrl)
            router.replace(target)
            router.refresh()
          }, 450)
          return
        }
        if (data.status === 'expired') {
          setState('error')
          setMessage('小程序码已过期，请刷新后重试')
          return
        }
        if (data.status === 'error') {
          setState('error')
          setMessage('登录状态查询失败，请重试')
          return
        }
        if (data.status === 'confirming') {
          setMessage('扫码成功，请在小程序确认')
        } else {
          setMessage('请使用微信扫码')
        }
        window.setTimeout(pollStatus, 2000)
      } catch {
        window.setTimeout(pollStatus, 2500)
      }
    }

    start()
    return () => {
      cancelled = true
      stoppedRef.current = true
    }
  }, [returnUrl, router])

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-md border border-border bg-card p-6 shadow-sm">
        <div className="mb-6 flex items-center justify-between">
          <BrandLogo height={38} />
          <Link href="/" className="inline-flex h-9 items-center gap-2 px-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />返回首页
          </Link>
        </div>

        <div className="space-y-5">
          <div>
            <h1 className="text-xl font-semibold text-foreground">微信扫码登录</h1>
            <p className="mt-2 text-sm text-muted-foreground">{message}</p>
          </div>

          <div className="flex min-h-[280px] items-center justify-center rounded-md border border-border bg-muted/30 p-4">
            {state === 'loading' && <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />}
            {state === 'ready' && qrImage && <img src={qrImage} alt="微信小程序登录码" className="h-64 w-64 object-contain" />}
            {state === 'error' && (
              <button
                type="button"
                className="text-sm font-medium text-primary hover:underline"
                onClick={() => window.location.reload()}
              >
                重新加载
              </button>
            )}
          </div>

          <p className="text-center text-xs text-muted-foreground">请使用微信扫一扫，扫码后在小程序里确认登录</p>
          <Link
            href={`/login?returnUrl=${encodeURIComponent(returnUrl)}`}
            className="mt-2 block text-center text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
          >
            使用手机号登录
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function WechatMiniLoginPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      </div>
    }>
      <WechatMiniLoginForm />
    </Suspense>
  )
}
