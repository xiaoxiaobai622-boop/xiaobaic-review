'use client'

import { useSyncExternalStore } from 'react'
import { apiFetch } from './api-client'

export interface FeedAnnouncement {
  id: string
  title: string
  content: string
  createdAt: string
  broadcast: boolean
  readAt: string | null
  acknowledgedAt: string | null
  dismissedAt: string | null
  lastShownAt: string | null
  shownCount: number
  impressionCount: number
  isTest: boolean
  locale: string
  type: string
  status: string
  primaryMode: string
  priority: number
  startAt: string | null
  endAt: string | null
  ackRequired: boolean
  ctaLabel: string | null
  ctaUrl: string | null
  imageUrl: string | null
  publishedAt: string | null
  active: boolean
  audienceSummary: string
}

export interface FeedControl {
  bannerModalPaused: boolean
  modalMaxPerDay: number
  modalCooldownMinutes: number
  modalMaxShowsPerUser: number
  toastMaxPriority: number
}

export interface FeedPayload {
  items: FeedAnnouncement[]
  unread: number
  serverNow: string
  beijingDay: string
  modalShownToday: number
  control: FeedControl
  historyNextCursor: string | null
  historyHasMore: boolean
}

interface FeedHistoryPage {
  items: FeedAnnouncement[]
  serverNow: string
  beijingDay: string
  historyNextCursor: string | null
  historyHasMore: boolean
}

interface FeedStoreState {
  data: FeedPayload | null
  loading: boolean
  error: boolean
  lastUpdatedAt: number
  historyLoading: boolean
  historyPaged: boolean
  historyExtra: FeedAnnouncement[]
}

const SERVER_STATE: FeedStoreState = {
  data: null,
  loading: false,
  error: false,
  lastUpdatedAt: 0,
  historyLoading: false,
  historyPaged: false,
  historyExtra: [],
}
let state: FeedStoreState = SERVER_STATE
let inFlight: Promise<void> | null = null
let lastFetchAt = 0
let timer: number | null = null
let subscriberCount = 0
let visibilityBound = false

const listeners = new Set<() => void>()
const REFRESH_INTERVAL_MS = 30_000
const FETCH_CACHE_MS = 5_000
const SESSION_KEY = 'announcement_client_session_id'
const SHOWN_SESSION_PREFIX = 'announcement_shown_session:'

function emit() {
  for (const listener of listeners) listener()
}

function setState(patch: Partial<FeedStoreState>) {
  state = { ...state, ...patch }
  emit()
}

function handleVisibility() {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
    void refreshAnnouncementFeed()
  }
}

function ensurePolling() {
  if (typeof window === 'undefined' || timer !== null) return
  timer = window.setInterval(() => {
    if (document.visibilityState === 'visible') void refreshAnnouncementFeed()
  }, REFRESH_INTERVAL_MS)
  if (!visibilityBound) {
    document.addEventListener('visibilitychange', handleVisibility)
    visibilityBound = true
  }
}

function stopPollingIfIdle() {
  if (subscriberCount > 0) return
  if (timer !== null) {
    window.clearInterval(timer)
    timer = null
  }
  if (visibilityBound) {
    document.removeEventListener('visibilitychange', handleVisibility)
    visibilityBound = false
  }
}

export function subscribeAnnouncementFeed(listener: () => void): () => void {
  listeners.add(listener)
  subscriberCount += 1
  ensurePolling()
  if (subscriberCount === 1) void refreshAnnouncementFeed(true)
  return () => {
    listeners.delete(listener)
    subscriberCount = Math.max(0, subscriberCount - 1)
    stopPollingIfIdle()
  }
}

export function getAnnouncementFeedState(): FeedStoreState {
  return state
}

export function useAnnouncementFeed(): FeedStoreState {
  return useSyncExternalStore(subscribeAnnouncementFeed, getAnnouncementFeedState, () => SERVER_STATE)
}

export async function refreshAnnouncementFeed(force = false): Promise<void> {
  if (typeof window === 'undefined') return
  if (inFlight) return inFlight
  if (!force && Date.now() - lastFetchAt < FETCH_CACHE_MS) return

  setState({ loading: true })
  inFlight = (async () => {
    try {
      const response = await apiFetch('/api/announcements', { cache: 'no-store' })
      if (!response.ok) throw new Error(String(response.status))
      const data = await response.json() as FeedPayload
      lastFetchAt = Date.now()
      const previous = state.data
      const baseIds = new Set(data.items.map((item) => item.id))
      const extraItems = state.historyExtra.filter((item) => !baseIds.has(item.id))
      const items = [...data.items, ...extraItems]
      const keepPaginationProgress = state.historyPaged && previous !== null
      setState({
        data: {
          ...data,
          items,
          unread: items.filter((item) => !item.readAt).length,
          // A 30s refresh must not rewind the history cursor; otherwise the
          // “加载更多” button would reappear on an already-loaded page.
          historyNextCursor: keepPaginationProgress ? previous.historyNextCursor : data.historyNextCursor,
          historyHasMore: keepPaginationProgress ? previous.historyHasMore : data.historyHasMore,
        },
        historyExtra: extraItems,
        loading: false,
        error: false,
        lastUpdatedAt: lastFetchAt,
      })
    } catch {
      // Keep the previous payload: a blip must not erase the inbox or pop a
      // duplicate banner when the request recovers.
      setState({ loading: false, error: true })
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}

function updateItems(updater: (item: FeedAnnouncement) => FeedAnnouncement) {
  if (!state.data) return
  const items = state.data.items.map(updater)
  setState({
    data: {
      ...state.data,
      items,
      unread: items.filter((item) => !item.readAt).length,
    },
    // Keep the loaded-history copies in sync so a later refresh merge does not
    // resurrect a stale readAt/acknowledgedAt value.
    historyExtra: state.historyExtra.map(updater),
  })
}

export async function loadMoreAnnouncementHistory(): Promise<{ ok: boolean; count: number; error?: string }> {
  const data = state.data
  if (!data?.historyHasMore || !data.historyNextCursor) return { ok: true, count: 0 }
  if (state.historyLoading) return { ok: false, count: 0, error: '正在加载历史公告' }

  setState({ historyLoading: true })
  try {
    const cursor = data.historyNextCursor
    const response = await apiFetch(
      `/api/announcements?historyCursor=${encodeURIComponent(cursor)}&historyLimit=50`,
      { cache: 'no-store' },
    )
    if (!response.ok) throw new Error(String(response.status))
    const page = await response.json() as FeedHistoryPage
    const latest = state.data
    if (!latest) {
      setState({ historyLoading: false })
      return { ok: false, count: 0, error: '公告数据已重置' }
    }

    const baseIds = new Set(latest.items.map((item) => item.id))
    const extrasById = new Map(state.historyExtra.map((item) => [item.id, item]))
    const fresh = page.items.filter((item) => !baseIds.has(item.id) && !extrasById.has(item.id))
    // Keep every loaded extra page here, including items already merged into
    // latest.items. A later 30s refresh replaces data.items with the first page
    // only; historyExtra is what restores all previously loaded pages.
    for (const item of page.items) extrasById.set(item.id, item)
    const extras = Array.from(extrasById.values())
    const items = [...latest.items, ...extras.filter((item) => !baseIds.has(item.id))]

    setState({
      data: {
        ...latest,
        items,
        unread: items.filter((item) => !item.readAt).length,
        historyNextCursor: page.historyNextCursor,
        historyHasMore: page.historyHasMore,
      },
      historyExtra: extras,
      historyPaged: true,
      historyLoading: false,
      error: false,
    })
    return { ok: true, count: fresh.length }
  } catch {
    setState({ historyLoading: false })
    return { ok: false, count: 0, error: '历史公告加载失败，请稍后重试' }
  }
}

function applyState(id: string, receipt: {
  readAt?: string | null
  acknowledgedAt?: string | null
  dismissedAt?: string | null
  lastShownAt?: string | null
  shownCount?: number
  impressionCount?: number
}) {
  updateItems((item) => item.id === id ? { ...item, ...receipt } : item)
}

async function postState(body: Record<string, unknown>): Promise<{ ok: true; json: any } | { ok: false; error: string; code?: string }> {
  try {
    const response = await apiFetch('/api/announcements/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await response.json().catch(() => ({}))
    if (!response.ok) {
      return { ok: false, error: typeof json?.error === 'string' ? json.error : '操作失败', code: json?.code }
    }
    return { ok: true, json }
  } catch {
    return { ok: false, error: '网络异常，请稍后重试' }
  }
}

export async function markAnnouncementsRead(ids: string[]): Promise<boolean> {
  const unique = Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.length > 0)))
  if (unique.length === 0) return true
  // The state API caps one batch at 100 ids; a loaded history page can exceed
  // that. Chunk here and update each successful chunk so a late failure does
  // not make already-written readAt values disappear from the client.
  for (let index = 0; index < unique.length; index += 100) {
    const chunk = unique.slice(index, index + 100)
    const result = await postState({ action: 'READ', ids: chunk, mode: 'INBOX' })
    if (!result.ok) return false
    const now = new Date().toISOString()
    updateItems((item) => chunk.includes(item.id) && !item.readAt ? { ...item, readAt: now } : item)
  }
  return true
}

export async function acknowledgeAnnouncement(id: string, mode: string): Promise<{ ok: boolean; error?: string; code?: string }> {
  const result = await postState({ action: 'ACK', id, mode })
  if (!result.ok) return { ok: false, error: result.error, code: result.code }
  if (result.json?.state) applyState(id, result.json.state)
  return { ok: true }
}

export async function dismissAnnouncement(id: string, mode: string): Promise<{ ok: boolean; error?: string; code?: string }> {
  const result = await postState({ action: 'DISMISS', id, mode })
  if (!result.ok) return { ok: false, error: result.error, code: result.code }
  if (result.json?.state) applyState(id, result.json.state)
  return { ok: true }
}

export async function recordAnnouncementImpression(id: string, mode: string): Promise<boolean> {
  const result = await postState({
    action: 'IMPRESSION',
    id,
    mode,
    sessionId: getAnnouncementSessionId(),
  })
  if (!result.ok) return false
  if (result.json?.state) applyState(id, result.json.state)
  markAnnouncementShownInSession(id)
  return true
}

export async function recordAnnouncementClick(id: string, mode: string): Promise<void> {
  await postState({ action: 'CLICK', id, mode })
}

export function getAnnouncementSessionId(): string {
  if (typeof window === 'undefined') return 'server'
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY)
    if (existing) return existing
    const generated = window.crypto?.randomUUID?.() ?? `session-${Date.now()}-${Math.random().toString(36).slice(2)}`
    window.sessionStorage.setItem(SESSION_KEY, generated)
    return generated
  } catch {
    return `session-${Date.now()}`
  }
}

function shownSessionKey(): string {
  return `${SHOWN_SESSION_PREFIX}${getAnnouncementSessionId()}`
}

export function wasShownInSession(id: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    const raw = window.sessionStorage.getItem(shownSessionKey())
    if (!raw) return false
    const ids = JSON.parse(raw) as unknown
    return Array.isArray(ids) && ids.includes(id)
  } catch {
    return false
  }
}

export function markAnnouncementShownInSession(id: string): void {
  if (typeof window === 'undefined') return
  try {
    const raw = window.sessionStorage.getItem(shownSessionKey())
    const ids = raw ? JSON.parse(raw) as unknown : []
    const next = Array.isArray(ids) ? Array.from(new Set([...ids.filter((value): value is string => typeof value === 'string'), id])) : [id]
    window.sessionStorage.setItem(shownSessionKey(), JSON.stringify(next.slice(-200)))
  } catch {
    // Session storage may be unavailable; the server-side cooldown still applies.
  }
}
