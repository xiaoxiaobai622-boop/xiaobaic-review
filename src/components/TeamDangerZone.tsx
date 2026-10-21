'use client'

import { useEffect, useState } from 'react'
import { LogOut, Trash2 } from 'lucide-react'
import { appAlert, appConfirm } from '@/components/AppDialogProvider'
import { useAuth } from '@/components/AuthProvider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { apiDelete, apiPost } from '@/lib/api-client'
import { maskPhoneDisplay } from '@/lib/phone-display'
import { setActiveTeamId } from '@/lib/team-store'

type TeamRole = 'OWNER' | 'ADMIN' | 'MEMBER'

export default function TeamDangerZone({
  team,
  role,
}: {
  team: { id: string; name: string }
  role: TeamRole
}) {
  const { user } = useAuth()
  const [busy, setBusy] = useState(false)
  const [dissolveOpen, setDissolveOpen] = useState(false)
  const [code, setCode] = useState('')
  const [codeNotice, setCodeNotice] = useState('')
  const [dissolveError, setDissolveError] = useState('')
  const [sendingCode, setSendingCode] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const isOwner = role === 'OWNER'
  const phone = maskPhoneDisplay(user?.phone)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  const leaveTeam = async () => {
    if (isOwner || busy) return
    const confirmed = await appConfirm({
      title: '退出团队',
      message: `确定退出「${team.name}」吗？退出后你将无法查看该团队的项目，也不再收到相关消息。`,
      confirmLabel: '退出团队',
      tone: 'destructive',
    })
    if (!confirmed) return

    setBusy(true)
    try {
      const data = await apiPost<{ nextTeamId?: string | null }>(`/api/teams/${team.id}/leave`, {})
      setActiveTeamId(data.nextTeamId || null)
      window.location.replace('/studio/team')
    } catch (error) {
      await appAlert({
        title: '退出失败',
        message: error instanceof Error ? error.message : '退出团队失败，请稍后重试。',
        tone: 'error',
      })
      setBusy(false)
    }
  }

  const openDissolve = () => {
    if (!isOwner || busy) return
    setCode('')
    setCodeNotice('')
    setDissolveError('')
    setCooldown(0)
    setDissolveOpen(true)
  }

  const sendDissolveCode = async () => {
    if (sendingCode || cooldown > 0) return
    if (!user?.phone) {
      setDissolveError('当前账号未绑定手机号，无法进行手机验证。')
      return
    }
    setSendingCode(true)
    setDissolveError('')
    setCodeNotice('')
    try {
      await apiPost('/api/account/phone', { action: 'send-old' })
      setCodeNotice(`验证码已发送到 ${phone || '当前手机号'}`)
      setCooldown(60)
    } catch (error) {
      setDissolveError(error instanceof Error ? error.message : '验证码发送失败，请稍后重试。')
    } finally {
      setSendingCode(false)
    }
  }

  const verifyAndDissolve = async () => {
    if (!isOwner || verifying) return
    if (!/^\d{6}$/.test(code)) {
      setDissolveError('请输入 6 位验证码。')
      return
    }
    setVerifying(true)
    setDissolveError('')
    try {
      const grant = await apiPost<{ token?: string }>('/api/account/phone', {
        action: 'verify',
        method: 'sms',
        code,
      })
      if (!grant.token) throw new Error('手机验证失败，请重新获取验证码。')
      await apiDelete(`/api/teams/${team.id}`, {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneVerificationToken: grant.token }),
      })
      setDissolveOpen(false)
      setActiveTeamId(null)
      window.location.replace('/select-team')
    } catch (error) {
      setDissolveError(error instanceof Error ? error.message : '解散团队失败，请稍后重试。')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <>
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-base text-destructive">危险操作</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm font-medium">退出团队</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {isOwner
                ? '创建人不能直接退出，请先转让团队或解散团队。'
                : '退出后将无法查看该团队的项目，也不再收到相关消息。'}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={isOwner || busy || dissolveOpen}
              onClick={() => void leaveTeam()}
            >
              <LogOut className="mr-1.5 h-3.5 w-3.5" />
              {busy ? '退出中…' : '退出团队'}
            </Button>
          </div>

          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-medium text-destructive">解散团队</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {isOwner
                ? '解散后资料无法恢复；需先清空项目和移除其他成员，有账单记录的团队不能解散。'
                : '只有团队创建人可以解散团队。'}
            </p>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="mt-3"
              disabled={!isOwner || busy || dissolveOpen}
              onClick={openDissolve}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              解散团队
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dissolveOpen} onOpenChange={(open) => { if (!verifying) setDissolveOpen(open) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>解散团队需要手机验证</DialogTitle>
            <DialogDescription>
              验证码将发送到当前手机号 {phone || '（未绑定）'}。验证通过后才会解散「{team.name}」，解散后资料无法恢复。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            <div className="flex gap-2">
              <Input
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
                placeholder="6 位验证码"
                disabled={verifying}
                aria-label="手机验证码"
              />
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={() => void sendDissolveCode()}
                disabled={sendingCode || cooldown > 0 || verifying || !user?.phone}
              >
                {sendingCode ? '发送中…' : cooldown > 0 ? `重新发送 (${cooldown}s)` : '发送验证码'}
              </Button>
            </div>
            {codeNotice && <p className="text-xs text-success">{codeNotice}</p>}
            {dissolveError && <p className="text-sm text-destructive" role="alert">{dissolveError}</p>}
            <p className="text-xs leading-relaxed text-muted-foreground">
              团队有项目、其他成员或账单记录时不能解散；请先处理这些内容。
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDissolveOpen(false)} disabled={verifying}>
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void verifyAndDissolve()}
              disabled={verifying || code.length !== 6 || !user?.phone}
            >
              {verifying ? '验证中…' : '验证并解散'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
