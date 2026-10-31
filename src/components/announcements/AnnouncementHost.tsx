'use client'

import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, Info, Megaphone, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { appNotice } from '@/components/AppDialogProvider'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  acknowledgeAnnouncement,
  dismissAnnouncement,
  markAnnouncementShownInSession,
  recordAnnouncementClick,
  recordAnnouncementImpression,
  useAnnouncementFeed,
  wasShownInSession,
  type FeedAnnouncement,
} from '@/lib/announcement-feed-store'
import { MODE_LABELS, TYPE_LABELS } from '@/lib/announcements/constants'
import { isExternalUrl } from '@/lib/announcements/url'

function typeLabel(type: string): string {
  return TYPE_LABELS[type as keyof typeof TYPE_LABELS] || '平台公告'
}

function TypeBadge({ type }: { type: string }) {
  const urgent = type === 'INCIDENT' || type === 'MAINTENANCE'
  const legal = type === 'LEGAL'
  return (
    <span className={cn(
      'inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium',
      urgent && 'bg-destructive-visible text-destructive',
      legal && 'bg-warning-visible text-warning-foreground',
      !urgent && !legal && 'bg-primary-visible text-primary',
    )}>
      {urgent ? <AlertTriangle className="h-3 w-3" aria-hidden /> : legal ? <Info className="h-3 w-3" aria-hidden /> : <Megaphone className="h-3 w-3" aria-hidden />}
      {typeLabel(type)}
    </span>
  )
}

function CtaLink({
  item,
  mode,
  className,
}: {
  item: FeedAnnouncement
  mode: string
  className?: string
}) {
  if (!item.ctaLabel || !item.ctaUrl) return null
  const external = isExternalUrl(item.ctaUrl)
  return (
    <a
      href={item.ctaUrl}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      onClick={() => { void recordAnnouncementClick(item.id, mode) }}
      className={cn(
        'inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      {item.ctaLabel}
    </a>
  )
}

function isBaseEligible(item: FeedAnnouncement, failedIds: Set<string>): boolean {
  return item.active
    && !item.dismissedAt
    && !item.acknowledgedAt
    && !failedIds.has(item.id)
}

function useAnnouncementHostState() {
  const feedState = useAnnouncementFeed()
  const feed = feedState.data
  const [failedIds, setFailedIds] = useState<Set<string>>(() => new Set())
  const [hiddenToastIds, setHiddenToastIds] = useState<Set<string>>(() => new Set())
  const [modalDay, setModalDay] = useState<string>(feed?.beijingDay ?? '')
  const [modalShownToday, setModalShownToday] = useState(feed?.modalShownToday ?? 0)

  const [activeModalId, setActiveModalId] = useState<string | null>(null)
  const [activeBannerId, setActiveBannerId] = useState<string | null>(null)
  const [activeToastId, setActiveToastId] = useState<string | null>(null)

  useEffect(() => {
    if (!feed) return
    if (feed.beijingDay !== modalDay) {
      setModalDay(feed.beijingDay)
      setModalShownToday(feed.modalShownToday)
    } else {
      setModalShownToday((current) => Math.max(current, feed.modalShownToday))
    }
  }, [feed, modalDay])

  // Kill switch and unmount both release every carrier.
  useEffect(() => {
    if (!feed || feed.control.bannerModalPaused) {
      setActiveModalId(null)
      setActiveBannerId(null)
      setActiveToastId(null)
    }
  }, [feed])

  // Another tab or the lifecycle can make the active item invalid while it is
  // open. Impression/cooldown updates must not close it; dismissal/ack must.
  useEffect(() => {
    if (!feed) return
    const byId = new Map(feed.items.map((item) => [item.id, item]))

    if (activeModalId) {
      const item = byId.get(activeModalId)
      if (!item || !isBaseEligible(item, failedIds)) setActiveModalId(null)
    }
    if (activeBannerId) {
      const item = byId.get(activeBannerId)
      if (!item || !isBaseEligible(item, failedIds)) setActiveBannerId(null)
    }
    if (activeToastId) {
      const item = byId.get(activeToastId)
      if (!item || !isBaseEligible(item, failedIds)) setActiveToastId(null)
    }
  }, [activeBannerId, activeModalId, activeToastId, failedIds, feed])

  // Pick the next carrier only when that slot is empty. Once an item is active,
  // its own impression updates cannot evict it.
  useEffect(() => {
    if (!feed || feed.control.bannerModalPaused) return
    const now = new Date(feed.serverNow).getTime()
    const base = feed.items.filter((item) => isBaseEligible(item, failedIds))

    if (!activeModalId) {
      const modalCandidate = base.find((item) => {
        if (item.primaryMode !== 'MODAL') return false
        // A critical modal that has not been acknowledged must survive reloads
        // and remounts; frequency/cooldown only gate non-blocking notices. The
        // kill switch above still wins, and ACK/DISMISS remove it from `base`.
        if (item.ackRequired) return true
        if (modalShownToday >= feed.control.modalMaxPerDay) return false
        if (item.shownCount >= feed.control.modalMaxShowsPerUser) return false
        if (item.lastShownAt && feed.control.modalCooldownMinutes > 0) {
          const elapsed = now - new Date(item.lastShownAt).getTime()
          if (elapsed < feed.control.modalCooldownMinutes * 60_000) return false
        }
        return true
      })
      if (modalCandidate) {
        setActiveModalId(modalCandidate.id)
        return
      }
    }

    if (!activeModalId && !activeBannerId && !activeToastId) {
      // A banner stays pinned until dismissed/ACKed, including across remounts;
      // otherwise a reload would skip the shown higher-priority banner and let a
      // lower-priority one jump the queue. TOAST still dedupes per session.
      const bannerCandidate = base.find((item) => item.primaryMode === 'BANNER')
      if (bannerCandidate) {
        setActiveBannerId(bannerCandidate.id)
        return
      }
    }

    if (!activeModalId && !activeBannerId && !activeToastId) {
      const toastCandidate = base.find((item) => (
        item.primaryMode === 'TOAST'
        && item.priority <= feed.control.toastMaxPriority
        && !wasShownInSession(item.id)
        && !hiddenToastIds.has(item.id)
      ))
      if (toastCandidate) setActiveToastId(toastCandidate.id)
    }
  }, [
    activeBannerId,
    activeModalId,
    activeToastId,
    failedIds,
    feed,
    hiddenToastIds,
    modalShownToday,
  ])

  const modal = activeModalId ? feed?.items.find((item) => item.id === activeModalId) ?? null : null
  const banner = activeBannerId ? feed?.items.find((item) => item.id === activeBannerId) ?? null : null
  const toast = activeToastId ? feed?.items.find((item) => item.id === activeToastId) ?? null : null

  return {
    feed,
    modal,
    banner,
    toast,
    setActiveModalId,
    setActiveBannerId,
    setActiveToastId,
    setFailedIds,
    setHiddenToastIds,
    setModalShownToday,
  }
}

function AnnouncementBanner({
  item,
  onDismiss,
  onAck,
}: {
  item: FeedAnnouncement
  onDismiss: () => void
  onAck: () => void
}) {
  return (
    <div
      role="region"
      aria-label={`${typeLabel(item.type)}：${item.title}`}
      className="fixed left-[60px] right-2 top-2 z-30 mx-auto max-w-3xl rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-elevation-lg motion-reduce:transition-none lg:left-[64px]"
    >
      <div className="flex items-start gap-2.5">
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.imageUrl} alt="" className="h-9 w-12 shrink-0 rounded object-cover" />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <TypeBadge type={item.type} />
            <p className="min-w-0 truncate text-sm font-semibold text-foreground">{item.title}</p>
          </div>
          <p className="mt-0.5 line-clamp-2 whitespace-pre-line break-words text-xs text-muted-foreground">{item.content}</p>
          {item.ctaLabel && item.ctaUrl ? (
            <CtaLink item={item} mode={item.primaryMode} className="mt-1.5" />
          ) : null}
        </div>
        {item.ackRequired ? (
          <button
            type="button"
            onClick={onAck}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Check className="h-3.5 w-3.5" aria-hidden />
            我已知晓
          </button>
        ) : (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="关闭公告"
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
    </div>
  )
}

function AnnouncementModal({
  item,
  onClose,
  onAck,
}: {
  item: FeedAnnouncement
  onClose: () => void
  onAck: () => void
}) {
  const primaryRef = useRef<HTMLButtonElement>(null)

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !item.ackRequired) onClose() }}>
      <DialogContent
        hideClose
        overlayProps={{ className: 'z-[60]' }}
        className="z-[70] max-w-xl p-0 motion-reduce:transition-none"
        onEscapeKeyDown={(event) => { if (item.ackRequired) event.preventDefault() }}
        onPointerDownOutside={(event) => { if (item.ackRequired) event.preventDefault() }}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          primaryRef.current?.focus()
        }}
      >
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.imageUrl} alt="" className="max-h-56 w-full rounded-t-lg object-cover" />
        ) : null}
        <div className="p-5 sm:p-6">
          <DialogHeader className="gap-2">
            <div className="flex items-center gap-2">
              <TypeBadge type={item.type} />
              <span className="text-[11px] text-muted-foreground">{MODE_LABELS[item.primaryMode as keyof typeof MODE_LABELS] || '公告'}</span>
            </div>
            <DialogTitle className="text-left text-lg font-semibold text-foreground">{item.title}</DialogTitle>
            <DialogDescription className="sr-only">平台公告正文</DialogDescription>
          </DialogHeader>

          <div className="mt-3 max-h-[50vh] overflow-y-auto whitespace-pre-line break-words text-sm leading-6 text-foreground">
            {item.content}
          </div>

          <DialogFooter className="mt-5 flex-row items-center justify-end gap-2">
            {item.ctaLabel && item.ctaUrl ? (
              <CtaLink item={item} mode={item.primaryMode} className="mr-auto" />
            ) : null}
            {item.ackRequired ? (
              <Button ref={primaryRef} type="button" onClick={onAck} className="h-8 px-3 text-xs">
                <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                我已知晓
              </Button>
            ) : (
              <Button ref={primaryRef} type="button" variant="outline" onClick={onClose} className="h-8 px-3 text-xs">
                关闭
              </Button>
            )}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AnnouncementToast({
  item,
  onDismiss,
  onAck,
}: {
  item: FeedAnnouncement
  onDismiss: () => void
  onAck: () => void
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-40 w-[min(360px,calc(100vw-2rem))] rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-elevation-lg motion-reduce:transition-none"
    >
      <div className="flex items-start gap-2.5">
        <TypeBadge type={item.type} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
          <p className="mt-0.5 line-clamp-2 whitespace-pre-line break-words text-xs text-muted-foreground">{item.content}</p>
          {item.ctaLabel && item.ctaUrl ? <CtaLink item={item} mode={item.primaryMode} className="mt-2" /> : null}
        </div>
        {item.ackRequired ? (
          <button
            type="button"
            onClick={onAck}
            className="shrink-0 rounded border border-border px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            我已知晓
          </button>
        ) : (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="关闭公告"
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>
    </div>
  )
}

function AnnouncementHostInner() {
  const {
    feed,
    modal,
    banner,
    toast,
    setActiveModalId,
    setActiveBannerId,
    setActiveToastId,
    setFailedIds,
    setHiddenToastIds,
    setModalShownToday,
  } = useAnnouncementHostState()

  const modalId = modal?.id
  const modalMode = modal?.primaryMode
  const modalAckRequired = modal?.ackRequired ?? false
  const bannerId = banner?.id
  const toastId = toast?.id

  // Depend on stable ids, not the feed item object: a successful impression
  // updates that object and would otherwise re-trigger this effect in a loop.
  useEffect(() => {
    if (!modalId || !modalMode) return
    let cancelled = false
    void recordAnnouncementImpression(modalId, modalMode).then((ok) => {
      if (cancelled) return
      if (ok) {
        setModalShownToday((current) => current + 1)
      } else if (!modalAckRequired) {
        // A non-critical modal that cannot record its impression must not keep
        // blocking the app. Drop it and leave the announcement in the inbox.
        setFailedIds((current) => new Set(current).add(modalId))
        setActiveModalId(null)
      }
      // An ACK-required modal stays visible through a transient state failure;
      // hiding it would make the acknowledgement avoidable by reloading.
    })
    return () => { cancelled = true }
  }, [modalAckRequired, modalId, modalMode, setActiveModalId, setFailedIds, setModalShownToday])

  useEffect(() => {
    if (!bannerId) return
    let cancelled = false
    void recordAnnouncementImpression(bannerId, 'BANNER').then((ok) => {
      if (cancelled) return
      if (!ok) {
        setFailedIds((current) => new Set(current).add(bannerId))
        setActiveBannerId(null)
      }
    })
    return () => { cancelled = true }
  }, [bannerId, setActiveBannerId, setFailedIds])

  useEffect(() => {
    if (!toastId) return
    let cancelled = false
    void recordAnnouncementImpression(toastId, 'TOAST').then((ok) => {
      if (cancelled) return
      if (!ok) {
        setFailedIds((current) => new Set(current).add(toastId))
        setActiveToastId(null)
      }
    })
    const timer = window.setTimeout(() => {
      markAnnouncementShownInSession(toastId)
      setHiddenToastIds((current) => new Set(current).add(toastId))
      setActiveToastId(null)
    }, 8000)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [toastId, setActiveToastId, setFailedIds, setHiddenToastIds])

  const dismiss = useCallback(async (item: FeedAnnouncement) => {
    const result = await dismissAnnouncement(item.id, item.primaryMode)
    if (result.ok) {
      if (item.primaryMode === 'MODAL') setActiveModalId(null)
      if (item.primaryMode === 'BANNER') setActiveBannerId(null)
      if (item.primaryMode === 'TOAST') setActiveToastId(null)
    } else {
      appNotice({ tone: 'error', message: result.error || '关闭失败，请稍后重试' })
    }
  }, [setActiveBannerId, setActiveModalId, setActiveToastId])

  const acknowledge = useCallback(async (item: FeedAnnouncement) => {
    const result = await acknowledgeAnnouncement(item.id, item.primaryMode)
    if (result.ok) {
      if (item.primaryMode === 'MODAL') setActiveModalId(null)
      if (item.primaryMode === 'BANNER') setActiveBannerId(null)
      if (item.primaryMode === 'TOAST') setActiveToastId(null)
    } else {
      appNotice({ tone: 'error', message: result.error || '确认失败，请稍后重试' })
    }
  }, [setActiveBannerId, setActiveModalId, setActiveToastId])

  if (!feed) return null

  return (
    <>
      {banner && !modal ? (
        <AnnouncementBanner
          item={banner}
          onDismiss={() => { void dismiss(banner) }}
          onAck={() => { void acknowledge(banner) }}
        />
      ) : null}

      {modal ? (
        <AnnouncementModal
          item={modal}
          onClose={() => { void dismiss(modal) }}
          onAck={() => { void acknowledge(modal) }}
        />
      ) : null}

      {toast && !modal && !banner ? (
        <AnnouncementToast
          item={toast}
          onDismiss={() => { void dismiss(toast) }}
          onAck={() => { void acknowledge(toast) }}
        />
      ) : null}
    </>
  )
}

class AnnouncementHostBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    // The inbox is the fallback; a render failure here must never blank the
    // studio or block the app shell.
  }

  render() {
    if (this.state.failed) return null
    return this.props.children
  }
}

export default function AnnouncementHost() {
  return (
    <AnnouncementHostBoundary>
      <AnnouncementHostInner />
    </AnnouncementHostBoundary>
  )
}
