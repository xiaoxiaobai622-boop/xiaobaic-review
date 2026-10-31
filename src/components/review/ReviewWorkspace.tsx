'use client'

import { useMemo, type ReactNode } from 'react'
import { Check, Share2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import ThumbnailReel from '@/components/ThumbnailReel'
import VideoPlayer from '@/components/VideoPlayer'
import CommentSection from '@/components/CommentSection'
import ReviewLoginActions from '@/components/ReviewLoginActions'
import LanguageToggle from '@/components/LanguageToggle'
import ThemeToggle from '@/components/ThemeToggle'
import VideoReviewStatusSelect from '@/components/VideoReviewStatusSelect'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { ReviewCapabilities } from '@/lib/review-capabilities'
import { getLatestVideo } from '@/lib/video-comment-counts'

/**
 * 一套审片壳：两条入口只提供数据源与登录身份，控件可见性全部来自 capabilities。
 * 页面里不再出现 isAdmin={false} / allowComparison={false} / showVisibilitySelector={false}
 * 这类按路由写死的权限常量。
 */
export interface ReviewWorkspaceProps {
  project: {
    id: string
    title: string
    description?: string | null
    status: string
    hasSharePassword?: boolean
    watermarkEnabled?: boolean
    timestampDisplay?: string | null
    clientCanApprove?: boolean
    allowAssetDownload?: boolean
    settings?: { maxCommentAttachments?: number } | null
  }
  videos: any[]
  videosByName: Record<string, any[]>
  thumbnailsByName: Map<string, string>
  activeVideoName: string
  comments: any[]
  capabilities: ReviewCapabilities
  source: 'admin' | 'share'
  shareToken?: string | null
  /** 分享入口的地址 slug（CommentSection 走分享接口时用），后台入口为 null。 */
  projectSlug?: string | null
  isGuest?: boolean
  defaultQuality?: '720p' | '1080p' | '2160p'
  clientName?: string
  clientEmail?: string | null
  /** 后台入口当前登录账号；批注署名与乐观更新要用，分享入口为 null。 */
  adminUser?: any
  recipients?: Array<{ id: string; name: string | null; email: string | null }>
  allowClientAssetUpload?: boolean
  isPasswordProtected?: boolean
  identity?: {
    name?: string | null
    email?: string | null
    isReviewAuthenticated?: boolean
    onRequireLogin?: () => void
    onIdentityChange?: (identity: { name: string | null; email: string | null } | null) => void
    openSignal?: number
    onOpenChange?: (open: boolean) => void
  }
  actions: {
    onVideoSelect: (videoName: string) => void
    onBackToGrid?: () => void
    onVideoStateChange?: (state: any) => void
    onStreamAuthExpired?: (videoId: string) => Promise<boolean>
    onApprove?: () => void | Promise<void>
    onRefresh?: () => void | Promise<void>
    onShareLink?: () => void | Promise<void>
    shareCopied?: boolean
    onDownloadToken?: (videoId: string) => Promise<string | null>
    onCommentFocus?: (commentId: string) => void
    onToggleComments?: () => void
  }
  hideComments?: boolean
  focusCommentId?: string | null
  restrictCommentsToLatestVersion?: boolean
  smtpConfigured?: boolean
  /** 后台页的下载入口仍在项目信息里，播放器这枚按钮保持隐藏。 */
  hidePlayerDownload?: boolean
  slots?: {
    leadingAction?: ReactNode
    /** 顶栏右侧身份前的补充信息（例如分享链接剩余次数）。 */
    toolbarMeta?: ReactNode
    /** 头像菜单里额外的管理项（例如推送本集）。 */
    menuExtra?: ReactNode
    emptyState?: ReactNode
  }
  initialSeekTime?: number | null
  initialVideoIndex?: number
  followLatestVersion?: boolean
  usePreviewForApprovedPlayback?: boolean
  timestampDisplayMode?: 'TIMECODE' | 'AUTO'
}

function latestByName(videos: any[], name: string) {
  const group = videos.filter((video) => video.name === name)
  return getLatestVideo(group) as any ?? group[0] ?? null
}

export default function ReviewWorkspace(props: ReviewWorkspaceProps) {
  const {
    project, videos, videosByName, thumbnailsByName, activeVideoName, comments,
    capabilities, source, shareToken = null, projectSlug = null, isGuest = false, defaultQuality = '720p',
    clientName = '', clientEmail = null, adminUser = null, recipients = [], allowClientAssetUpload = false,
    isPasswordProtected = false, identity, actions, hideComments = false, slots,
    initialSeekTime, initialVideoIndex, followLatestVersion = true, focusCommentId = null, restrictCommentsToLatestVersion = false, smtpConfigured = false, hidePlayerDownload = false,
    usePreviewForApprovedPlayback = false, timestampDisplayMode,
  } = props
  const tu = useTranslations('videoUi')
  const t = useTranslations('share')

  const playableNames = useMemo(() => Array.from(new Set(videos.map((video) => video.name))), [videos])
  const activeIndex = playableNames.indexOf(activeVideoName)
  const previousVideoName = activeIndex > 0 ? playableNames[activeIndex - 1] : null
  const nextVideoName = activeIndex >= 0 && activeIndex < playableNames.length - 1 ? playableNames[activeIndex + 1] : null
  const selectedVideo = latestByName(videos, activeVideoName)
  const showCommentPanel = !hideComments
  const canCompare = capabilities.canCompareVersions && playableNames.length > 1
  const menuExtra = (
    <>
      {slots?.menuExtra && (
        <>
          {slots.menuExtra}
          <div className="my-1 border-t border-border" />
        </>
      )}
      <LanguageToggle row />
      <ThemeToggle row />
    </>
  )

  return (
    <div data-review-surface data-review-shell className="min-h-screen lg:fixed lg:inset-0 bg-background flex flex-col lg:overflow-hidden">
      <ThumbnailReel
        videosByName={videosByName}
        thumbnailsByName={thumbnailsByName}
        activeVideoName={activeVideoName}
        onVideoSelect={actions.onVideoSelect}
        onBackToGrid={actions.onBackToGrid}
        showBackButton={Boolean(actions.onBackToGrid)}
        showComparisonAction={canCompare}
        showLanguageToggle={false}
        showThemeToggle={false}
        showCommentToggle={Boolean(actions.onToggleComments)}
        isCommentPanelVisible={showCommentPanel}
        onToggleCommentPanel={actions.onToggleComments}
        comments={comments}
        leadingAction={slots?.leadingAction}
        beforeToolbarAction={
          <div className="flex items-center gap-2">
            {capabilities.canManageApproval && (
              <VideoReviewStatusSelect
                projectId={project.id}
                video={selectedVideo}
                onUpdated={actions.onRefresh}
                className="h-8 sm:h-[32px]"
              />
            )}
            {capabilities.canShareLink && actions.onShareLink && (
              <Button type="button" variant="default" size="sm" className="h-8 shrink-0 gap-2 rounded-[8px] px-3 text-[13px] shadow-none sm:h-[32px] sm:px-3" onClick={() => void actions.onShareLink?.()}>
                {actions.shareCopied ? <Check className="mr-1.5 h-4 w-4" /> : <Share2 className="mr-1.5 h-4 w-4" />}
                <span className="hidden sm:inline">{actions.shareCopied ? tu('copied') : tu('share')}</span>
              </Button>
            )}
          </div>
        }
        trailingAction={
          <div className="flex items-center gap-2">
            {slots?.toolbarMeta}
            <ReviewLoginActions
              compact
              menuExtra={menuExtra}
              onIdentityChange={identity?.onIdentityChange}
              openSignal={identity?.openSignal}
              onOpenChange={identity?.onOpenChange}
            />
          </div>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 sm:p-3 lg:flex-row lg:gap-0 lg:p-0">
        {videos.length === 0 ? (
          slots?.emptyState ?? (
            <div className="flex-1 flex items-center justify-center p-4">
              <Card className="bg-card">
                <CardContent className="py-12 text-center">
                  <p className="text-muted-foreground">{t('noVideosReady')}</p>
                </CardContent>
              </Card>
            </div>
          )
        ) : (
          <>
            <div className={`flex min-w-0 flex-col rounded-[8px] bg-[hsl(var(--review-gutter))] lg:h-full lg:min-h-0 lg:flex-1 lg:p-[2px] lg:pb-[2px] ${showCommentPanel ? 'lg:flex-[2] 2xl:flex-[2.5]' : ''}`}>
              <VideoPlayer
                videos={videos}
                projectId={project.id}
                projectStatus={project.status as any}
                defaultQuality={defaultQuality}
                projectTitle={project.title}
                projectDescription={isGuest ? undefined : project.description ?? undefined}
                clientName={clientName}
                isPasswordProtected={isPasswordProtected}
                watermarkEnabled={project.watermarkEnabled}
                activeVideoName={activeVideoName}
                initialSeekTime={initialSeekTime}
                initialVideoIndex={initialVideoIndex}
                followLatestVersion={followLatestVersion}
                isAdmin={capabilities.canSeeInternalComments}
                isGuest={isGuest}
                allowAssetDownload={Boolean(project.allowAssetDownload)}
                clientCanApprove={project.clientCanApprove}
                shareToken={shareToken}
                onStreamAuthExpired={actions.onStreamAuthExpired}
                hideDownloadButton={hidePlayerDownload || !capabilities.canDownloadOriginal}
                onDownloadToken={actions.onDownloadToken}
                onApprove={capabilities.canApprove ? actions.onApprove : undefined}
                authenticatedEmail={identity?.email ?? null}
                authenticatedName={identity?.name ?? null}
                onVideoStateChange={actions.onVideoStateChange}
                hideApprovalAction={capabilities.canManageApproval || !capabilities.canApprove}
                allowComparison={capabilities.canCompareVersions}
                onPreviousVideo={previousVideoName ? () => actions.onVideoSelect(previousVideoName) : undefined}
                onNextVideo={nextVideoName ? () => actions.onVideoSelect(nextVideoName) : undefined}
                hasPreviousVideo={Boolean(previousVideoName)}
                hasNextVideo={Boolean(nextVideoName)}
                comments={showCommentPanel ? comments : []}
                timestampDisplayMode={timestampDisplayMode}
                onCommentFocus={actions.onCommentFocus}
                usePreviewForApprovedPlayback={usePreviewForApprovedPlayback}
                fillContainer={true}
                playerSurfaceClassName="bg-[hsl(var(--review-canvas))]"
                playerSurfaceColor="hsl(var(--review-canvas))"
                controlsSurfaceClassName="bg-card dark:bg-[hsl(var(--review-canvas))]"
                projectInfoClassName="mt-2 lg:order-3 xl:mt-0"
              />
              <div id="review-comment-composer" className="pt-[2px] lg:mt-auto" />
            </div>

            {showCommentPanel && (
              <div className="flex max-h-[calc(100vh-56px)] flex-col overflow-hidden rounded-[8px] bg-card lg:max-h-full lg:w-[360px] lg:flex-none">
                <div aria-hidden="true" className="hidden h-[2px] shrink-0 bg-[hsl(var(--review-gutter))] lg:block" />
                <CommentSection
                  projectId={project.id}
                  projectSlug={projectSlug}
                  comments={comments}
                  focusCommentId={focusCommentId}
                  clientName={clientName}
                  clientEmail={clientEmail ?? undefined}
                  isApproved={project.status === 'APPROVED'}
                  restrictToLatestVersion={restrictCommentsToLatestVersion}
                  videos={videos}
                  isAdminView={source === 'admin'}
                  adminUser={adminUser}
                  smtpConfigured={smtpConfigured}
                  isPasswordProtected={isPasswordProtected}
                  recipients={recipients}
                  shareToken={shareToken}
                  showShortcutsButton={true}
                  sendInsideComposer={true}
                  timestampDisplayMode={timestampDisplayMode}
                  mobileCollapsible={true}
                  initialMobileCollapsed={true}
                  authenticatedEmail={identity?.email ?? null}
                  authenticatedName={identity?.name ?? null}
                  allowClientAssetUpload={allowClientAssetUpload}
                  maxCommentAttachments={project.settings?.maxCommentAttachments ?? 10}
                  onToggleVisibility={actions.onToggleComments}
                  showToggleButton={false}
                  showVisibilitySelector={capabilities.canSetCommentVisibility}
                  isReviewAuthenticated={identity?.isReviewAuthenticated}
                  onRequireLogin={identity?.onRequireLogin}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
