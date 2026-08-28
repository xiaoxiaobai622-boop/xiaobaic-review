'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { FolderKanban, GitBranch, HardDrive, LayoutDashboard, Users } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'

const sections = [
  { key: 'overview', label: '团队概览', href: '/studio/team', icon: LayoutDashboard },
  { key: 'members', label: '成员管理', href: '/studio/team/members', icon: Users },
  { key: 'storage', label: '容量管理', href: '/studio/team/storage', icon: HardDrive },
  { key: 'projects', label: '项目管理', href: '/studio/team/projects', icon: FolderKanban },
  { key: 'workflow', label: '流程管理', href: '/studio/team/workflow', icon: GitBranch, children: [{ label: '视频设置', href: '/studio/team/settings' }] },
]

const overviewTabs = [
  { label: '团队概览', href: '/studio/team?tab=overview', value: 'overview' },
  { label: '团队信息', href: '/studio/team?tab=team', value: 'team' },
  { label: '个人信息', href: '/studio/team?tab=personal', value: 'personal' },
]

const memberTabs = [
  { label: '席位成员', href: '/studio/team/members?tab=seats', value: 'seats' },
  { label: '组织结构', href: '/studio/team/members?tab=org', value: 'org' },
  { label: '角色管理', href: '/studio/team/members?tab=roles', value: 'roles' },
  { label: '项目成员', href: '/studio/team/members?tab=projects', value: 'projects' },
  { label: '外部联系人', href: '/studio/team/members?tab=external', value: 'external' },
]

const storageTabs = [
  { label: '空间报表', href: '/studio/team/storage?tab=report', value: 'report' },
  { label: '项目', href: '/studio/team/storage?tab=projects', value: 'projects' },
  { label: '团队资源库', href: '/studio/team/storage?tab=team', value: 'team' },
  { label: '个人资源库', href: '/studio/team/storage?tab=personal', value: 'personal' },
]

const projectTabs = [
  { label: '项目管理', href: '/studio/team/projects?tab=list', value: 'list' },
  { label: '项目分组', href: '/studio/team/projects?tab=groups', value: 'groups' },
  { label: '项目状态', href: '/studio/team/projects?tab=status', value: 'status' },
]

export default function TeamAdminShell({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const pathname = usePathname() ?? ''
  const searchParams = useSearchParams()
  const section = pathname === '/studio/team'
    ? sections[0]
    : sections.slice(1).find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`) || item.children?.some((child) => pathname === child.href || pathname.startsWith(`${child.href}/`))) || sections[0]
  const auxiliaryPage = pathname.startsWith('/studio/team/settings') || pathname.startsWith('/studio/team/invite') || pathname.startsWith('/studio/team/join')
  const tabs = auxiliaryPage ? [] : section.key === 'overview'
    ? overviewTabs
    : section.key === 'members'
      ? memberTabs
      : section.key === 'storage'
        ? storageTabs
        : section.key === 'projects'
          ? projectTabs
          : []
  const activeTab = searchParams?.get('tab') || tabs[0]?.value

  return (
    <div className="flex min-h-0 flex-1 bg-background">
      <div className="flex w-full min-w-0 flex-1 flex-col lg:flex-row">
        <aside className="shrink-0 border-b border-border bg-card lg:min-h-full lg:w-56 lg:border-b-0 lg:border-r">
          <div className="px-4 py-4 lg:px-5 lg:py-6">
            <p className="text-base font-semibold">团队管理</p>
          </div>
          <nav aria-label="团队管理菜单" className="grid min-w-0 grid-cols-2 gap-1 px-3 pb-3 lg:block lg:space-y-1 lg:px-3 lg:pb-0">
            {sections.map(({ key, label, href, icon: Icon, children: childItems }) => {
              const active = key === section.key
              return (
                <div key={key} className="min-w-0">
                  <Link href={href} className={`flex min-w-0 items-center gap-2 rounded-md px-3 py-2.5 text-sm transition-colors lg:w-full ${active ? 'bg-primary-visible font-medium text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}>
                    <Icon className="h-4 w-4" />
                    {label}
                  </Link>
                  {active && user && (user.teamRole === 'OWNER' || user.teamRole === 'ADMIN') && childItems?.map((child) => {
                    const childActive = pathname === child.href || pathname.startsWith(`${child.href}/`)
                    return <Link key={child.href} href={child.href} className={`ml-5 mt-1 flex min-w-0 items-center rounded-md border-l-2 py-2 pl-3 text-sm transition-colors ${childActive ? 'border-primary text-primary' : 'border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground'}`}>{child.label}</Link>
                  })}
                </div>
              )
            })}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          {tabs.length > 0 && (
            <nav aria-label={`${section.label}页签`} className="mb-6 flex gap-6 overflow-x-auto border-b border-border">
              {tabs.map((tab) => (
                <Link key={tab.value} href={tab.href} className={`relative -mb-px whitespace-nowrap px-1 pb-3 text-sm transition-colors ${activeTab === tab.value ? 'font-medium text-primary after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary' : 'text-muted-foreground hover:text-foreground'}`}>
                  {tab.label}
                </Link>
              ))}
            </nav>
          )}
          {children}
        </main>
      </div>
    </div>
  )
}
