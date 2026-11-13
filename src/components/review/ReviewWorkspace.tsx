'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, Share2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import ThumbnailReel from '@/components/ThumbnailReel'
import VideoPlayer from '@/components/VideoPlayer'
import CommentSection from '@/components/CommentSection'
import ReviewInfoPanel from '@/components/review/ReviewInfoPanel'
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
  /** 当前入口是否允许出现批注栏（权限/反馈开关）；和用户手动收起区分，收起时保留输入状态。 */
  commentPanelAvailable?: boolean
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

function hasPlaybackUrl(video: any): boolean {
  return Boolean(
    video?.hlsUrl720p || video?.streamUrl720p || video?.streamUrl1080p || video?.streamUrl2160p
  )
}

export default function ReviewWorkspace(props: ReviewWorkspaceProps) {
  const {
    project, videos, videosByName, thumbnailsByName, activeVideoName, comments,
    capabilities, source, shareToken = null, projectSlug = null, isGuest = false, defaultQuality = '720p',
    clientName = '', clientEmail = null, adminUser = null, recipients = [], allowClientAssetUpload = false,
    isPasswordProtected = false, identity, actions, hideComments = false, commentPanelAvailable = true, slots,
    initialSeekTime, initialVideoIndex, followLatestVersion = true, focusCommentId = null, restrictCommentsToLatestVersion = false, smtpConfigured = false, hidePlayerDownload = false,
    usePreviewForApprovedPlayback = false, timestampDisplayMode,
  } = props
  const tu = useTranslations('videoUi')
  const t = useTranslations('share')

  // A catalog refresh can add a same-name version above the one being watched.
  // Pin the version the viewer actually selected/started and keep its already
  // minted URLs while the parent re-tokenizes the new catalog entry. Without
  // this, automaticVideoIndex=0 would silently switch versions (pause + 0).
  const [knownVideos, setKnownVideos] = useState<Map<string, any>>(() => new Map())
  const [pinnedVideoId, setPinnedVideoId] = useState<string | null>(null)
  const stableVideos = useMemo(() => {
    return videos.map((video: any) => {
      if (hasPlaybackUrl(video)) return video
      const previous = knownVideos.get(video.id)
      if (!previous) return video
      return {
        ...video,
        hlsUrl720p: previous.hlsUrl720p || '',
        streamUrl720p: previous.streamUrl720p || '',
        streamUrl1080p: previous.streamUrl1080p || '',
        streamUrl2160p: previous.streamUrl2160p || '',
      }
    })
  }, [videos, knownVideos])
  useEffect(() => {
    setKnownVideos((current) => {
      const next = new Map(current)
      const ids = new Set(videos.map((video: any) => video.id))
      let changed = false
      for (const id of next.keys()) {
        if (!ids.has(id)) {
          next.delete(id)
          changed = true
        }
      }
      for (const video of videos) {
        if (!hasPlaybackUrl(video)) continue
        const previous = next.get(video.id)
        if (
          !previous ||
          previous.hlsUrl720p !== video.hlsUrl720p ||
          previous.streamUrl720p !== video.streamUrl720p ||
          previous.streamUrl1080p !== video.streamUrl1080p ||
          previous.streamUrl2160p !== video.streamUrl2160p
        ) {
          next.set(video.id, video)
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [videos])
  const pinnedVideo = pinnedVideoId
    ? stableVideos.find((video: any) => video.id === pinnedVideoId) ?? null
    : null
  const pinnedIndex = pinnedVideo
    ? stableVideos.findIndex((video: any) => video.id === pinnedVideo.id)
    : -1
  const playerVideoIndex = pinnedIndex >= 0 ? pinnedIndex : (initialVideoIndex ?? 0)
  const onVideoStateChangeAction = actions.onVideoStateChange
  const handleVideoStateChange = useCallback((state: any) => {
    const id = state?.selectedVideo?.id
    if (id) setPinnedVideoId((current) => current === id ? current : id)
    onVideoStateChangeAction?.(state)
  }, [onVideoStateChangeAction])

  const playableNames = useMemo(() => Array.from(new Set(videos.map((video) => video.name))), [videos])
  const activeIndex = playableNames.indexOf(activeVideoName)
  const previousVideoName = activeIndex > 0 ? playableNames[activeIndex - 1] : null
  const nextVideoName = activeIndex >= 0 && activeIndex < playableNames.length - 1 ? playableNames[activeIndex + 1] : null
  const selectedVideo = pinnedVideo ?? latestByName(videos, activeVideoName)
  const showCommentPanel = commentPanelAvailable && !hideComments
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
    <div data-review-surface data-review-shell className="min-h-screen sm:fixed sm:inset-0 bg-background flex flex-col sm:overflow-hidden">
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
        showCommentToggle={commentPanelAvailable && Boolean(actions.onToggleComments)}
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
              />
            )}
            {capabilities.canShareLink && actions.onShareLink && (
              <Button type="button" variant="default" size="sm" className="h-[28px] shrink-0 gap-2 rounded-[8px] px-3 text-[13px] shadow-none sm:px-3" onClick={() => void actions.onShareLink?.()}>
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

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 sm:flex-row sm:gap-0 sm:p-0">
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
            <div className={`flex min-w-0 flex-col rounded-[8px] bg-[hsl(var(--review-gutter))] sm:h-full sm:min-h-0 sm:flex-1 sm:p-[2px] sm:pb-[2px] ${showCommentPanel ? 'sm:flex-[2] 2xl:flex-[2.5]' : ''}`}>
              <VideoPlayer
                videos={stableVideos}
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
                initialVideoIndex={playerVideoIndex}
                followLatestVersion={false}
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
                onVideoStateChange={handleVideoStateChange}
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

            {commentPanelAvailable && (
              <div
                data-comment-panel
                aria-hidden={!showCommentPanel ? true : undefined}
                inert={!showCommentPanel ? true : undefined}
                className={`max-h-[calc(100vh-56px)] overflow-hidden rounded-[8px] bg-card sm:h-full sm:max-h-full sm:flex-none ${
                  showCommentPanel
                    ? 'flex w-full opacity-100 sm:w-[320px] lg:w-[360px]'
                    : 'hidden opacity-0 sm:flex sm:w-0'
                }`}
              >
                <div className="flex h-full w-full min-w-0 flex-col sm:w-[320px] sm:min-w-[320px] lg:w-[360px] lg:min-w-[360px]">
                  <div aria-hidden="true" className="hidden h-[2px] shrink-0 bg-[hsl(var(--review-gutter))] sm:block" />
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
                    showComposer={showCommentPanel}
                    infoContent={(
                      <ReviewInfoPanel
                        video={selectedVideo}
                        projectTitle={project.title}
                        projectDescription={project.description}
                        clientName={clientName}
                        isPasswordProtected={isPasswordProtected}
                        isVideoApproved={Boolean((selectedVideo as any)?.approved)}
                        defaultQuality={defaultQuality}
                        usePreviewForApprovedPlayback={usePreviewForApprovedPlayback}
                      />
                    )}
                    isReviewAuthenticated={identity?.isReviewAuthenticated}
                    onRequireLogin={identity?.onRequireLogin}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
