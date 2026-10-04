'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CircleHelp, Clock3, LogOut, UserRound, Users } from 'lucide-react'
import { AllApplication, Config } from '@icon-park/react'
import { useAuth } from '@/components/AuthProvider'
import { initialsFromName } from '@/components/InitialsAvatar'
import TeamSwitcher from '@/components/TeamSwitcher'
import RailSearch from '@/components/RailSearch'
import RailFeedback from '@/components/RailFeedback'
import RailNotifications from '@/components/RailNotifications'
import ThemeToggle from '@/components/ThemeToggle'
import { apiFetch } from '@/lib/api-client'
import { getContactEmail } from '@/lib/user-contact'
import { useTranslations } from 'next-intl'

/** 图标只有 tooltip 不够：只用键盘时也要看得见落点，整条栏共用这一组类。 */
const RAIL_ICON_BUTTON = 'flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card'

/**
 * 没照片时那颗名字片：两端色取自他给的对标截图（#ff7ef9 / #fb5cf7），深色字压上去
 * 两端都过 4.5:1（判据 A7 由 getComputedStyle 实算）；有照片时照片直接铺满，
 * 头像本体不再涂渐变——那条粉色渐变归窄栏（globals.css 的 --rail-gradient），不归头像。
 */
const NAME_CHIP_GRADIENT = 'linear-gradient(180deg, #ff7ef9, #fb5cf7)'

/** 44px 命中区一寸不动，里面收成 32px：有照片是圆图，没照片是名字坐在方片里（他截图那颗就是方角，圆角跟这一列其他控件同一档）。 */
function RailAvatar({ name, src }: { name: string; src?: string | null }) {
  const [imageFailed, setImageFailed] = useState(false)
  useEffect(() => { setImageFailed(false) }, [src])

  if (src && !imageFailed) {
    return (
      <span className="h-[32px] w-[32px] overflow-hidden rounded-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" onError={() => setImageFailed(true)} className="h-full w-full object-cover" />
      </span>
    )
  }
  return (
    <span
      className="flex h-[32px] w-[32px] items-center justify-center rounded-lg text-[13px] font-semibold text-[#212121]"
      style={{ backgroundImage: NAME_CHIP_GRADIENT }}
    >
      {initialsFromName(name)}
    </span>
  )
}

/** 团队有效期：内测期没有到期这回事，只有被平台停用才亮红点。 */
function TeamExpiryBadge() {
  const [label, setLabel] = useState<string | null>(null)
  const [danger, setDanger] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiFetch('/api/team-center', { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) return
      const data = await response.json()
      const team = (data.teams || []).find((item: any) => item.team.id === data.activeTeamId) || data.teams?.[0]
      if (!team || cancelled) return
      const disabled = team.team.status === 'DISABLED'
      setLabel(disabled ? '已停用' : '长期有效')
      setDanger(disabled)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (!label) return null
  return (
    <Link
      href="/studio/team?tab=team"
      className={`relative ${RAIL_ICON_BUTTON} text-muted-foreground hover:text-accent-foreground`}
      title={`团队 ${label}`}
    >
      <Clock3 className={`h-[20px] w-[20px] ${danger ? 'text-destructive' : ''}`} />
      {danger && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-destructive" />}
    </Link>
  )
}

/**
 * 工作台左侧图标栏：承载原顶栏的全部功能（团队切换、项目/团队导航、
 * 有效期、主题、帮助、个人菜单）。
 */
export default function StudioRail() {
  const { user, logout } = useAuth()
  const pathname = usePathname()
  const [showUserMenu, setShowUserMenu] = useState(false)
  const ta = useTranslations('auth')

  const userMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false)
      }
    }
    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showUserMenu])

  if (!user) return null

  const contactEmail = getContactEmail(user.email)
  const displayName = user.name || user.phone || contactEmail || '微信用户'

  // 窄栏自己带这条左留白带（lg:pl-5 让图标坐在带正中），这样每个 /studio 页面看到的栏宽都一样：
  // 以前只有项目页容器自己补了 lg:pl-5，团队管理等页面没有 ⇒ 同样的栏在那边看着窄一截。
  // lg:w-[71.25px] ＝ 原来的 w-14(52.5) ＋ 原来那条 lg:mr-5(18.75) 的空带：整列足迹和图标绝对位置
  // 一寸没动（判据 A16/A17），只是把空带并进栏面，右边不再留一条没涂装的白缝。
  return (
    <aside
      className="sticky top-0 z-40 flex h-screen w-14 shrink-0 flex-col items-center gap-2 bg-background py-3 lg:w-[71.25px] lg:pl-5 lg:pr-5"
      style={{ backgroundImage: 'var(--rail-gradient)' }}
    >
      <TeamSwitcher compact />

      <div className="my-1 h-px w-8 bg-border" aria-hidden />

      <ProjectsRailItem active={pathname === '/studio/projects'} />
      <RailSearch className={RAIL_ICON_BUTTON} />
      <RailNotifications className={RAIL_ICON_BUTTON} />
      <RailItem
        href="/studio/team"
        label="团队管理"
        active={pathname === '/studio/team' || pathname?.startsWith('/studio/team/') || false}
      >
        <Config theme="outline" size={20} />
      </RailItem>

      <div className="flex-1" aria-hidden />

      <TeamExpiryBadge />

      {/* 内层 select 点击后会一直占着焦点，focus-within 的环会常驻（用户明确不要外框），所以这里不打焦点环。 */}
      <ThemeToggle compact className="h-[44px] w-[44px] rounded-lg outline-none" />

      <RailItem
        href="https://scnqe74t5owc.feishu.cn/wiki/UOxownMcRiBLeekZwcEc3BBAnc2?from=from_copylink"
        label="帮助文档"
        external
      >
        <CircleHelp className="h-[20px] w-[20px]" />
      </RailItem>

      <RailFeedback className={RAIL_ICON_BUTTON} />

      {/* 定宽而不是 w-full：w-full 只有内容盒那 36px，44px 的按钮在里面居不了中（auto 外边距在超宽时归零），
          会整枚贴左、比其他图标右移 4px。给成和控件同宽，交给栏的 items-center 居中。 */}
      <div className="relative w-[44px]">
        <button
          onClick={() => setShowUserMenu(!showUserMenu)}
          className={`${RAIL_ICON_BUTTON}`}
          aria-label={displayName}
          title={displayName}
        >
          <RailAvatar name={displayName} src={user.avatarUrl} />
        </button>
        {showUserMenu && (
          <div className="absolute left-full bottom-0 ml-2 w-56 rounded-lg border border-border bg-card shadow-elevation-lg z-50">
            <div className="px-3 py-2.5 border-b border-border">
              <p className="text-sm font-medium truncate">{displayName}</p>
              {user.name && contactEmail && <p className="text-xs text-muted-foreground truncate">{contactEmail}</p>}
              <p className="text-xs text-muted-foreground mt-0.5">
                {user.teamRole === 'OWNER' ? '创建人' : user.teamRole === 'ADMIN' ? '管理员' : user.teamRole === 'MEMBER' ? '成员' : '未加入团队'}
              </p>
            </div>
            <div className="p-1">
              <Link
                href="/profile"
                onClick={() => setShowUserMenu(false)}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent transition-colors"
              >
                <UserRound className="w-4 h-4" />
                个人中心
              </Link>
              <button
                onClick={() => { setShowUserMenu(false); logout() }}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-sm rounded-md text-destructive hover:bg-destructive/10 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                {ta('signOut')}
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}

/**
 * 选中态只换图标颜色、不铺底色：frame.io 那条 dock 的 `[aria-current="page"]` 规则
 * 里只有一句 `color: --colors-text-primary`，`background` 与 `box-shadow` 都是 none，
 * 而且 hover 用 `:not([aria-current="page"])` 排除掉当前项——当前项再亮一层灰底就等于
 * 鼠标比所在页面还显眼。
 */
function ProjectsRailItem({ active }: { active: boolean }) {
  return (
    <Link
      href="/studio/projects"
      title="项目中心"
      className={`${RAIL_ICON_BUTTON} ${
        active
          ? 'text-foreground'
          : 'text-muted-foreground hover:text-accent-foreground'
      }`}
      aria-current={active ? 'page' : undefined}
    >
      <AllApplication theme="outline" size={20} />
    </Link>
  )
}

function RailItem({
  href, label, title, children, active, external,
}: {
  href: string
  label: string
  title?: string
  children: React.ReactNode
  active?: boolean
  external?: boolean
}) {
  const className = `${RAIL_ICON_BUTTON} ${
    active
      ? 'text-foreground'
      : 'text-muted-foreground hover:text-accent-foreground'
  }`
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className} title={title || label}>
        {children}
      </a>
    )
  }
  return (
    <Link href={href} className={className} title={title || label}>
      {children}
    </Link>
  )
}
