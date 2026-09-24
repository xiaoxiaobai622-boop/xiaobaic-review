'use client'

import { memo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { InitialsAvatar } from './InitialsAvatar'
import { sanitizeCommentHtml } from '@/lib/security/html-sanitization'

export interface AnnotationBadgeItem {
  commentId: string
  /** Pixels inside the media rectangle: the annotation's top-left corner. */
  x: number
  y: number
  name: string
  avatarUrl?: string | null
  isInternal?: boolean
  timecode: string
  content: string
}

interface AnnotationBadgesProps {
  items: AnnotationBadgeItem[]
  /** Media rectangle size: keeps the card inside the picture it belongs to. */
  width: number
  height: number
}

interface Cluster {
  key: string
  x: number
  y: number
  items: AnnotationBadgeItem[]
}

const CLUSTER_DISTANCE_PX = 20
const MAX_AVATARS_SHOWN = 3
const CARD_WIDTH_PX = 264
/**
 * Worst-case card height: an entry is a 16px header plus three clamped 16px
 * lines with 12px of padding (88px), entries are 8px apart, and the card adds
 * 22px of padding and border — so `count * 88 + 14`. Over-estimating only
 * flips the card to sit below a little earlier, which is safe; under-estimating
 * lets the picture's `overflow-hidden` cut the card off.
 */
function cardMaxHeight(itemCount: number): number {
  return itemCount * 88 + 14
}

/** Gap between the badge and the card edge. */
const CARD_GAP_PX = 16

/** Annotations drawn on the same spot share one badge instead of stacking discs. */
function clusterItems(items: AnnotationBadgeItem[]): Cluster[] {
  const clusters: Cluster[] = []
  for (const item of items) {
    const home = clusters.find(
      (cluster) => Math.hypot(cluster.x - item.x, cluster.y - item.y) <= CLUSTER_DISTANCE_PX,
    )
    if (home) home.items.push(item)
    else clusters.push({ key: item.commentId, x: item.x, y: item.y, items: [item] })
  }
  return clusters
}

function AnnotationBadges({ items, width, height }: AnnotationBadgesProps) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const t = useTranslations('videos')
  const clusters = clusterItems(items)

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {clusters.map((cluster) => {
        const isOpen = openKey === cluster.key
        // Above by default; below when the top would clip, unless the badge sits
        // in the lower half where the bottom is the tighter side.
        const showBelow =
          cluster.y - CARD_GAP_PX < cardMaxHeight(cluster.items.length)
          && height - cluster.y > cluster.y
        const cardLeft = Math.min(
          Math.max(cluster.x, CARD_WIDTH_PX / 2 + 4),
          Math.max(width - CARD_WIDTH_PX / 2 - 4, CARD_WIDTH_PX / 2 + 4),
        )
        const hidden = cluster.items.length - MAX_AVATARS_SHOWN
        const label = cluster.items.length === 1
          ? t('openTimelineComment', { author: cluster.items[0].name, time: cluster.items[0].timecode })
          : t('annotationBadgeMultiple', { count: cluster.items.length })
        return (
          <div
            key={cluster.key}
            className="pointer-events-auto absolute h-0 w-0"
            style={{ left: cluster.x, top: cluster.y }}
            onMouseEnter={() => setOpenKey(cluster.key)}
            onMouseLeave={() => setOpenKey((current) => (current === cluster.key ? null : current))}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="absolute left-0 top-0 flex -translate-x-1/2 -translate-y-1/2 items-center rounded-full bg-black/45 p-0.5 shadow-md ring-1 ring-white/40 backdrop-blur-sm transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              onClick={() => setOpenKey((current) => (current === cluster.key ? null : cluster.key))}
              onFocus={() => setOpenKey(cluster.key)}
              onBlur={() => setOpenKey((current) => (current === cluster.key ? null : current))}
              aria-expanded={isOpen}
              aria-label={label}
              title={label}
            >
              <span className="flex -space-x-1.5">
                {cluster.items.slice(0, MAX_AVATARS_SHOWN).map((item) => (
                  <InitialsAvatar
                    key={item.commentId}
                    name={item.name}
                    src={item.avatarUrl}
                    size="xs"
                    className="ring-0"
                    isInternal={item.isInternal}
                  />
                ))}
              </span>
              {hidden > 0 && (
                <span className="ml-1 mr-1 text-[10px] font-semibold leading-none text-white">
                  +{hidden}
                </span>
              )}
            </button>

            {isOpen && (
              <div
                role="dialog"
                aria-label={label}
                className="absolute z-30 w-[16.5rem] rounded-md border border-border bg-popover p-2.5 text-popover-foreground shadow-xl"
                style={{
                  left: cardLeft - cluster.x - CARD_WIDTH_PX / 2,
                  ...(showBelow ? { top: CARD_GAP_PX } : { bottom: CARD_GAP_PX }),
                }}
              >
                <ul className="space-y-2">
                  {cluster.items.map((item) => (
                    <li key={item.commentId} className="rounded-md bg-muted/60 px-2 py-1.5">
                      <div className="mb-1 flex min-w-0 items-center gap-1.5 text-xs">
                        <span className="truncate font-medium">{item.name}</span>
                        <span className="ml-auto shrink-0 font-mono tabular-nums text-muted-foreground">
                          {item.timecode}
                        </span>
                      </div>
                      <div
                        className="line-clamp-3 break-words text-xs leading-4 [&_p]:m-0"
                        dangerouslySetInnerHTML={{ __html: sanitizeCommentHtml(item.content) }}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Badge positions only move with the visible set or the letterbox geometry. */
function areBadgesEqual(
  previous: AnnotationBadgesProps,
  next: AnnotationBadgesProps,
): boolean {
  if (previous.width !== next.width || previous.height !== next.height) return false
  if (previous.items.length !== next.items.length) return false

  return previous.items.every((entry, index) => {
    const candidate = next.items[index]
    return entry.commentId === candidate.commentId
      && entry.x === candidate.x
      && entry.y === candidate.y
      && entry.name === candidate.name
      && entry.avatarUrl === candidate.avatarUrl
      && entry.timecode === candidate.timecode
      && entry.content === candidate.content
  })
}

export default memo(AnnotationBadges, areBadgesEqual)
