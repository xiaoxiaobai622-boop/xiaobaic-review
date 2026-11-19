'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, Copy, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { apiPost } from '@/lib/api-client'
import { copyTextToClipboard } from '@/lib/clipboard'

/** 项目中心顶栏的团队邀请入口：生成链接、复制，复杂设置走成员管理。 */
export default function TeamInviteButton({
  teamId,
  teamName,
}: {
  teamId: string | null
  teamName?: string | null
}) {
  const [open, setOpen] = useState(false)
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setOpen(false)
    setLink('')
    setError('')
    setCopied(false)
  }, [teamId])

  useEffect(() => {
    if (!open || !teamId || link) return
    let cancelled = false
    setBusy(true)
    setError('')
    apiPost<{ invite: { token: string; expiresAt: string } }>(`/api/teams/${teamId}/invitations`, {
      method: 'LINK',
      phone: null,
      email: null,
      role: 'MEMBER',
      projectAccessScope: 'ALL_PROJECTS',
      defaultProjectRole: 'EDITOR',
    })
      .then((data) => {
        if (cancelled) return
        setLink(`${window.location.origin}/studio/team/invite/${encodeURIComponent(data.invite.token)}`)
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '邀请链接生成失败')
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => { cancelled = true }
  }, [open, teamId, link])

  const copy = async () => {
    if (!link) return
    const ok = await copyTextToClipboard(link)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } else {
      setError('复制失败，请手动选中链接复制')
    }
  }

  if (!teamId) return null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-9 gap-1.5 px-2.5 text-sm">
          <UserPlus className="h-4 w-4" />
          邀请
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100%-2rem)] max-w-[520px] !rounded-lg">
        <DialogHeader>
          <DialogTitle>邀请成员加入{teamName ? `「${teamName}」` : '团队'}</DialogTitle>
          <DialogDescription>链接 7 天内有效；对方登录后即可加入团队，默认成员权限、可访问全部项目。</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {busy ? (
            <p className="rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">正在生成邀请链接…</p>
          ) : link ? (
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={link}
                aria-label="团队邀请链接"
                onFocus={(event) => event.currentTarget.select()}
                className="min-w-0 flex-1 font-mono text-xs"
              />
              <Button type="button" onClick={copy}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? '已复制' : '复制'}
              </Button>
            </div>
          ) : null}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <Link
            href="/studio/team/members"
            onClick={() => setOpen(false)}
            className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            成员管理
          </Link>
          <DialogClose asChild>
            <Button type="button" variant="outline">关闭</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
