'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, Loader2, MessageCircle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { setTokens } from '@/lib/token-store'

interface WechatMiniQrLoginSuccess {
  status: 'success'
  user?: {
    id: string
    nickname?: string | null
    avatarUrl?: string | null
    linked?: boolean
  } | null
  returnUrl: string
  needsOnboarding?: boolean
  adminTokens?: {
    accessToken: string
    refreshToken: string
  } | null
}

interface WechatMiniQrLoginProps {
  returnUrl: string
  mode?: 'login' | 'bind'
  onSuccess?: (data: WechatMiniQrLoginSuccess) => void
  onBound?: () => void
  className?: string
  children?: ReactNode
  inline?: boolean
}

type QrPhase = 'idle' | 'loading' | 'ready' | 'error' | 'success'

export function WechatMiniQrLogin({
  returnUrl,
  mode = 'login',
  onSuccess,
  onBound,
  className,
  children,
  inline = false,
}: WechatMiniQrLoginProps) {
  const [open, setOpen] = useState(Boolean(inline))
  const [phase, setPhase] = useState<QrPhase>('idle')
  const [qrImage, setQrImage] = useState('')
  const [message, setMessage] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelledRef = useRef(false)
  const inlineStartedRef = useRef(false)
  const qrIdRef = useRef('')

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const close = useCallback(() => {
    cancelledRef.current = true
    clearTimer()
    setOpen(false)
    setPhase('idle')
    setQrImage('')
    setMessage('')
  }, [clearTimer])

  const pollStatus = useCallback(async () => {
    if (cancelledRef.current) return

    try {
      const statusUrl = qrIdRef.current
        ? `/api/auth/wechat/mini/qr/status?qrId=${encodeURIComponent(qrIdRef.current)}`
        : '/api/auth/wechat/mini/qr/status'
      const response = await fetch(statusUrl, { cache: 'no-store' })
      const data = await response.json()
      if (cancelledRef.current) return

      // 绑定模式成功
      if (data.status === 'bound') {
        setPhase('success')
        setMessage('微信绑定成功')
        onBound?.()
        timerRef.current = setTimeout(close, 800)
        return
      }

      if (data.status === 'success') {
        if (data.adminTokens?.accessToken && data.adminTokens?.refreshToken) {
          setTokens({
            accessToken: data.adminTokens.accessToken,
            refreshToken: data.adminTokens.refreshToken,
          })
        }

        setPhase('success')
        setMessage('登录成功')
        if (data.needsOnboarding) {
          window.location.href = `/onboarding?returnUrl=${encodeURIComponent(data.returnUrl || returnUrl || '/studio/projects')}`
          return
        }
        if (inline) {
          const target = data.returnUrl || returnUrl || '/studio/projects'
          window.location.href = target
          return
        }
        onSuccess?.(data)
        timerRef.current = setTimeout(close, 450)
        return
      }

      if (data.status === 'expired') {
        setPhase('error')
        setMessage('小程序码已过期，请重新获取')
        return
      }

      if (data.status === 'error') {
        setPhase('error')
        setMessage('登录状态查询失败，请重试')
        return
      }

      if (data.status === 'confirming') {
        setMessage('扫码成功，请在小程序确认')
      } else {
        setMessage('请使用微信扫码')
      }
      timerRef.current = setTimeout(pollStatus, 2000)
    } catch {
      timerRef.current = setTimeout(pollStatus, 2500)
    }
  }, [close, inline, onSuccess, returnUrl])

  const start = useCallback(async () => {
    cancelledRef.current = false
    setOpen(true)
    setPhase('loading')
    setMessage('正在生成微信小程序码...')

    try {
      const response = await fetch('/api/auth/wechat/mini/qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnUrl, mode }),
      })
      const data = await response.json()
      if (cancelledRef.current) return

      if (!response.ok) {
        throw new Error(data.error || '生成小程序码失败')
      }

      setQrImage(data.qrImage)
      qrIdRef.current = data.qrId || ''
      setPhase('ready')
      setMessage('请使用微信扫码')
      void pollStatus()
    } catch (error) {
      if (cancelledRef.current) return
      setPhase('error')
      setMessage(error instanceof Error ? error.message : '生成小程序码失败')
    }
  }, [pollStatus, returnUrl])

  useEffect(() => {
    if (inline && !inlineStartedRef.current) {
      inlineStartedRef.current = true
      void start()
    }
  }, [inline, start])

  useEffect(() => {
    return () => {
      cancelledRef.current = true
      clearTimer()
    }
  }, [clearTimer])

  const qrContent = (
    <>
      {!inline && (
        <h2 id="wechat-qr-login-title" className="text-xl font-semibold text-foreground">
          微信扫码登录
        </h2>
      )}
      <p className="mt-2 min-h-10 text-sm leading-6 text-muted-foreground">{message}</p>

      <div className="mx-auto mt-5 flex h-[280px] w-[280px] items-center justify-center rounded-lg border border-border bg-muted/30">
        {phase === 'loading' && <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />}
        {phase === 'ready' && qrImage && (
          <img src={qrImage} alt="微信小程序登录码" className="h-[272px] w-[272px] object-contain" />
        )}
        {phase === 'success' && <Check className="h-10 w-10 text-[#07c160]" />}
        {phase === 'error' && (
          <button
            type="button"
            className="text-sm font-medium text-primary hover:underline"
            onClick={start}
          >
            重新获取
          </button>
        )}
      </div>
    </>
  )

  if (inline) {
    return (
      <div className={className}>
        {qrContent}
      </div>
    )
  }

  return (
    <>
      <Button type="button" variant="outline" className={className} onClick={start}>
        {children || (
          <>
            <MessageCircle className="mr-2 h-4 w-4" />
            微信登录
          </>
        )}
      </Button>

      {open && createPortal(
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="wechat-qr-login-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close()
          }}
        >
          <div className="relative w-full max-w-[360px] rounded-xl border border-border bg-card p-6 text-center shadow-2xl">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-3 top-3 h-8 w-8 text-muted-foreground"
              onClick={close}
              aria-label="关闭微信登录"
            >
              <X className="h-4 w-4" />
            </Button>
            {qrContent}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
