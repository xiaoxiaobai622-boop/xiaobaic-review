'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

/** 最近使用的表情存这里，上限 16 个。 */
const RECENT_KEY = 'comment_emoji_recent'
const RECENT_MAX = 16

const GROUPS: Array<{ key: string; icon: string; label: string; emojis: string[] }> = [
  {
    key: 'recent',
    icon: '🕐',
    label: '最近使用',
    emojis: [],
  },
  {
    key: 'smileys',
    icon: '😀',
    label: '表情与人物',
    emojis: [
      '😀', '😁', '😂', '🤣', '😊', '😇', '🙂', '😉', '😍', '🥰', '😘', '😗',
      '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥳', '😏', '😒', '😞', '😔', '😟',
      '😕', '🙁', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡',
      '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔',
      '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😮', '😯', '😴',
      '🤤', '😪', '😵', '🤢', '🤮', '🤧', '🥴', '🤠', '🤡', '🥸', '😈', '👿',
      '🫶', '👍', '👎', '👌', '🤌', '✌️', '🤞', '🤟', '🤘', '🤙', '👋', '🙌',
      '👏', '🙏', '💪', '👊', '✊', '🫡', '🫢', '🫣', '👀', '🧠', '👨‍💻', '👩‍💻',
    ],
  },
  {
    key: 'nature',
    icon: '🐱',
    label: '动物与自然',
    emojis: [
      '🐱', '🐶', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐸', '🐵', '🐔', '🐧',
      '🐦', '🦄', '🐝', '🦋', '🐢', '🐙', '🦀', '🐬', '🐳', '🌸', '🌹', '🌻',
      '🌷', '🌿', '🍀', '🌴', '🌲', '🌈', '⭐', '🌟', '✨', '🌙', '☀️', '⛅',
      '☁️', '🌧️', '⛈️', '❄️', '🔥', '💧', '🌊', '⚡',
    ],
  },
  {
    key: 'food',
    icon: '🍔',
    label: '食物与饮品',
    emojis: [
      '🍎', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍒', '🍑', '🥭', '🍍',
      '🥝', '🍅', '🥑', '🌽', '🍜', '🍣', '🍱', '🍚', '🍕', '🍔', '🍟', '🌭',
      '🌮', '🍿', '🥓', '🥚', '🧀', '🥗', '☕', '🍵', '🧋', '🥤', '🍺', '🍷',
      '🥂', '🎂', '🍰', '🍫', '🍬', '🍭', '🍩', '🍪',
    ],
  },
  {
    key: 'activity',
    icon: '⚽',
    label: '活动与出行',
    emojis: [
      '⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🏓', '🏸', '🥊', '🎮', '🎯', '🎲',
      '🎸', '🎹', '🎺', '🎤', '🎧', '🎬', '🎨', '🚗', '🚕', '🚌', '🚄', '✈️',
      '🚀', '🛸', '⛵', '🛶', '🏝️', '🏔️', '🎡', '🎢', '🏆', '🥇', '🥈', '🥉',
    ],
  },
  {
    key: 'objects',
    icon: '💡',
    label: '物品与符号',
    emojis: [
      '💡', '📝', '📌', '📎', '📁', '📂', '📅', '⏰', '⏱️', '💰', '💎', '🔔',
      '🎁', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '❤️', '🧡', '💛',
      '💚', '💙', '💜', '🖤', '🤍', '💔', '❣️', '💕', '💞', '✅', '❌', '⚠️',
      '❓', '❗', '💯', '🔝', '👆', '👇', '←', '→',
    ],
  },
]

export default function EmojiPicker({
  onSelect,
  onClose,
  className,
}: {
  onSelect: (emoji: string) => void
  onClose: () => void
  className?: string
}) {
  const [tab, setTab] = useState('recent')
  const [recent, setRecent] = useState<string[]>([])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_KEY)
      if (raw) setRecent(JSON.parse(raw).slice(0, RECENT_MAX))
    } catch { /* 隐私模式忽略 */ }
  }, [])

  function pick(emoji: string) {
    try {
      const next = [emoji, ...recent.filter(e => e !== emoji)].slice(0, RECENT_MAX)
      setRecent(next)
      localStorage.setItem(RECENT_KEY, JSON.stringify(next))
    } catch { /* ignore */ }
    onSelect(emoji)
    onClose()
  }

  const activeGroup = GROUPS.find(g => g.key === tab)
  const list = tab === 'recent' ? (recent.length > 0 ? recent : GROUPS[1].emojis.slice(0, 32)) : activeGroup?.emojis ?? []

  return (
    <div
      className={cn(
        'w-72 rounded-xl border border-border bg-popover p-2 shadow-lg',
        className
      )}
      role="dialog"
      aria-label="选择表情符号"
    >
      <div className="mb-1.5 flex items-center gap-0.5 border-b border-border/60 pb-1.5">
        {GROUPS.map(group => (
          <button
            key={group.key}
            type="button"
            title={group.label}
            onClick={() => setTab(group.key)}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md text-base transition-colors hover:bg-muted',
              tab === group.key && 'bg-muted'
            )}
          >
            {group.icon}
          </button>
        ))}
      </div>
      <div className="grid max-h-52 grid-cols-8 gap-0.5 overflow-y-auto">
        {list.map((emoji, index) => (
          <button
            key={`${emoji}-${index}`}
            type="button"
            onClick={() => pick(emoji)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-xl transition-colors hover:bg-muted"
          >
            {emoji}
          </button>
        ))}
        {list.length === 0 && (
          <p className="col-span-8 py-6 text-center text-xs text-muted-foreground">暂无常用表情</p>
        )}
      </div>
    </div>
  )
}
