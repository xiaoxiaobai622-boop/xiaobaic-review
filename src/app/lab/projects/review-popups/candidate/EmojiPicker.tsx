'use client'

import { useEffect, useId, useState } from 'react'
import { Clock, Smile, Leaf, Utensils, Gamepad2, Lightbulb } from 'lucide-react'
import styles from './popup.module.css'

/** 最近使用的表情存这里，上限 16 个。 */
const RECENT_KEY = 'review_popup_lab_candidate_recent'
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
  const id = useId()
  const icons = [Clock, Smile, Leaf, Utensils, Gamepad2, Lightbulb]

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
    <div className={className}>
      <div className={styles.emojiTabs} role="tablist" aria-label="表情分类" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        event.stopPropagation()
        const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
        const at = tabs.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (at + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
        setTab(GROUPS[next].key)
        tabs[next].focus()
      }}>
        {GROUPS.map((group, index) => {
          const Icon = icons[index]
          return (
            <button key={group.key} type="button" title={group.label} aria-label={group.label}
              id={`${id}-${group.key}`} role="tab" aria-selected={tab === group.key}
              aria-controls={`${id}-panel`} tabIndex={tab === group.key ? 0 : -1}
              onClick={() => setTab(group.key)} className={styles.emojiTab}>
              <Icon size={16} aria-hidden />
            </button>
          )
        })}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`}>
        <p className={styles.heading}>{activeGroup?.label}</p>
        <div className="grid max-h-52 grid-cols-8 gap-0.5 overflow-y-auto" onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          event.stopPropagation()
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
          const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
          const step = event.key === 'ArrowDown' ? 8 : event.key === 'ArrowUp' ? -8 : event.key === 'ArrowRight' ? 1 : -1
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, at + step))
          buttons[next]?.focus()
        }}>
          {list.map((emoji, index) => (
            <button key={`${emoji}-${index}`} type="button" aria-label={emoji} onClick={() => pick(emoji)} className={styles.emoji}>
              {emoji}
            </button>
          ))}
          {list.length === 0 && <p className="col-span-8 py-6 text-center text-xs text-muted-foreground">暂无常用表情</p>}
        </div>
      </div>
    </div>
  )
}
