'use client'

import { appAlert, appConfirm } from '@/components/AppDialogProvider'

import { useState, useEffect, useRef, type ElementType, type ReactNode } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Project } from '@prisma/client'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Trash2, Link2, Archive, ArchiveRestore, RotateCcw, CheckCircle, BarChart3, Calendar, Copy, Check, ChevronsUpDown, FileText, Users, Share2, UserPlus } from 'lucide-react'
import type { ProjectSettingsSection } from './ProjectSettingsPanel'
import { UnapproveModal } from './UnapproveModal'
import { FeishuPushButton } from './FeishuPushButton'
import { apiPost, apiPatch, apiDelete, apiFetch } from '@/lib/api-client'
import { copyTextToClipboard } from '@/lib/clipboard'
import { useAuth } from '@/components/AuthProvider'

interface Video {
  id: string
  name: string
  versionLabel: string
  status: string
  approved: boolean
}

/** 项目默认头像：frame.io 的三张预设渐变图原样搬来（@2x），按项目 id 稳定轮换。 */
const PROJECT_AVATAR_GRADIENTS = [
  '/avatars/project-card-10@2x.jpg',
  '/avatars/project-card-11@2x.jpg',
  '/avatars/project-card-12@2x.jpg',
]

function projectAvatarGradient(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return PROJECT_AVATAR_GRADIENTS[Math.abs(hash) % PROJECT_AVATAR_GRADIENTS.length]
}

interface ProjectActionsProps {
  project: Project
  videos: Video[]
  onRefresh?: () => void
  /** 侧栏下半区不要白底卡片壳：只换掉 Card 三层外壳，结构、间距与交互一字不动。 */
  bare?: boolean
  /** 「分享审阅链接」按下的那一下由页面接管：整项目范围的创建弹窗只有页面那份状态能开。 */
  onShareReview: () => void
  /** 还没有可复制的收录链接时，这枚按钮开的也是页面那枚创建窗。 */
  onCreateCollectLink: () => void
  /** 这排菜单就是项目设置那三节：按下哪一节，由页面浮起设置面板并落在这一节。 */
  onOpenSettings: (section: ProjectSettingsSection) => void
  /** 第四项开的是成员窗：同样是页面那一层浮栏，不是第二条路由。 */
  onOpenMembers: () => void
}

export default function ProjectActions({ project, videos, onRefresh, bare = false, onShareReview, onCreateCollectLink, onOpenSettings, onOpenMembers }: ProjectActionsProps) {
  const t = useTranslations('projects')
  const tc = useTranslations('common')
  const locale = useLocale()
  const router = useRouter()
  const { user } = useAuth()
  const [isDeleting, setIsDeleting] = useState(false)
  const [isTogglingApproval, setIsTogglingApproval] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)

  const [showUnapproveModal, setShowUnapproveModal] = useState(false)

  // 身份块整块是一枚弹出式按钮（对标那排也是整块可点），点开的是这个项目自己的菜单。
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const menuRootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // 「复制收录链接」是读操作：拿该项目最新一条有效收录短链写进剪贴板，
  // 已取消与已过期的都不算——复制出去只会让人拿到打不开的地址。
  const [collectLinkBusy, setCollectLinkBusy] = useState(false)
  const [collectLinkCopied, setCollectLinkCopied] = useState(false)
  const collectCopiedTimer = useRef<number | null>(null)
  useEffect(() => () => {
    if (collectCopiedTimer.current !== null) window.clearTimeout(collectCopiedTimer.current)
  }, [])

  const handleCopyCollectLink = async () => {
    if (collectLinkBusy) return
    setCollectLinkBusy(true)
    try {
      const response = await apiFetch(`/api/projects/${project.id}/share-links`, { cache: 'no-store' })
      if (!response.ok) {
        appAlert(tc('errorTryAgain'))
        return
      }
      const data = await response.json()
      const collect = (Array.isArray(data.shareLinks) ? data.shareLinks : []).find(
        (link: any) => link.type === 'COLLECT' && link.scopeType === 'PROJECT' && link.status === 'ACTIVE',
      )
      if (!collect) {
        onCreateCollectLink()
        return
      }
      if (!await copyTextToClipboard(collect.url)) {
        appAlert(tc('errorTryAgain'))
        return
      }
      setCollectLinkCopied(true)
      if (collectCopiedTimer.current !== null) window.clearTimeout(collectCopiedTimer.current)
      collectCopiedTimer.current = window.setTimeout(() => setCollectLinkCopied(false), 1500)
    } catch {
      appAlert(tc('errorTryAgain'))
    } finally {
      setCollectLinkBusy(false)
    }
  }

  // Check if user has admin privileges (ADMIN or SUPER_ADMIN)
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'

  // Filter only ready videos
  const readyVideos = videos.filter(v => v.status === 'READY')

  // Check if all unique videos have at least one approved version
  const videosByNameForApproval = readyVideos.reduce((acc, video) => {
    if (!acc[video.name]) {
      acc[video.name] = []
    }
    acc[video.name].push(video)
    return acc
  }, {} as Record<string, Video[]>)

  const allVideosHaveApprovedVersion = Object.values(videosByNameForApproval).every((versions: Video[]) =>
    versions.some(v => v.approved)
  )

  const canApproveProject = readyVideos.length > 0 && allVideosHaveApprovedVersion

  const handleToggleApproval = async () => {
    // Prevent double-clicks during approval toggle
    if (isTogglingApproval) return

    const isCurrentlyApproved = project.status === 'APPROVED'

    if (isCurrentlyApproved) {
      setShowUnapproveModal(true)
    } else {
      if (!await appConfirm(t('confirmApproveProject'))) {
        return
      }

      setIsTogglingApproval(true)

      apiPatch(`/api/projects/${project.id}`, { status: 'APPROVED' })
        .then(() => {
          appAlert(t('approvedSuccessfully'))
          onRefresh?.()
          router.refresh()
        })
        .catch(() => {
          appAlert(t('failedToApprove'))
        })
        .finally(() => {
          setIsTogglingApproval(false)
        })
    }
  }

  const handleUnapprove = async (unapproveVideos: boolean) => {
    // Prevent double-clicks during unapproval
    if (isTogglingApproval) return

    setIsTogglingApproval(true)
    setShowUnapproveModal(false)

    apiPost(`/api/projects/${project.id}/unapprove`, { unapproveVideos })
      .then((data) => {
        // Show appropriate success message
        if (data.unapprovedVideos && data.unapprovedCount > 0) {
          appAlert(`${t('unapprovedSuccessfully')} ${data.unapprovedCount} ${t('videosUnapproved')}`)
        } else if (data.unapprovedVideos && data.unapprovedCount === 0) {
          appAlert(`${t('unapprovedSuccessfully')} ${t('noVideosApproved')}`)
        } else {
          appAlert(`${t('unapprovedSuccessfully')} ${t('videosRemainApproved')}`)
        }
        onRefresh?.()
        router.refresh()
      })
      .catch(() => {
        appAlert(t('failedToUnapprove'))
      })
      .finally(() => {
        setIsTogglingApproval(false)
      })
  }

  const handleUnapproveProjectOnly = () => {
    handleUnapprove(false)
  }

  const handleUnapproveAll = () => {
    handleUnapprove(true)
  }

  const handleCancelUnapprove = () => {
    setShowUnapproveModal(false)
  }

  const handleDelete = async () => {
    // Prevent double-clicks during deletion
    if (isDeleting) return

    if (!await appConfirm(t('deleteConfirm'))) {
      return
    }

    // Double confirmation for safety
    if (!await appConfirm(t('deleteLastWarning'))) {
      return
    }

    setIsDeleting(true)

    apiDelete(`/api/projects/${project.id}`)
      .then(() => {
        router.push('/studio/projects')
        router.refresh()
      })
      .catch(() => {
        appAlert(t('failedToDelete'))
        setIsDeleting(false)
      })
  }

  const handleToggleArchive = async () => {
    if (isArchiving) return

    const isCurrentlyArchived = project.status === 'ARCHIVED'
    const action = isCurrentlyArchived ? 'unarchive' : 'archive'
    const newStatus = isCurrentlyArchived ? 'IN_REVIEW' : 'ARCHIVED'

    if (!await appConfirm(isCurrentlyArchived ? t('unarchiveConfirm') : t('archiveConfirm'))) {
      return
    }

    setIsArchiving(true)

    apiPatch(`/api/projects/${project.id}`, { status: newStatus })
      .then(() => {
        appAlert(action === 'archive' ? t('archivedSuccessfully') : t('unarchivedSuccessfully'))
        onRefresh?.()
        router.refresh()
      })
      .catch(() => {
        appAlert(action === 'archive' ? t('failedToArchive') : t('failedToUnarchive'))
      })
      .finally(() => {
        setIsArchiving(false)
      })
  }

  // 菜单开着才挂 document 监听：点外面关掉（照 TeamSwitcher 那套手搓下拉的规矩）、Escape 关并把焦点
  // 还给身份块、方向键在项间走。这组件在项目页挂两枚（侧栏 bare ＋ 窄屏卡片），监听必须随开随摘。
  useEffect(() => {
    if (!projectMenuOpen) return
    const root = menuRootRef.current
    const handleMouseDown = (event: MouseEvent) => {
      if (root && !root.contains(event.target as Node)) setProjectMenuOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProjectMenuOpen(false)
        triggerRef.current?.focus()
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      event.preventDefault()
      const items = menuRef.current
        ? Array.from(menuRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'))
        : []
      if (items.length === 0) return
      const at = items.indexOf(document.activeElement as HTMLElement)
      const down = event.key === 'ArrowDown'
      const next = at === -1 ? (down ? 0 : items.length - 1) : (at + (down ? 1 : -1) + items.length) % items.length
      items[next].focus()
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [projectMenuOpen])

  // 菜单这一排＝设置那三节 + 成员窗：关掉菜单，把要开的那层交给页面。
  // 焦点必须先交回身份块再开浮层：浮层挂载时抓的是 document.activeElement，而这一枚 menuitem
  // 在同一次提交里就卸掉了，不接住的话关掉浮层后焦点掉回 <body>，键盘和读屏找不回刚才那排。
  const handoffToOverlay = (open: () => void) => {
    setProjectMenuOpen(false)
    triggerRef.current?.focus()
    open()
  }
  const pickSection = (section: ProjectSettingsSection) => handoffToOverlay(() => onOpenSettings(section))
  const pickMembers = () => handoffToOverlay(onOpenMembers)

  // bare 时三层外壳换成普通 div：Card 的 bg-card、border 和 shadow 就是那块要拿掉的白底。
  // 名称那行跟着换：整块是一枚 <button>，button 的内容模型不许套 <h3>（CardTitle 就是 h3），
  // 所以 bare 用 span 自己带 CardTitle 那套字号字重，两种形态画出来一模一样。
  const Shell: ElementType = bare ? 'div' : Card
  const ShellHeader: ElementType = bare ? 'div' : CardHeader
  const ShellContent: ElementType = bare ? 'div' : CardContent
  const ShellTitle: ElementType = bare ? 'span' : CardTitle
  const titleClass = bare ? 'block min-w-0 truncate text-[20px] font-semibold leading-none tracking-tight' : 'truncate text-[20px]'

  return (
    <>
      <Shell>
        <ShellHeader className={bare ? 'relative border-b border-border pt-[20px] pb-3' : 'relative'}>
          {/* 照 Frame.io 侧栏顶部那排项目切换器排：封面块在左、名称与人数两行整体缩到封面块右边，
              整行垂直居中，右侧一枚上下箭头，整块点开是项目菜单。
              尺寸全用 px 字面量：`:root .h-12` 被控件阶梯压到 2.625rem（=39.4px），而 `.w-12` 不在阶梯里，
              写 `h-12 w-12` 会画出一枚 45×39.4 的扁块；gap/字号同理吃 15px 根字号。
              48px 块配 20px 字、封面块到文字 16px、第二行 14px 无图标、块上内边距 20px，
              四个数都是 10-03 在 next.frame.io 那排上量的（量的过程见 frameio-study/）。
              名称超一行就截断，对标那排自己也截（「小白's First P…」），别当缺陷改成折行。
              封面块不画图标：对标那块是纯渐变面，两端一暗一亮（黑/30 → 白/25），不是黑压黑的一块实心。
              箭头吃 text-foreground：对标那枚最暗像素 (76,80,99) 几乎就是它标题的 (63,65,77)；
              跟第二行同灰时实量只到 (138,141,156)，看着像禁用。
              菜单与这块同宽、不带描边、吃 --popover：对标那层只有投影浮着，占栏宽 0.94。 */}
          <div ref={menuRootRef}>
            <button
              type="button"
              ref={triggerRef}
              data-tutorial="project-info-trigger"
              aria-haspopup="menu"
              aria-expanded={projectMenuOpen}
              onClick={() => setProjectMenuOpen((open) => !open)}
              className="flex w-full min-w-0 items-center gap-[16px] rounded-[8px] text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className="h-[48px] w-[48px] shrink-0 rounded-[8px] bg-cover bg-center"
                style={{ backgroundImage: `url(${projectAvatarGradient(project.id)})` }}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <ShellTitle className={titleClass}>{project.title}</ShellTitle>
                {/* 第二行只报人数。取不到数字就不画，宁缺一个也别把「0 人」当成事实显示出去。 */}
                {typeof (project as any).memberCount === 'number' && (
                  <p className="mt-[6px] min-w-0 truncate text-[14px] text-muted-foreground">
                    {t('projectMemberCount', { count: (project as any).memberCount })}
                  </p>
                )}
              </span>
              <ChevronsUpDown className="h-[16px] w-[16px] shrink-0 text-foreground" aria-hidden="true" />
            </button>

            {projectMenuOpen && (
              <div
                ref={menuRef}
                role="menu"
                aria-label={t('projectMenuLabel')}
                className={`absolute top-[calc(100%+1px)] z-50 rounded-lg bg-popover p-1 shadow-elevation-lg ${bare ? '-left-5 -right-5' : 'left-0 right-0'}`}
              >
                <MenuItem
                  icon={<FileText className="h-4 w-4 shrink-0" />}
                  label={t('projectDetails')}
                  onSelect={() => pickSection('project-details')}
                />
                <MenuItem
                  icon={<Users className="h-4 w-4 shrink-0" />}
                  label={t('clientInfoNotifications')}
                  onSelect={() => pickSection('client-info')}
                />
                <MenuItem
                  icon={<Share2 className="h-4 w-4 shrink-0" />}
                  label={t('clientSharePage')}
                  onSelect={() => pickSection('client-share')}
                />
                <MenuItem
                  icon={<UserPlus className="h-4 w-4 shrink-0" />}
                  label={t('projectMembers')}
                  onSelect={pickMembers}
                />
              </div>
            )}
          </div>
        </ShellHeader>
        <ShellContent className={bare ? 'space-y-3 pt-3' : 'space-y-3 pb-2'}>
          {/* Due Date */}
          {(project as any).dueDate && (() => {
            const due = new Date((project as any).dueDate)
            const today = new Date()
            // Compare using UTC dates to avoid timezone shifts
            today.setHours(0, 0, 0, 0)
            const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate())
            const diffDays = Math.round((dueDay.getTime() - today.getTime()) / 86400000)
            const isCompleted = project.status === 'APPROVED' || project.status === 'ARCHIVED' || project.status === 'SHARE_ONLY'
            let colorClass = ''
            if (!isCompleted) {
              if (diffDays < 0) colorClass = 'text-destructive'
              else if (diffDays <= 1) colorClass = 'text-warning'
              else if (diffDays <= 7) colorClass = 'text-primary'
            }
            const dateStr = due.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })

            return (
              <div className="pb-3 border-b border-border">
                <div className="text-sm">
                  <p className="text-muted-foreground mb-1">{t('dueDateLabel')}</p>
                  <p className={`font-medium flex items-center gap-2 ${colorClass}`}>
                    <Calendar className="w-4 h-4" />
                    {dateStr}
                  </p>
                  {!isCompleted && diffDays < 0 && <p className="text-xs text-destructive mt-1">{Math.abs(diffDays)} {Math.abs(diffDays) !== 1 ? t('days') : t('day')} {t('overdue')}</p>}
                  {!isCompleted && diffDays === 0 && <p className="text-xs text-warning mt-1">{t('dueToday')}</p>}
                  {!isCompleted && diffDays === 1 && <p className="text-xs text-warning mt-1">{t('dueTomorrow')}</p>}
                  {!isCompleted && diffDays > 1 && diffDays <= 7 && <p className="text-xs text-primary mt-1">{diffDays} {t('daysRemaining')}</p>}
                  {!isCompleted && diffDays > 7 && <p className="text-xs text-muted-foreground mt-1">{diffDays} {t('daysRemaining')}</p>}
                </div>
              </div>
            )
          })()}

          <Button
            variant="outline"
            size="default"
            className="w-full"
            onClick={onShareReview}
          >
            <Link2 className="w-4 h-4 mr-2" />
            {t('shareReviewLink')}
          </Button>

          {/* 上传接口在项目没开「允许客户提交素材」时一律 403，所以入口照分享记录面板的规矩只在开着时给。 */}
          {project.allowReverseShare && (
            <Button
              variant="outline"
              size="default"
              className="w-full"
              data-tutorial="copy-collect-link"
              disabled={collectLinkBusy}
              onClick={() => void handleCopyCollectLink()}
            >
              {collectLinkCopied
                ? <Check className="w-4 h-4 mr-2 text-emerald-600" />
                : <Copy className="w-4 h-4 mr-2" />}
              {collectLinkCopied ? tc('copied') : t('copyCollectLink')}
            </Button>
          )}

          <Button
            variant="outline"
            size="default"
            className="w-full"
            onClick={() => router.push(`/studio/projects/${project.id}/analytics`)}
          >
            <BarChart3 className="w-4 h-4 mr-2" />
            {t('viewAnalytics')}
          </Button>

          {/* Push Project Button - only for ADMIN and SUPER_ADMIN */}
          {isAdmin && (
            <FeishuPushButton
              projectId={project.id}
              className="w-full"
              size="default"
            />
          )}

          {/* Approve/Unapprove Toggle Button - hidden when archived */}
          {project.status !== 'ARCHIVED' && (
            <div>
              <Button
                variant="outline"
                size="default"
                className="w-full"
                onClick={handleToggleApproval}
                disabled={isTogglingApproval || (project.status !== 'APPROVED' && !canApproveProject)}
                title={
                  project.status !== 'APPROVED' && !canApproveProject
                    ? t('approveFirst')
                    : ''
                }
              >
                {project.status === 'APPROVED' ? (
                  <>
                    <RotateCcw className="w-4 h-4 mr-2" />
                    {isTogglingApproval ? tc('changing') : t('unapproveProject')}
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    {isTogglingApproval ? tc('changing') : t('approveProject')}
                  </>
                )}
              </Button>
              {project.status !== 'APPROVED' && !canApproveProject && (
                <p className="text-xs text-muted-foreground mt-1 px-1">
                  {t('approveFirstLong')}
                </p>
              )}
            </div>
          )}

          <Button
            variant="outline"
            size="default"
            className="w-full"
            onClick={handleToggleArchive}
            disabled={isArchiving}
          >
            {project.status === 'ARCHIVED' ? (
              <>
                <ArchiveRestore className="w-4 h-4 mr-2" />
                {isArchiving ? t('unarchiving') : t('unarchiveProject')}
              </>
            ) : (
              <>
                <Archive className="w-4 h-4 mr-2" />
                {isArchiving ? t('archiving') : t('archiveProject')}
              </>
            )}
          </Button>

          <Button
            variant="destructive"
            size="default"
            className="w-full"
            onClick={handleDelete}
            disabled={isDeleting}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            {isDeleting ? tc('deleting') : t('deleteProject')}
          </Button>
        </ShellContent>
      </Shell>

      {/* Unapprove Modal */}
      <UnapproveModal
        show={showUnapproveModal}
        onCancel={handleCancelUnapprove}
        onUnapproveProjectOnly={handleUnapproveProjectOnly}
        onUnapproveAll={handleUnapproveAll}
        processing={isTogglingApproval}
      />
    </>
  )
}

/** 项目菜单的一行。字号与内边距用 px 字面量：紧凑档的控件阶梯会把 text-sm/py-* 压平。 */
function MenuItem({ icon, label, onSelect }: {
  icon: ReactNode
  label: string
  onSelect: () => void
}) {
  return (
    // 尺寸抄 frame.io 项目菜单实测值：16px 字、24px 图标(stroke 1.5)、12/8 内边距、12px 图标-文字间距。
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className="flex w-full items-center gap-3 rounded-[4px] px-3 py-2 text-left text-[14px] text-foreground outline-none transition-colors hover:bg-accent focus-visible:bg-accent [&_svg]:size-6 [&_svg]:shrink-0 [&_svg]:stroke-[1.5]"
    >
      {icon}
      <span className="min-w-0 truncate">{label}</span>
    </button>
  )
}
