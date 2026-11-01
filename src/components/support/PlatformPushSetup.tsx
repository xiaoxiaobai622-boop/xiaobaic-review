'use client'

import { useEffect, useState } from 'react'
import { Bell, BellOff, Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'

function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)))
}

export function PlatformPushSetup() {
  const [supported, setSupported] = useState(false)
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('unsupported')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const ok = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
      if (!cancelled) {
        setSupported(ok)
        if (ok) setPermission(Notification.permission)
      }
      if (!ok) return
      try {
        const registration = await navigator.serviceWorker.ready
        const existing = await registration.pushManager.getSubscription()
        if (!cancelled) setSubscribed(Boolean(existing))
      } catch {}
    })()
    return () => { cancelled = true }
  }, [])

  const enable = async () => {
    if (!supported || busy) return
    setBusy(true)
    setMessage(null)
    try {
      const permissionResult = await Notification.requestPermission()
      setPermission(permissionResult)
      if (permissionResult !== 'granted') {
        setMessage(permissionResult === 'denied' ? '通知权限被拒绝，请在 iPhone 设置 → 通知中允许。' : '未获得通知权限。')
        return
      }

      const keyResponse = await apiFetch('/api/push/vapid-public-key', { cache: 'no-store' })
      if (!keyResponse.ok) throw new Error('无法读取推送公钥')
      const { publicKey } = await keyResponse.json()
      if (!publicKey) throw new Error('推送公钥为空')

      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })
      const json = subscription.toJSON()
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error('推送订阅不完整')

      const response = await apiFetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys,
          deviceName: '运营 PWA',
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error || '订阅失败')
      }
      setSubscribed(true)
      setMessage('已开启新客服消息推送。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '订阅失败')
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    if (!supported || busy) return
    setBusy(true)
    setMessage(null)
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        await apiFetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => {})
        await subscription.unsubscribe()
      }
      setSubscribed(false)
      setMessage('已关闭推送。')
    } finally {
      setBusy(false)
    }
  }

  if (!supported) {
    return <span className="text-[11px] text-muted-foreground">此浏览器不支持 Web Push</span>
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={subscribed ? disable : enable}
        disabled={busy}
        className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs disabled:opacity-50 ${subscribed ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-border hover:bg-accent'}`}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : subscribed ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
        {subscribed ? '推送已开启' : '开启推送'}
      </button>
      {permission === 'denied' && <span className="text-[10px] text-muted-foreground">权限被拒绝，请到系统设置允许通知</span>}
      {message && <span className="max-w-[260px] text-right text-[10px] text-muted-foreground">{message}</span>}
    </div>
  )
}
