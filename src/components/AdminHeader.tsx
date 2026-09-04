'use client'

import { useAuth } from '@/components/AuthProvider'
import { CircleHelp, FolderKanban, LogOut, User, UserRound, Users, Clock3 } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import ThemeToggle from '@/components/ThemeToggle'
import TeamSwitcher from '@/components/TeamSwitcher'
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { apiFetch } from '@/lib/api-client'

function TeamExpiryBadge() {
  const [label, setLabel] = useState<string | null>(null)
  const [danger, setDanger] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiFetch('/api/team-center').then(async (response) => {
      if (!response.ok) return
      const data = await response.json()
      const team = (data.teams || []).find((item: any) => item.team.id === data.activeTeamId) || data.teams?.[0]
      if (!team || cancelled) return
      const current = team.team
      let next = '长期有效'
      let isDanger = false
      if (current.status === 'DISABLED') { next = '已停用'; isDanger = true }
      else if (current.subscriptionPlan === 'UNACTIVATED') { next = '等待激活'; isDanger = true }
      else if (current.subscriptionExpiresAt) {
        const remaining = new Date(current.subscriptionExpiresAt).getTime() - Date.now()
        if (remaining <= 0) { next = '已到期'; isDanger = true }
        else {
          const days = Math.ceil(remaining / (24 * 60 * 60 * 1000))
          next = `${days} 天后到期`
          isDanger = days <= 3
        }
      }
      setLabel(next)
      setDanger(isDanger)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (!label) return null
  return <Link href="/studio/team?tab=team" className={`hidden items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium sm:inline-flex ${danger ? 'border-destructive/30 bg-destructive-visible text-destructive' : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground'}`} title="查看团队有效期"><Clock3 className="h-3.5 w-3.5" />团队 {label}</Link>
}

export default function AdminHeader() {
  const { user, logout } = useAuth()
  const pathname = usePathname()
  const [showUserMenu, setShowUserMenu] = useState(false)
  const t = useTranslations('nav')
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

  const navLinks: Array<{ href: string; label: string; icon: typeof FolderKanban; title?: string }> = [
    { href: '/studio/projects', label: t('projects'), icon: FolderKanban },
    { href: '/studio/team', label: '团队', icon: Users },
  ]

  const teamRoleLabel = user.teamRole === 'OWNER'
    ? '创建人'
    : user.teamRole === 'ADMIN'
      ? '管理员'
      : user.teamRole === 'MEMBER'
        ? '成员'
        : '未加入团队'

  return (
    <div className="relative z-40 bg-card border-b border-border/50 shadow-elevation-sm backdrop-blur-sm">
      <div className="w-full px-3 sm:px-4 lg:px-6 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-6 flex-1 min-w-0">
            <TeamSwitcher />
            <nav className="flex gap-1 sm:gap-2 overflow-x-auto">
              {navLinks.map((link) => {
                const Icon = link.icon
                const isActive = pathname === link.href || (link.href !== '/studio/projects' && pathname?.startsWith(link.href))

                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    title={link.title || link.label || undefined}
                    className={`flex min-h-11 items-center gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-all duration-200 whitespace-nowrap ${
                      isActive
                        ? 'bg-primary text-primary-foreground shadow-elevation'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    }`}
                  >
                    {Icon && <Icon className="w-4 h-4" />}
                    {link.label && <span className="hidden sm:inline">{link.label}</span>}
                  </Link>
                )
              })}
            </nav>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <TeamExpiryBadge />
            <ThemeToggle className="h-11 w-11 shrink-0 rounded-lg shadow-sm" />
            <a
              href="https://scnqe74t5owc.feishu.cn/wiki/UOxownMcRiBLeekZwcEc3BBAnc2?from=from_copylink"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-background shadow-sm transition-colors hover:bg-accent"
              aria-label="打开帮助文档"
              title="帮助文档"
            >
              <CircleHelp className="h-5 w-5 text-foreground" />
            </a>
            <div ref={userMenuRef} className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-background hover:bg-accent transition-colors shadow-sm"
                aria-label={user.name || user.email}
                title={user.name || user.email}
              >
                <User className="h-5 w-5 text-foreground" />
              </button>
              {showUserMenu && (
                <div className="absolute right-0 top-full mt-1 w-56 rounded-lg border border-border bg-card shadow-elevation-lg z-50">
                  <div className="px-3 py-2.5 border-b border-border">
                    <p className="text-sm font-medium truncate">{user.name || user.email}</p>
                    {user.name && <p className="text-xs text-muted-foreground truncate">{user.email}</p>}
                    <p className="text-xs text-muted-foreground mt-0.5">{teamRoleLabel}</p>
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
          </div>
        </div>
      </div>
    </div>
  )
}
