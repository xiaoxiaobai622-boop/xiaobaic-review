'use client'

import { useEffect, useState } from 'react'
import { Bell, BellOff, Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)))
}

const TEAM_EVENTS = ['CLIENT_COMMENT', 'CLIENT_UPLOAD', 'VIDEO_APPROVAL', 'DUE_DATE_REMINDER']

type Surface = 'none' | 'main' | 'support' | 'unknown'

export function TeamPushSetup() {
  const [supported, setSupported] = useState(false)
  const [surface, setSurface] = useState<Surface>('none')
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
        if (!existing) {
          if (!cancelled) setSurface('none')
          return
        }
        const response = await apiFetch(`/api/push/status?endpoint=${encodeURIComponent(existing.endpoint)}`, { cache: 'no-store' })
        if (!response.ok) {
          if (!cancelled) setSurface('unknown')
          return
        }
        const data = await response.json().catch(() => null)
        const owner = data?.subscription?.surface
        if (!cancelled) setSurface(owner === 'main' ? 'main' : owner === 'support' ? 'support' : 'none')
      } catch {
        if (!cancelled) setSurface('unknown')
      }
    })()
    return () => { cancelled = true }
  }, [])

  const enable = async () => {
    if (!supported || busy) return
    if (surface === 'support') {
      setMessage('这台设备已在客服 PWA 开启通知；团队通知不能与客服 PWA 共用，请先在客服 PWA 关闭。')
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const permissionResult = await Notification.requestPermission()
      setPermission(permissionResult)
      if (permissionResult !== 'granted') {
        setMessage(permissionResult === 'denied' ? '通知权限被拒绝，请在浏览器设置中允许。' : '未获得通知权限。')
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
          deviceName: '团队通知',
          surface: 'main',
          subscribedEvents: TEAM_EVENTS,
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error || '订阅失败')
      }
      setSurface('main')
      setMessage('已开启团队通知。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '订阅失败')
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    if (!supported || busy) return
    if (surface !== 'main') {
      setMessage('这台设备不属于团队通知，不能在这里退订。')
      return
    }
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
      setSurface('none')
      setMessage('已关闭团队通知。')
    } finally {
      setBusy(false)
    }
  }

  if (!supported) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bell className="h-4 w-4 text-primary" />
          团队通知
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          只接收你管理的团队的批注、上传、审批和到期提醒；客服与登录消息不会到这里。
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {surface === 'support' ? (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            这台设备已在客服 PWA 开启通知；团队通知不能与客服 PWA 共用。请先在客服 PWA 关闭后再开启。
          </p>
        ) : (
          <Button
            type="button"
            variant={surface === 'main' ? 'outline' : 'default'}
            onClick={surface === 'main' ? disable : enable}
            disabled={busy || surface === 'unknown'}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : surface === 'main' ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
            {surface === 'main' ? '团队通知已开启（点击关闭）' : '开启团队通知'}
          </Button>
        )}
        {surface === 'unknown' && <p className="text-xs text-muted-foreground">无法确认这台设备的推送归属，请刷新后重试。</p>}
        {permission === 'denied' && <p className="text-xs text-muted-foreground">通知权限被拒绝，请在浏览器设置中允许。</p>}
        {message && <p className="text-xs text-muted-foreground">{message}</p>}
      </CardContent>
    </Card>
  )
}
