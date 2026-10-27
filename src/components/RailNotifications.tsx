'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, Settings } from 'lucide-react'
import RailPanel from '@/components/RailPanel'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api-client'
import { getDesktopBridge } from '@/lib/desktop-bridge'
import { formatDateTime } from '@/lib/utils'

interface ReplyItem {
  id: string
  content: string
  timecode: string
  createdAt: string
  authorName: string
  parentContent: string
  videoName: string
  projectTitle: string
  projectId: string
}

const SEEN_STORAGE_KEY = 'admin_notifications_seen_at'
/** 标题行那颗齿轮管的两枚开关：哪几类算进红点、未读数和桌面通知。 */
const KINDS_STORAGE_KEY = 'admin_notification_kinds'

type Kinds = { reply: boolean; announcement: boolean }

function readKinds(): Kinds {
  try {
    const raw = localStorage.getItem(KINDS_STORAGE_KEY)
    if (!raw) return { reply: true, announcement: true }
    const parsed = JSON.parse(raw) as Partial<Kinds>
    return { reply: parsed.reply !== false, announcement: parsed.announcement !== false }
  } catch {
    return { reply: true, announcement: true }
  }
}

function writeKinds(value: Kinds) {
  try { localStorage.setItem(KINDS_STORAGE_KEY, JSON.stringify(value)) } catch { /* 存不下就本次会话内有效 */ }
}
const REFRESH_INTERVAL_MS = 30_000

function readSeenAt(): string | null {
  try { return localStorage.getItem(SEEN_STORAGE_KEY) } catch { return null }
}

function writeSeenAt(value: string) {
  try { localStorage.setItem(SEEN_STORAGE_KEY, value) } catch { /* 隐私模式下存不下，不影响本次会话 */ }
}

// 桌面通知的水位要单独存：站内红点那套「上次查看时间」得按下「全部标记为已读」才推进，
// 拿它当通知水位会让没点过的人永远收不到，混着写又会互相抹掉水位。
const DESKTOP_SEEN_STORAGE_KEY = 'desktop_notifications_seen_at'

function readDesktopSeenAt(): string | null {
  try { return localStorage.getItem(DESKTOP_SEEN_STORAGE_KEY) } catch { return null }
}

function writeDesktopSeenAt(value: string) {
  try { localStorage.setItem(DESKTOP_SEEN_STORAGE_KEY, value) } catch { /* 存不下就退化成每次启动重建水位 */ }
}

/** createdAt 全是同一形态的 ISO 串，字典序即时间序。 */
function newestOf(values: string[]): string {
  return values.reduce((max, value) => (value > max ? value : max))
}

function relativeTime(value: string): string {
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  return formatDateTime(value)
}

/** 审阅链接的形态和飞书卡片用的深链一致：认素材名、带时间码，另外把要定位的那条回复带过去。 */
function replyHref(item: ReplyItem): string {
  const params = new URLSearchParams({ video: item.videoName, comment: item.id })
  if (item.timecode) params.set('t', item.timecode)
  return `/studio/projects/${item.projectId}/share?${params.toString()}`
}

interface PlatformItem {
  id: string
  title: string
  content: string
  createdAt: string
  readAt: string | null
}

interface InviteItem {
  id: string
  token: string
  role: string
  createdAt: string
  expiresAt: string
  team: { id: string; name: string }
}

type NotificationCategory = 'team' | 'platform' | 'personal'

/** 一拨数据一条流：类别退成每行的标记，不再两枚标签各占一屏。 */
type Entry =
  | { key: string; type: 'reply'; createdAt: string; unread: boolean; headline: string; body: string; where: string; item: ReplyItem }
  | { key: string; type: 'announcement'; createdAt: string; unread: boolean; headline: string; body: string; where: string; item: PlatformItem }
  | { key: string; type: 'invite'; createdAt: string; unread: boolean; headline: string; body: string; where: string; item: InviteItem }

const CATEGORY_LABEL: Record<NotificationCategory, string> = { team: '团队', platform: '平台', personal: '个人' }
const INVITE_ROLE_LABEL: Record<string, string> = { OWNER: '创建人', ADMIN: '管理员', MEMBER: '成员' }

export default function RailNotifications({ className, enabled = true }: { className?: string; enabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [category, setCategory] = useState<NotificationCategory>('team')
  const [invitations, setInvitations] = useState<InviteItem[]>([])
  const [invitesFailed, setInvitesFailed] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [kinds, setKinds] = useState<Kinds>({ reply: true, announcement: true })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [items, setItems] = useState<ReplyItem[]>([])
  const [failed, setFailed] = useState(false)
  const [platformItems, setPlatformItems] = useState<PlatformItem[]>([])
  // 「哪几条算这次新看到的」按水位算；水位没写过＝这台浏览器第一次看，全算未读。
  const [watermark, setWatermark] = useState<string | null>(null)
  const desktop = getDesktopBridge()
  const desktopSeenRef = useRef<string | null>(null)
  const router = useRouter()

  const load = useCallback(async (): Promise<ReplyItem[]> => {
    const since = readSeenAt()
    setWatermark(since)
    try {
      const query = since ? `?since=${encodeURIComponent(since)}` : ''
      const response = await apiFetch(`/api/comments/for-me${query}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(String(response.status))
      const data = await response.json()
      const loaded = (data.items || []) as ReplyItem[]
      setItems(loaded)
      setFailed(false)
      return loaded
    } catch {
      // 拉不到就留着上一次的列表，红点不该替网络状态说谎。
      setFailed(true)
      return []
    }
  }, [])

  const loadPlatform = useCallback(async (): Promise<PlatformItem[]> => {
    try {
      const response = await apiFetch('/api/announcements', { cache: 'no-store' })
      if (!response.ok) throw new Error(String(response.status))
      const data = await response.json()
      const loaded = (data.items || []) as PlatformItem[]
      setPlatformItems(loaded)
      return loaded
    } catch {
      return []
    }
  }, [])

  const loadInvitations = useCallback(async (): Promise<void> => {
    try {
      const response = await apiFetch('/api/team-center', { cache: 'no-store' })
      if (!response.ok) throw new Error(String(response.status))
      const data = await response.json()
      setInvitations(Array.isArray(data.invitations) ? data.invitations : [])
      setInvitesFailed(false)
    } catch {
      setInvitesFailed(true)
    }
  }, [])

  useEffect(() => {
    setKinds(readKinds())
    if (enabled) { load(); loadPlatform() }
    // 邀请跟随账号，不依赖当前团队；没有团队的账号也要能看到。
    void loadInvitations()
  }, [enabled, load, loadPlatform, loadInvitations])

  // 30 秒一次，且只在标签页可见时打（和审阅页那套刷新节奏一致）。
  // 客户端把窗口最小化或收进托盘时页面算「不可见」，而那正是最需要通知的时候，所以桌面端照样打。
  // 一轮各打一个端点＝每端点每分钟 2 次，两个端点都是每分钟 60 次的限流，撞不上。
  useEffect(() => {
    // 还没有团队的账号停在建团队页，没有项目可提醒；不开轮询，省掉两端点每 30 秒的空请求。
    if (!enabled) return
    const tick = () => { if (document.visibilityState === 'visible' || desktop) { load(); loadPlatform() } }
    const timer = window.setInterval(tick, REFRESH_INTERVAL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [desktop, enabled, load, loadPlatform])

  // 桌面端把每轮新拿到的条目转成系统通知；浏览器里 desktop 是 null，这一整段不跑。
  useEffect(() => {
    if (!desktop) return
    const stamps = [...items, ...platformItems].map((item) => item.createdAt)
    if (stamps.length === 0) return
    const newestStamp = newestOf(stamps)
    const seen = desktopSeenRef.current ?? readDesktopSeenAt()
    if (!seen) {
      // 第一轮只定水位、不发通知：不然刚装完就把列表里最新一批全弹一遍。
      desktopSeenRef.current = newestStamp
      writeDesktopSeenAt(newestStamp)
      return
    }
    const newReplies = kinds.reply ? items.filter((item) => item.createdAt > seen) : []
    const newMessages = kinds.announcement ? platformItems.filter((item) => item.createdAt > seen) : []
    if (newReplies.length > 0) {
      const newest = newReplies[0]
      desktop.notify(
        newReplies.length === 1
          ? {
              title: `${newest.authorName} 回复了你`,
              body: `${newest.projectTitle} · ${newest.videoName}${newest.timecode ? ` · ${newest.timecode}` : ''}`,
              href: replyHref(newest),
            }
          : {
              title: `${newReplies.length} 条新批注回复`,
              body: `${newest.authorName} 等 · ${newest.projectTitle}`,
              href: replyHref(newest),
            },
      )
    }
    if (newMessages.length > 0) {
      const newest = newMessages[0]
      // 平台消息只在面板里出现、没有独立路由，所以点通知只把窗口带回应用。
      desktop.notify(
        newMessages.length === 1
          ? { title: newest.title, body: newest.content }
          : { title: `${newMessages.length} 条新平台消息`, body: newest.title },
      )
    }
    if (newReplies.length > 0 || newMessages.length > 0) {
      desktopSeenRef.current = newestStamp
      writeDesktopSeenAt(newestStamp)
    }
  }, [desktop, items, platformItems, kinds])

  const close = () => {
    setOpen(false)
    setSettingsOpen(false)
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) { close(); return }
    // 打开只读、不写水位：清未读是标签行那颗按钮的事，别替用户按它。
    setOpen(true)
    void load()
    void loadPlatform()
    void loadInvitations()
  }

  const entries: Entry[] = [
    ...items.map((item) => ({
      key: `r-${item.id}`,
      type: 'reply' as const,
      createdAt: item.createdAt,
      unread: !watermark || new Date(item.createdAt) > new Date(watermark),
      headline: `${item.authorName} 回复了你`,
      body: item.content,
      where: `${item.projectTitle} › ${item.videoName}${item.timecode ? ` · ${item.timecode}` : ''}`,
      item,
    })),
    ...platformItems.map((item) => ({
      key: `a-${item.id}`,
      type: 'announcement' as const,
      createdAt: item.createdAt,
      unread: !item.readAt,
      headline: item.title,
      body: item.content,
      where: '平台消息',
      item,
    })),
    ...invitations.map((item) => ({
      key: `i-${item.id}`,
      type: 'invite' as const,
      createdAt: item.createdAt,
      unread: false,
      headline: `邀请你加入 ${item.team.name}`,
      body: `角色：${INVITE_ROLE_LABEL[item.role] || '成员'} · 点击查看并处理邀请`,
      where: item.team.name,
      item,
    })),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))

  const categoryOf = (entry: Entry): NotificationCategory => (
    entry.type === 'reply' ? 'team' : entry.type === 'announcement' ? 'platform' : 'personal'
  )
  const visible = entries.filter((entry) => {
    if (categoryOf(entry) !== category) return false
    if (entry.type === 'invite') return true
    return kinds[entry.type]
  })
  // 待处理邀请没有「已读」状态，但它确实需要人处理：一起算进窄栏红点和角标。
  const actionableUnread = entries.filter((entry) => entry.unread && (entry.type === 'reply' || entry.type === 'announcement') && kinds[entry.type]).length
  const unreadCount = actionableUnread + invitations.length
  const markableUnread = actionableUnread
  const shown = category === 'personal' || filter === 'all' ? visible : visible.filter((entry) => entry.unread)

  const markAllRead = async () => {
    const newestReply = items[0]?.createdAt
    if (newestReply) writeSeenAt(newestReply)
    setWatermark(newestReply || new Date().toISOString())
    if (platformItems.some((item) => !item.readAt)) {
      await apiFetch('/api/announcements/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: platformItems.map((item) => item.id) }),
      }).catch(() => null)
      setPlatformItems((current) => current.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() })))
    }
  }

  const openEntry = (entry: Entry) => {
    if (entry.type === 'reply') {
      close()
      router.push(replyHref(entry.item))
      return
    }
    if (entry.type === 'invite') {
      close()
      router.push(`/studio/team/invite/${encodeURIComponent(entry.item.token)}`)
      return
    }
    // 平台消息没有独立路由，就地展开/收起正文。
    setExpanded((current) => (current === entry.key ? null : entry.key))
  }

  return (
    <RailPanel
      name="notifications"
      label="通知"
      closeLabel="关闭通知"
      open={open}
      onOpenChange={handleOpenChange}
      trigger={(
        <button
          type="button"
          aria-label={unreadCount > 0 ? `${unreadCount} 条未读通知` : '通知'}
          title={unreadCount > 0 ? `${unreadCount} 条未读通知` : '通知'}
          className={cn(
            className,
            'relative',
            open ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-accent-foreground',
          )}
        >
          <Bell className="h-[20px] w-[20px]" aria-hidden="true" />
          {unreadCount > 0 && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-destructive" />}
        </button>
      )}
      actions={(
        <button
          type="button"
          onClick={() => setSettingsOpen((current) => !current)}
          aria-label="通知设置"
          aria-expanded={settingsOpen}
          className={cn('rounded p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', settingsOpen ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}
        >
          <Settings className="h-4 w-4" aria-hidden />
        </button>
      )}
    >
          {settingsOpen && (
            <div data-notification-settings className="shrink-0 border-b border-border px-3 py-2">
              <p className="text-xs text-muted-foreground">哪几类算进红点与桌面提醒</p>
              {([
                { key: 'reply' as const, label: '批注回复提醒' },
                { key: 'announcement' as const, label: '平台消息提醒' },
              ]).map((row) => (
                <button
                  key={row.key}
                  type="button"
                  role="switch"
                  aria-checked={kinds[row.key]}
                  onClick={() => {
                    const next = { ...kinds, [row.key]: !kinds[row.key] }
                    setKinds(next)
                    writeKinds(next)
                  }}
                  className="mt-1 flex w-full items-center justify-between gap-2 rounded px-1 py-1 text-left text-sm text-foreground transition-colors hover:bg-accent"
                >
                  {row.label}
                  <span className={cn('h-4 w-7 shrink-0 rounded-full p-0.5 transition-colors', kinds[row.key] ? 'bg-primary' : 'bg-muted')}>
                    <span className={cn('block h-3 w-3 rounded-full bg-white transition-transform', kinds[row.key] && 'translate-x-3')} />
                  </span>
                </button>
              ))}
              <p className="mt-1 text-xs text-muted-foreground">浏览器里只影响窄栏红点；桌面弹窗在客户端里才有效。</p>
            </div>
          )}

          <div role="tablist" aria-label="通知分类" className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-1.5">
            {(['team', 'platform', 'personal'] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={category === key}
                onClick={() => { setCategory(key); setExpanded(null) }}
                className={cn(
                  'rounded px-2 py-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  category === key ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {CATEGORY_LABEL[key]}{key === 'personal' && invitations.length > 0 ? ` ${invitations.length}` : ''}
              </button>
            ))}
          </div>

          {category !== 'personal' && (
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setFilter('all')}
                aria-pressed={filter === 'all'}
                className={cn('rounded px-2 py-0.5 transition-colors', filter === 'all' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                全部
              </button>
              <button
                type="button"
                onClick={() => setFilter('unread')}
                aria-pressed={filter === 'unread'}
                className={cn('rounded px-2 py-0.5 transition-colors', filter === 'unread' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                未读{visible.filter((entry) => entry.unread).length > 0 ? ` ${visible.filter((entry) => entry.unread).length}` : ''}
              </button>
            </div>
            <button
              type="button"
              onClick={markAllRead}
              disabled={markableUnread === 0}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50 disabled:hover:text-muted-foreground"
            >
              全部标记为已读
            </button>
          </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {shown.length === 0 && !(category === 'personal' ? invitesFailed : failed) && (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                <Bell data-empty-bell className="h-12 w-12 text-muted-foreground/30" aria-hidden />
                <p className="text-sm font-medium text-foreground">
                  {category === 'team' ? '暂无团队动态' : category === 'platform' ? '暂无平台消息' : '暂无个人邀请'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {category === 'team' ? '团队里的批注回复会显示在这里。' : category === 'platform' ? '运营公告会显示在这里。' : '其他团队邀请你加入时会显示在这里。'}
                </p>
              </div>
            )}
            {shown.length === 0 && (category === 'personal' ? invitesFailed : failed) && (
              <p className="px-2 py-4 text-sm text-muted-foreground">
                {category === 'personal' ? '邀请读取失败，重新打开通知会再试。' : '通知载入失败，30 秒后自动重试。'}
              </p>
            )}
            {shown.map((entry) => (
              <button
                key={entry.key}
                type="button"
                data-notification-row
                onClick={() => openEntry(entry)}
                className="w-full rounded-md px-2 py-2 text-left transition-colors hover:bg-accent focus-visible:bg-accent"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">{entry.headline}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(entry.createdAt)}</span>
                </span>
                <span className={`mt-0.5 text-sm text-foreground ${expanded === entry.key ? 'whitespace-pre-wrap' : 'line-clamp-2'}`}>
                  {entry.body}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                  <span className="shrink-0 rounded bg-muted px-1 py-px text-[11px]">
                    {entry.type === 'reply' ? '批注回复' : entry.type === 'announcement' ? '平台消息' : '团队邀请'}
                  </span>
                  <span className="truncate">{entry.type === 'announcement' ? '' : entry.where}</span>
                </span>
                {entry.unread && (
                  <span className="mt-1 inline-flex items-center gap-1 text-xs text-primary">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                    未读
                  </span>
                )}
              </button>
            ))}
          </div>
    </RailPanel>
  )
}
