'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { apiFetch, apiPost } from '@/lib/api-client'

export default function JoinTeamPage() {
  const [query, setQuery] = useState('')
  const [team, setTeam] = useState<any>(null)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const searchBySlug = async (value: string) => {
    const slug = value.trim()
    if (!slug) return
    setLoading(true)
    setError('')
    setSuccess('')
    setTeam(null)
    try {
      const response = await apiFetch(`/api/teams/by-slug/${encodeURIComponent(slug)}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '团队不存在')
      setTeam(data.team)
    } catch (err) {
      setError(err instanceof Error ? err.message : '查询失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get('q')
    if (initial) {
      setQuery(initial)
      void searchBySlug(initial)
    }
  }, [])

  const search = async () => {
    await searchBySlug(query)
  }

  const apply = async () => {
    if (!team) return
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      await apiPost(`/api/teams/${team.id}/join-requests`, { message })
      setSuccess('申请已提交，等待团队创建人或管理员审核。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '申请失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl p-4 sm:p-6">
      <Card>
        <CardHeader>
          <CardTitle>申请加入团队</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="输入团队链接后缀或团队名称"
            />
            <Button type="button" onClick={search} disabled={loading || !query.trim()}>查询</Button>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {success && <p className="text-sm text-primary">{success}</p>}

          {team && (
            <div className="rounded-lg border border-border p-4">
              <p className="font-medium">{team.name}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {team._count.members} 名成员 · {team._count.projects} 个项目
              </p>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="说明你的身份和申请原因（可选）"
                className="mt-3 min-h-24 w-full rounded-md border border-border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-primary"
              />
              <Button type="button" className="mt-3" onClick={apply} disabled={loading}>提交申请</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
