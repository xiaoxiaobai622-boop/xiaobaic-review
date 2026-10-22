'use client'

import { Users } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { initialsFromName } from '@/components/InitialsAvatar'
import { useAuth } from '@/components/AuthProvider'

export default function ProjectMembersButton({
  memberCount,
  onOpen,
}: {
  memberCount: number
  onOpen: () => void
}) {
  const t = useTranslations('projects')
  const { user } = useAuth()
  const displayName = user?.name || user?.phone || user?.email || ''

  return (
    <button
      type="button"
      onClick={onOpen}
      title={t('projectMemberCount', { count: memberCount })}
      aria-label={t('projectMemberCount', { count: memberCount })}
      className="inline-flex h-8 shrink-0 items-center outline-none transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#16c464] text-[10px] font-semibold text-[#06351e]">
        {user?.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatarUrl} alt={displayName || '头像'} className="h-full w-full object-cover" />
        ) : initialsFromName(displayName)}
      </span>
      <span className="-ml-1.5 inline-flex h-7 items-center gap-1 rounded-full bg-muted px-2 text-xs font-medium tabular-nums text-foreground">
        <Users className="h-3.5 w-3.5" aria-hidden="true" />
        {memberCount}
      </span>
    </button>
  )
}
