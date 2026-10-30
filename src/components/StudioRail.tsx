'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Calendar, Check, LogOut, MonitorDown, UserRound } from 'lucide-react'
import { AllApplication, Config } from '@icon-park/react'
import { useAuth } from '@/components/AuthProvider'
import { initialsFromName } from '@/components/InitialsAvatar'
import RailSearch from '@/components/RailSearch'
import RailFeedback from '@/components/RailFeedback'
import RailHelp from '@/components/RailHelp'
import RailNotifications from '@/components/RailNotifications'
import { apiPost } from '@/lib/api-client'
import { getActiveTeamId, setActiveTeamId } from '@/lib/team-store'
import { maskPhoneDisplay } from '@/lib/phone-display'
import { THEME_CHOICES, applyThemeChoice, readThemeFromDom, type ThemeChoice } from '@/lib/theme'
import { getContactEmail } from '@/lib/user-contact'
import { useTranslations } from 'next-intl'
import motion from '@/components/ui/surface-motion.module.css'

/** 图标只有 tooltip 不够：只用键盘时也要看得见落点，整条栏共用这一组类。 */
const RAIL_ICON_BUTTON = 'flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card'

/**
 * 没照片时那颗名字片：两端色取自他给的对标截图（#ff7ef9 / #fb5cf7），深色字压上去
 * 两端都过 4.5:1（判据 A7 由 getComputedStyle 实算）；有照片时照片直接铺满，
 * 头像本体不再涂渐变——那条粉色渐变归窄栏（globals.css 的 --rail-gradient），不归头像。
 */
const NAME_CHIP_GRADIENT = 'linear-gradient(180deg, #ff7ef9, #fb5cf7)'

/** 44px 命中区一寸不动，里面收成 32px：有照片是圆图，没照片是名字坐在方片里（他截图那颗就是方角，圆角跟这一列其他控件同一档）。 */
function RailAvatar({ name, src, size = 32 }: { name: string; src?: string | null; size?: number }) {
  const [imageFailed, setImageFailed] = useState(false)
  useEffect(() => { setImageFailed(false) }, [src])

  if (src && !imageFailed) {
    return (
      <span className="overflow-hidden rounded-full" style={{ width: size, height: size }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" onError={() => setImageFailed(true)} className="h-full w-full object-cover" />
      </span>
    )
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold text-[#212121]"
      style={{ width: size, height: size, backgroundImage: NAME_CHIP_GRADIENT }}
    >
      {initialsFromName(name)}
    </span>
  )
}

/** 团队有效期已迁到项目页顶栏（纯文字样式，对标 frame.io 顶栏的「还剩 N 天」）。 */

/**
 * 工作台左侧图标栏：承载原顶栏的全部功能（团队切换、项目/团队导航、
 * 有效期、主题、帮助、个人菜单）。
 */
export default function StudioRail() {
  const { user, logout } = useAuth()
  const pathname = usePathname()
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [collapsedTeamGroups, setCollapsedTeamGroups] = useState<Record<string, boolean>>({})
  const ta = useTranslations('auth')
  const tc = useTranslations('controls')
  const ts = useTranslations('selectTeam')
  const [theme, setTheme] = useState<ThemeChoice>(() => (typeof document !== 'undefined' ? readThemeFromDom() : 'light'))

  const userMenuRef = useRef<HTMLDivElement>(null)
  const userButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const syncTheme = () => setTheme(readThemeFromDom())
    syncTheme()
    const observer = new MutationObserver(syncTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!showUserMenu) return
    userMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    function handleClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node) && !userButtonRef.current?.contains(e.target as Node)) {
        setShowUserMenu(false)
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      setShowUserMenu(false)
      userButtonRef.current?.focus()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [showUserMenu])

  const moveMenuFocus = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const items = Array.from(userMenuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    if (items.length === 0) return
    const index = items.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'Home' ? 0
      : e.key === 'End' ? items.length - 1
      : e.key === 'ArrowDown' ? (index + 1) % items.length
      : (index - 1 + items.length) % items.length
    e.preventDefault()
    items[next].focus()
  }

  if (!user) return null

  const roleLabel = user.teamRole === 'OWNER' ? '创建人'
    : user.teamRole === 'ADMIN' ? '管理员'
    : user.teamRole === 'MEMBER' ? '成员'
    : '未加入团队'
  const contactEmail = getContactEmail(user.email)
  const displayName = user.name || maskPhoneDisplay(user.phone) || contactEmail || '微信用户'
  const activeTeamId = getActiveTeamId() || user.teams?.[0]?.team.id || null
  const teamGroups = user.teams && user.teams.length > 0
    ? [
        { key: 'created', label: ts('created'), items: user.teams.filter((item) => item.role === 'OWNER') },
        { key: 'joined', label: ts('joined'), items: user.teams.filter((item) => item.role !== 'OWNER') },
      ].filter((group) => group.items.length > 0)
    : []
  const themeLabels: Record<ThemeChoice, string> = {
    light: tc('themeLight'),
    mint: tc('themeMint'),
    frame: tc('themeFrame'),
    dark: tc('themeDark'),
  }
  const themeSwatches: Record<ThemeChoice, string> = {
    light: '#ffffff',
    mint: '#c9f2df',
    frame: '#a5a7c2',
    dark: '#1a1c25',
  }

  const switchTeam = async (teamId: string) => {
    setShowUserMenu(false)
    if (teamId === activeTeamId) return
    setActiveTeamId(teamId)
    try {
      await apiPost('/api/teams/switch', { teamId })
    } catch {
      // Local state is authoritative; the reload pulls the new session.
    }
    window.location.reload()
  }

  const chooseTheme = (choice: ThemeChoice) => {
    localStorage.setItem('theme', choice)
    applyThemeChoice(choice)
    setTheme(choice)
  }

  // 窄栏自己带这条左留白带，这样每个 /studio 页面看到的栏宽都一样：以前只有项目页容器自己补了
  // lg:pl-5，团队管理等页面没有 ⇒ 同样的栏在那边看着窄一截。
  // lg 档 56px：图标 44px 居中后中心在 x=28，内容区左缘跟着走到 56（判据 A16/A17 记的就是这两个数）。
  // 根字号是 15px（globals.css:10），所以基础档 w-14 其实是 52.5px，只有窄屏用得到。
  return (
    <aside
      className="sticky top-0 z-40 flex h-screen w-14 shrink-0 flex-col items-center gap-2 bg-background py-3 lg:w-[56px] lg:rounded-br-[8px]"
      style={{ backgroundImage: 'var(--rail-gradient)' }}
    >
      <ProjectsRailItem active={pathname === '/studio/projects'} />
      <RailSearch className={RAIL_ICON_BUTTON} />
      <RailNotifications className={RAIL_ICON_BUTTON} enabled={teamGroups.length > 0} />
      <RailItem
        href="/studio/calendar"
        label="项目日历"
        active={pathname === '/studio/calendar' || Boolean(pathname?.startsWith('/studio/calendar/'))}
      >
        <Calendar className="h-[20px] w-[20px]" />
      </RailItem>
      <RailItem href="/studio/desktop" label="桌面客户端" active={pathname === '/studio/desktop'}>
        <MonitorDown className="h-[20px] w-[20px]" />
      </RailItem>
      <RailItem
        href="/studio/team"
        label="团队管理"
        active={pathname === '/studio/team' || pathname?.startsWith('/studio/team/') || false}
      >
        <Config theme="outline" size={20} />
      </RailItem>

      <div className="flex-1" aria-hidden />

      <RailHelp className={RAIL_ICON_BUTTON} />

      <RailFeedback className={RAIL_ICON_BUTTON} />

      {/* 定宽而不是 w-full：w-full 只有内容盒那 36px，44px 的按钮在里面居不了中（auto 外边距在超宽时归零），
          会整枚贴左、比其他图标右移 4px。给成和控件同宽，交给栏的 items-center 居中。 */}
      <div className="relative w-[44px]">
        <button
          ref={userButtonRef}
          onClick={() => setShowUserMenu(!showUserMenu)}
          className={`${RAIL_ICON_BUTTON}`}
          aria-label={displayName}
          aria-haspopup="menu"
          aria-expanded={showUserMenu}
          title={displayName}
        >
          <RailAvatar name={displayName} src={user.avatarUrl} />
        </button>
        {showUserMenu && (
          <div
            ref={userMenuRef}
            role="menu"
            aria-label={displayName}
            data-state="open"
            onKeyDown={moveMenuFocus}
            className={`absolute bottom-0 left-full z-50 ml-2 max-h-[calc(100vh-1.5rem)] w-64 overflow-y-auto rounded-lg border border-border bg-card shadow-elevation-lg ${motion.surface} ${motion.railMenu}`}
          >
            {/* 账号卡：同一枚头像（有照片是照片、没有是名字片），跟窄栏那枚对得上。
                这一条以前只有两行字，点开像一张裸列表。 */}
            <div className="flex items-center gap-2.5 border-b border-border bg-muted/40 px-3 py-2.5">
              <RailAvatar name={displayName} src={user.avatarUrl} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{displayName}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">{roleLabel}{user.phone ? ` · ${maskPhoneDisplay(user.phone)}` : ''}</span>
              </span>
            </div>
            <div className="border-b border-border px-3 py-2.5">
              {teamGroups.length > 0 ? (
                <div className="space-y-2">
                  {teamGroups.map((group) => (
                    <div key={group.key}>
                      <button
                        type="button"
                        onClick={() => setCollapsedTeamGroups((current) => ({ ...current, [group.key]: !current[group.key] }))}
                        aria-expanded={!collapsedTeamGroups[group.key]}
                        className="mb-1 flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-left text-[10px] font-medium uppercase tracking-wide text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent"
                      >
                        <svg
                          viewBox="0 0 8 5"
                          aria-hidden="true"
                          className={`h-[5px] w-2 shrink-0 transition-transform ${collapsedTeamGroups[group.key] ? '-rotate-90' : ''}`}
                        >
                          <path d="M0 0h8L4 5z" fill="currentColor" />
                        </svg>
                        {group.label}
                      </button>
                      {!collapsedTeamGroups[group.key] && (
                      <div className="space-y-0.5">
                        {group.items.map((item) => (
                          <button
                            key={item.team.id}
                            type="button"
                            role="menuitem"
                            onClick={() => void switchTeam(item.team.id)}
                            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-accent focus-visible:bg-accent ${
                              item.team.id === activeTeamId ? 'bg-accent/60 text-foreground' : 'text-muted-foreground'
                            }`}
                          >
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[11px] font-semibold text-primary">
                              {item.team.name.slice(0, 1).toUpperCase()}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">{item.team.name}</span>
                              <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                                {item.team.createdBy?.name || (item.role === 'OWNER' ? ts('roleOwner') : item.role === 'ADMIN' ? ts('roleAdmin') : ts('roleMember'))}
                              </span>
                            </span>
                            {item.team.id === activeTeamId && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                          </button>
                        ))}
                      </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">{ts('empty')}</p>
              )}
            </div>
            <div className="border-b border-border px-3 py-2.5">
              <p className="text-[11px] font-medium text-muted-foreground">主题</p>
              <div className="mt-1.5 grid grid-cols-2 gap-1">
                {THEME_CHOICES.map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    role="menuitem"
                    onClick={() => chooseTheme(choice)}
                    className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs outline-none transition-colors hover:bg-accent focus-visible:bg-accent ${
                      theme === choice ? 'bg-accent/60 font-medium text-foreground' : 'text-muted-foreground'
                    }`}
                  >
                    <span
                      className={`h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-border ${choice === 'light' ? 'bg-white' : ''}`}
                      style={choice === 'light' ? undefined : { backgroundColor: themeSwatches[choice] }}
                    />
                    <span className="min-w-0 flex-1 truncate">{themeLabels[choice]}</span>
                    {theme === choice && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-1.5">
              <Link
                href="/profile"
                role="menuitem"
                onClick={() => setShowUserMenu(false)}
                className="flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm text-foreground outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
              >
                <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                个人中心
              </Link>
              <div className="my-1 border-t border-border" />
              <button
                type="button"
                role="menuitem"
                onClick={() => { setShowUserMenu(false); logout() }}
                className="flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-sm text-destructive outline-none transition-colors hover:bg-destructive/10 focus-visible:bg-destructive/10"
              >
                <LogOut className="h-4 w-4 shrink-0" />
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
  href, label, title, children, active,
}: {
  href: string
  label: string
  title?: string
  children: React.ReactNode
  active?: boolean
}) {
  const className = `${RAIL_ICON_BUTTON} ${
    active
      ? 'text-foreground'
      : 'text-muted-foreground hover:text-accent-foreground'
  }`
  return (
    <Link href={href} className={className} title={title || label} aria-current={active ? 'page' : undefined}>
      {children}
    </Link>
  )
}
