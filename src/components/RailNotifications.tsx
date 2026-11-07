'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, Settings } from 'lucide-react'
import RailPanel from '@/components/RailPanel'
import { cn } from '@/lib/utils'
import { apiFetch, apiPost } from '@/lib/api-client'
import { appNotice } from '@/components/AppDialogProvider'
import { getDesktopBridge } from '@/lib/desktop-bridge'
import { formatDateTime } from '@/lib/utils'
import {
  acknowledgeAnnouncement,
  loadMoreAnnouncementHistory,
  markAnnouncementsRead,
  recordAnnouncementClick,
  useAnnouncementFeed,
  type FeedAnnouncement,
} from '@/lib/announcement-feed-store'
import { TYPE_LABELS } from '@/lib/announcements/constants'
import { isExternalUrl } from '@/lib/announcements/url'

type InAppCategory = 'TEAM' | 'MENTION'
type Category = 'team' | 'mentions' | 'platform' | 'invites'

interface InAppItem {
  id: string
  eventType: string
  category: InAppCategory
  title: string
  body: string | null
  deepLink: string | null
  actorName: string | null
  projectId: string | null
  videoId: string | null
  commentId: string | null
  aggregateCount: number
  createdAt: string
  lastEventAt: string
  readAt: string | null
  payload: Record<string, unknown> | null
}

interface InAppFeed {
  items: InAppItem[]
  unread: { TEAM: number; MENTION: number; total: number }
  nextCursor: string | null
}

interface InviteItem {
  id: string
  token: string
  role: string
  createdAt: string
  expiresAt: string
  team: { id: string; name: string }
}

type Entry =
  | { key: string; type: 'inapp'; createdAt: string; unread: boolean; headline: string; body: string; where: string; item: InAppItem }
  | { key: string; type: 'announcement'; createdAt: string; unread: boolean; headline: string; body: string; where: string; item: FeedAnnouncement }
  | { key: string; type: 'invite'; createdAt: string; unread: boolean; headline: string; body: string; where: string; item: InviteItem }

const KINDS_STORAGE_KEY = 'admin_notification_kinds'
const DESKTOP_SEEN_STORAGE_KEY = 'desktop_notifications_seen_at'
const REFRESH_INTERVAL_MS = 30_000

type Kinds = { team: boolean; mentions: boolean; announcement: boolean }

const CATEGORY_LABEL: Record<Category, string> = {
  team: '团队动态',
  mentions: '@我的',
  platform: '平台',
  invites: '邀请',
}
const INVITE_ROLE_LABEL: Record<string, string> = { OWNER: '创建人', ADMIN: '管理员', MEMBER: '成员' }

const EMPTY_PLATFORM_ITEMS: FeedAnnouncement[] = []

const EVENT_LABELS: Record<string, string> = {
  COMMENT_NEW: '新批注',
  COMMENT_REPLY: '回复',
  COMMENT_MENTION: '@提及',
  CLIENT_UPLOAD: '客户上传',
  VIDEO_UPLOADED: '上传',
  VIDEO_VERSION: '新版本',
  VIDEO_APPROVED: '审批通过',
  VIDEO_UNAPPROVED: '驳回',
  PROJECT_APPROVED: '项目通过',
  PROJECT_UNAPPROVED: '项目退回',
  DUE_DATE_REMINDER: '到期提醒',
}

function readKinds(): Kinds {
  try {
    const raw = localStorage.getItem(KINDS_STORAGE_KEY)
    if (!raw) return { team: true, mentions: true, announcement: true }
    const parsed = JSON.parse(raw) as Partial<Kinds> & { reply?: boolean }
    return {
      team: parsed.team ?? parsed.reply ?? true,
      mentions: parsed.mentions ?? true,
      announcement: parsed.announcement !== false,
    }
  } catch {
    return { team: true, mentions: true, announcement: true }
  }
}

function writeKinds(value: Kinds) {
  try {
    localStorage.setItem(KINDS_STORAGE_KEY, JSON.stringify(value))
  } catch {
    /* 存不下就本次会话内有效 */
  }
}

function readDesktopSeenAt(): string | null {
  try {
    return localStorage.getItem(DESKTOP_SEEN_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeDesktopSeenAt(value: string) {
  try {
    localStorage.setItem(DESKTOP_SEEN_STORAGE_KEY, value)
  } catch {
    /* 隐私模式下存不下，退化成每次启动重建水位 */
  }
}

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

function payloadString(payload: InAppItem['payload'], key: string): string {
  const value = payload?.[key]
  return typeof value === 'string' ? value : ''
}

function whereOf(item: InAppItem): string {
  const project = payloadString(item.payload, 'projectTitle')
  const video = payloadString(item.payload, 'videoName')
  const timecode = payloadString(item.payload, 'timecode')
  const location = [project, video].filter(Boolean).join(' › ')
  return timecode ? `${location}${location ? ' · ' : ''}${timecode}` : location
}

export default function RailNotifications({ className, enabled = true }: { className?: string; enabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [category, setCategory] = useState<Category>('team')
  const [invitations, setInvitations] = useState<InviteItem[]>([])
  const [invitesFailed, setInvitesFailed] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [kinds, setKinds] = useState<Kinds>({ team: true, mentions: true, announcement: true })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [feeds, setFeeds] = useState<Partial<Record<'team' | 'mentions', InAppFeed>>>({})
  const [inAppFailed, setInAppFailed] = useState(false)
  const [inAppLoading, setInAppLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const feedState = useAnnouncementFeed()
  const platformItems = feedState.data?.items ?? EMPTY_PLATFORM_ITEMS
  const platformFailed = feedState.error && !feedState.data
  const historyHasMore = feedState.data?.historyHasMore ?? false
  const historyLoading = feedState.historyLoading
  const desktop = getDesktopBridge()
  const desktopSeenRef = useRef<string | null>(null)
  const router = useRouter()

  const loadFeed = useCallback(async (
    target: 'team' | 'mentions',
    options: { cursor?: string | null; append?: boolean } = {},
  ) => {
    const apiCategory: InAppCategory = target === 'team' ? 'TEAM' : 'MENTION'
    const params = new URLSearchParams({
      category: apiCategory,
      filter,
      limit: '30',
    })
    if (options.cursor) params.set('cursor', options.cursor)
    try {
      const response = await apiFetch(`/api/notifications?${params.toString()}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(String(response.status))
      const data = (await response.json()) as InAppFeed
      setFeeds((current) => {
        const existing = current[target]
        return {
          ...current,
          [target]: {
            ...data,
            items: options.append && existing ? [...existing.items, ...data.items] : data.items,
          },
        }
      })
      setInAppFailed(false)
    } catch {
      setInAppFailed(true)
    }
  }, [filter])

  const loadFeeds = useCallback(async () => {
    if (!enabled) return
    setInAppLoading(true)
    await Promise.all([loadFeed('team'), loadFeed('mentions')])
    setInAppLoading(false)
  }, [enabled, loadFeed])

  const loadInvitations = useCallback(async () => {
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
    if (enabled) void loadFeeds()
    void loadInvitations()
  }, [enabled, loadFeeds, loadInvitations])

  useEffect(() => {
    if (!enabled) return
    const tick = () => {
      if (document.visibilityState === 'visible' || desktop) void loadFeeds()
    }
    const timer = window.setInterval(tick, REFRESH_INTERVAL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [desktop, enabled, loadFeeds])

  useEffect(() => {
    if (!open) return
    void loadFeeds()
    void loadInvitations()
  }, [open, filter, loadFeeds, loadInvitations])

  // Opening the panel records "seen" but never marks read; the explicit click
  // or "全部已读" is what changes the server unread count.
  useEffect(() => {
    if (!open || (category !== 'team' && category !== 'mentions')) return
    const items = feeds[category]?.items ?? []
    const unreadIds = items.filter((item) => !item.readAt).map((item) => item.id)
    if (unreadIds.length === 0) return
    void apiPost('/api/notifications/seen', {
      ids: unreadIds,
      category: category === 'team' ? 'TEAM' : 'MENTION',
    }).catch(() => {})
  }, [open, category, feeds])

  useEffect(() => {
    if (!desktop) return
    const inAppItems = [...(feeds.team?.items ?? []), ...(feeds.mentions?.items ?? [])]
    const stamps = [...inAppItems.map((item) => item.lastEventAt), ...platformItems.map((item) => item.createdAt)]
    if (stamps.length === 0) return
    const newestStamp = newestOf(stamps)
    const seen = desktopSeenRef.current ?? readDesktopSeenAt()
    if (!seen) {
      desktopSeenRef.current = newestStamp
      writeDesktopSeenAt(newestStamp)
      return
    }

    const newInApp = inAppItems
      .filter((item) => item.lastEventAt > seen)
      .filter((item) => (item.category === 'TEAM' ? kinds.team : kinds.mentions))
      .sort((a, b) => (a.lastEventAt < b.lastEventAt ? 1 : -1))
    const newMessages = kinds.announcement
      ? platformItems.filter((item) => item.active && !item.isTest && item.createdAt > seen)
      : []

    if (newInApp.length > 0) {
      const newest = newInApp[0]
      desktop.notify({
        title: newest.title,
        body: newest.body || whereOf(newest),
        href: newest.deepLink || undefined,
      })
    }
    if (newMessages.length > 0) {
      const newest = newMessages[0]
      desktop.notify(
        newMessages.length === 1
          ? { title: newest.title, body: newest.content }
          : { title: `${newMessages.length} 条新平台消息`, body: newest.title },
      )
    }
    if (newInApp.length > 0 || newMessages.length > 0) {
      desktopSeenRef.current = newestStamp
      writeDesktopSeenAt(newestStamp)
    }
  }, [desktop, feeds, platformItems, kinds])

  const close = () => {
    setOpen(false)
    setSettingsOpen(false)
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      close()
      return
    }
    setOpen(true)
  }

  const platformIsUnread = (item: FeedAnnouncement) => !item.readAt
  const platformUnreadCount = platformItems.filter(platformIsUnread).length

  const teamUnread = kinds.team ? (feeds.team?.unread.TEAM ?? 0) : 0
  const mentionUnread = kinds.mentions ? (feeds.mentions?.unread.MENTION ?? 0) : 0
  const visiblePlatformUnread = kinds.announcement ? platformUnreadCount : 0
  const unreadCount = teamUnread + mentionUnread + visiblePlatformUnread + invitations.length

  const currentFeed = category === 'team' ? feeds.team : category === 'mentions' ? feeds.mentions : null
  const currentItems = currentFeed?.items ?? []
  const currentUnread = category === 'team'
    ? teamUnread
    : category === 'mentions'
      ? mentionUnread
      : category === 'platform'
        ? platformUnreadCount
        : 0

  const platformEntries: Entry[] = platformItems.map((item) => ({
    key: `a-${item.id}`,
    type: 'announcement' as const,
    createdAt: item.createdAt,
    unread: platformIsUnread(item),
    headline: item.title,
    body: item.content,
    where: '平台消息',
    item,
  }))

  const inviteEntries: Entry[] = invitations.map((item) => ({
    key: `i-${item.id}`,
    type: 'invite' as const,
    createdAt: item.createdAt,
    unread: false,
    headline: `邀请你加入 ${item.team.name}`,
    body: `角色：${INVITE_ROLE_LABEL[item.role] || '成员'} · 点击查看并处理邀请`,
    where: item.team.name,
    item,
  }))

  const inAppEntries: Entry[] = currentItems.map((item) => ({
    key: `n-${item.id}`,
    type: 'inapp' as const,
    createdAt: item.lastEventAt,
    unread: !item.readAt,
    headline: item.title,
    body: item.body || '',
    where: whereOf(item),
    item,
  }))

  const visible = category === 'team' || category === 'mentions'
    ? inAppEntries
    : category === 'platform'
      ? platformEntries
      : inviteEntries
  const shown = filter === 'unread' && category !== 'invites'
    ? visible.filter((entry) => entry.unread)
    : visible
  const panelFailed = category === 'invites'
    ? invitesFailed
    : category === 'platform'
      ? platformFailed
      : inAppFailed
  const markableUnread = category === 'team'
    ? teamUnread
    : category === 'mentions'
      ? mentionUnread
      : category === 'platform'
        ? (kinds.announcement ? platformUnreadCount : 0)
        : 0

  useEffect(() => {
    if (!open || category !== 'platform') return
    const unreadIds = platformItems.filter((item) => !item.readAt).map((item) => item.id)
    if (unreadIds.length > 0) void markAnnouncementsRead(unreadIds)
  }, [category, open, platformItems])

  const applyLocalRead = (target: 'team' | 'mentions', ids?: string[], all = false) => {
    setFeeds((current) => {
      const feed = current[target]
      if (!feed) return current
      const now = new Date().toISOString()
      let newlyRead = 0
      const items = feed.items.map((item) => {
        const shouldRead = all || Boolean(ids?.includes(item.id))
        if (shouldRead && !item.readAt) {
          newlyRead += 1
          return { ...item, readAt: now }
        }
        return item
      })
      if (newlyRead === 0) return current
      const categoryKey: InAppCategory = target === 'team' ? 'TEAM' : 'MENTION'
      return {
        ...current,
        [target]: {
          ...feed,
          items,
          unread: {
            ...feed.unread,
            [categoryKey]: Math.max(0, feed.unread[categoryKey] - newlyRead),
            total: Math.max(0, feed.unread.total - newlyRead),
          },
        },
      }
    })
  }

  const markInAppRead = async (ids?: string[], all = false) => {
    if (category !== 'team' && category !== 'mentions') return
    const apiCategory: InAppCategory = category === 'team' ? 'TEAM' : 'MENTION'
    try {
      await apiPost('/api/notifications/read', all ? { all: true, category: apiCategory } : { ids, category: apiCategory })
      // Update the tab immediately; the background refetch reconciles other
      // devices and any rows the local page did not have yet.
      applyLocalRead(category, ids, all)
      void loadFeeds()
    } catch {
      appNotice({ tone: 'error', message: '已读状态写入失败，请稍后重试' })
    }
  }

  const markSeenForEntry = (entry: Entry) => {
    if (entry.type !== 'inapp' || entry.item.readAt) return
    const apiCategory: InAppCategory = entry.item.category
    void apiPost('/api/notifications/seen', {
      ids: [entry.item.id],
      category: apiCategory,
    }).catch(() => {})
  }

  const markAllRead = async () => {
    if (category === 'team' || category === 'mentions') {
      await markInAppRead(undefined, true)
      return
    }
    if (category !== 'platform') return
    const unreadIds = platformItems.filter(platformIsUnread).map((item) => item.id)
    if (unreadIds.length > 0) {
      const ok = await markAnnouncementsRead(unreadIds)
      if (!ok) appNotice({ tone: 'error', message: '公告已读状态写入失败，请稍后重试' })
    }
  }

  const openEntry = (entry: Entry) => {
    if (entry.type === 'invite') {
      close()
      router.push(`/studio/team/invite/${encodeURIComponent(entry.item.token)}`)
      return
    }
    if (entry.type === 'inapp') {
      markSeenForEntry(entry)
      void apiPost('/api/notifications/read', {
        ids: [entry.item.id],
        category: entry.item.category,
      }).then(() => {
        applyLocalRead(entry.item.category === 'TEAM' ? 'team' : 'mentions', [entry.item.id])
      }).catch(() => {})
      if (entry.item.deepLink) {
        close()
        router.push(entry.item.deepLink)
        return
      }
      setExpanded((current) => (current === entry.key ? null : entry.key))
      return
    }
    const opening = expanded !== entry.key
    setExpanded((current) => (current === entry.key ? null : entry.key))
    if (opening && !entry.item.readAt) {
      void markAnnouncementsRead([entry.item.id]).then((ok) => {
        if (!ok) appNotice({ tone: 'error', message: '已读状态写入失败，请稍后重试' })
      })
    }
  }

  const acknowledgeItem = async (item: FeedAnnouncement) => {
    const result = await acknowledgeAnnouncement(item.id, item.primaryMode)
    if (!result.ok) appNotice({ tone: 'error', message: result.error || '确认失败，请稍后重试' })
  }

  const loadMoreHistory = async () => {
    const result = await loadMoreAnnouncementHistory()
    if (!result.ok && result.error) appNotice({ tone: 'error', message: result.error })
  }

  const loadMoreInApp = async () => {
    if (category !== 'team' && category !== 'mentions') return
    const cursor = feeds[category]?.nextCursor
    if (!cursor) return
    setLoadingMore(true)
    await loadFeed(category, { cursor, append: true })
    setLoadingMore(false)
  }

  const emptyTitle = category === 'team'
    ? '暂无团队动态'
    : category === 'mentions'
      ? '还没有人 @ 你'
      : category === 'platform'
        ? '暂无平台消息'
        : '暂无个人邀请'
  const emptyHint = category === 'team'
    ? '上传、批注、审批和到期提醒会显示在这里。'
    : category === 'mentions'
      ? '回复和 @ 提及会显示在这里。'
      : category === 'platform'
        ? '平台公告与消息会显示在这里。'
        : '其他团队邀请你加入时会显示在这里。'

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
            { key: 'team' as const, label: '团队动态' },
            { key: 'mentions' as const, label: '@我的' },
            { key: 'announcement' as const, label: '平台消息' },
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
          <p className="mt-1 text-xs text-muted-foreground">站内已读由服务端保存，换设备也会一致。</p>
        </div>
      )}

      <div role="tablist" aria-label="通知分类" className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-1.5">
        {(['team', 'mentions', 'platform', 'invites'] as const).map((key) => {
          const count = key === 'team'
            ? teamUnread
            : key === 'mentions'
              ? mentionUnread
              : key === 'platform'
                ? visiblePlatformUnread
                : invitations.length
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={category === key}
              onClick={() => { setCategory(key); setExpanded(null) }}
              className={cn(
                'relative rounded px-2 py-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                category === key ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {CATEGORY_LABEL[key]}
              {count > 0 && <span className="ml-1 rounded-full bg-destructive/10 px-1 text-[10px] text-destructive">{count > 99 ? '99+' : count}</span>}
            </button>
          )
        })}
      </div>

      {category !== 'invites' && (
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
              未读{currentUnread > 0 ? ` ${currentUnread}` : ''}
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

      {category === 'platform' ? (
        <p className="shrink-0 border-b border-border px-3 py-1 text-[10px] text-muted-foreground">
          平台公告的已读/未读按服务端 readAt；团队动态和 @我的也已改为服务端已读。
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {shown.length === 0 && !panelFailed && inAppLoading && (category === 'team' || category === 'mentions') && (
          <p className="px-2 py-4 text-sm text-muted-foreground">正在载入通知…</p>
        )}
        {shown.length === 0 && !panelFailed && !(inAppLoading && (category === 'team' || category === 'mentions')) && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <Bell data-empty-bell className="h-12 w-12 text-muted-foreground/30" aria-hidden />
            <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
            <p className="text-xs text-muted-foreground">{emptyHint}</p>
          </div>
        )}
        {shown.length === 0 && panelFailed && (
          <p className="px-2 py-4 text-sm text-muted-foreground">
            {category === 'invites'
              ? '邀请读取失败，重新打开通知会再试。'
              : category === 'platform'
                ? '公告读取失败，恢复后会自动重试；收件箱不会阻塞工作台。'
                : inAppLoading
                  ? '正在载入通知…'
                  : '通知载入失败，30 秒后自动重试。'}
          </p>
        )}
        {shown.map((entry) => (
          <div key={entry.key} data-notification-row className="rounded-md transition-colors hover:bg-accent">
            <button
              type="button"
              onClick={() => openEntry(entry)}
              aria-expanded={entry.type === 'announcement' ? expanded === entry.key : undefined}
              className="w-full rounded-md px-2 py-2 text-left focus-visible:bg-accent"
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium text-foreground">{entry.headline}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(entry.createdAt)}</span>
              </span>
              <span className={`mt-0.5 text-sm text-foreground ${expanded === entry.key ? 'whitespace-pre-wrap' : 'line-clamp-2'}`}>
                {entry.body}
              </span>
              <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span className="shrink-0 rounded bg-muted px-1 py-px text-[11px]">
                  {entry.type === 'inapp'
                    ? EVENT_LABELS[entry.item.eventType] || '通知'
                    : entry.type === 'announcement'
                      ? TYPE_LABELS[entry.item.type as keyof typeof TYPE_LABELS] || '平台消息'
                      : '团队邀请'}
                </span>
                {entry.type === 'inapp' && entry.item.aggregateCount > 1 ? (
                  <span className="shrink-0 rounded bg-primary/10 px-1 py-px text-[11px] text-primary">×{entry.item.aggregateCount}</span>
                ) : null}
                {entry.type === 'announcement' && entry.item.ackRequired && !entry.item.acknowledgedAt ? (
                  <span className="shrink-0 rounded bg-destructive-visible px-1 py-px text-[11px] text-destructive">需确认</span>
                ) : null}
                <span className="truncate">{entry.type === 'announcement' ? '' : entry.where}</span>
              </span>
              {entry.unread && (
                <span className="mt-1 inline-flex items-center gap-1 text-xs text-primary">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                  未读
                </span>
              )}
            </button>

            {expanded === entry.key && entry.type === 'announcement' ? (
              <div className="flex flex-wrap items-center gap-2 px-2 pb-2">
                {entry.item.ctaLabel && entry.item.ctaUrl ? (
                  <a
                    href={entry.item.ctaUrl}
                    target={isExternalUrl(entry.item.ctaUrl) ? '_blank' : undefined}
                    rel={isExternalUrl(entry.item.ctaUrl) ? 'noopener noreferrer' : undefined}
                    onClick={() => { void recordAnnouncementClick(entry.item.id, 'INBOX') }}
                    className="inline-flex items-center rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {entry.item.ctaLabel}
                  </a>
                ) : null}
                {entry.item.ackRequired ? (
                  entry.item.acknowledgedAt ? (
                    <span className="text-xs text-success">已确认知晓</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { void acknowledgeItem(entry.item) }}
                      className="inline-flex items-center rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      我已知晓
                    </button>
                  )
                ) : null}
              </div>
            ) : null}
          </div>
        ))}

        {category === 'platform' && historyHasMore ? (
          <div className="px-2 py-2">
            <button
              type="button"
              onClick={() => { void loadMoreHistory() }}
              disabled={historyLoading}
              className="w-full rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"
            >
              {historyLoading ? '加载历史公告…' : '加载更多历史'}
            </button>
          </div>
        ) : null}

        {(category === 'team' || category === 'mentions') && currentFeed?.nextCursor ? (
          <div className="px-2 py-2">
            <button
              type="button"
              onClick={() => { void loadMoreInApp() }}
              disabled={loadingMore}
              className="w-full rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"
            >
              {loadingMore ? '加载更多…' : '加载更多'}
            </button>
          </div>
        ) : null}
      </div>
    </RailPanel>
  )
}
