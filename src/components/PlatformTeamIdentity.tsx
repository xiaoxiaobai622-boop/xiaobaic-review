'use client'

import PlatformCopyValue from '@/components/PlatformCopyValue'

type IdentityTeam = { id: string; slug: string; shareKey?: string | null }

const LABELS = { id: '团队 ID', slug: '团队标识', shareKey: '分享键' } as const
type Field = keyof typeof LABELS

/**
 * 团队号、团队标识与分享键在界面上都是「一串能复制出去的字符」，所以三处（列表卡片、授权详情页、
 * 首页团队表）共用这一份写法，别各写一套词——分三处各写一遍就是「叫法各漂一次」的开始。
 */
export default function PlatformTeamIdentity({
  team,
  fields = ['id', 'slug', 'shareKey'],
  className = '',
}: {
  team: IdentityTeam
  fields?: Field[]
  className?: string
}) {
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 ${className}`}>
      {fields.map((field) => {
        const value = team[field]
        if (!value) return null
        return <PlatformCopyValue key={field} label={LABELS[field]} value={value} />
      })}
    </div>
  )
}
