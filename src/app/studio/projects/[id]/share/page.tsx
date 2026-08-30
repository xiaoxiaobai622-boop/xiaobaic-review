'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useSearchParams, useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import VideoPlayer from '@/components/VideoPlayer'
import CommentSection from '@/components/CommentSection'
import ThumbnailGrid from '@/components/ThumbnailGrid'
import ThumbnailReel from '@/components/ThumbnailReel'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import ThemeToggle from '@/components/ThemeToggle'
import LanguageToggle from '@/components/LanguageToggle'
import ReviewLoginActions from '@/components/ReviewLoginActions'
import { useTranslations } from 'next-intl'

interface Video {
  id: string
  name: string
  status: string
  versionLabel: string
  url: string | null
  hlsUrl: string | null
  thumbnailUrl: string | null
  duration: number | null
  fps: number | null
  approved: boolean
  approvedAt: string | null
  uploadedAt: string
  resolution: string | null
  aspectRatio: string | null
  mp4ConversionQueued: boolean
}

interface Project {
  id: string
  title: string
  status: string
  recipients: Array<{ email: string; name: string | null }> | null
  smtpConfigured: boolean
  sharePassword: string | null
  authMode: string | null
  restrictCommentsToLatestVersion: boolean
}

interface User {
  id: string
  name: string | null
  email: string
  role: string
}

export default function SharePage() {
  const t = useTranslations('share')
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const projectId = params?.id as string

  const [project, setProject] = useState<Project | null>(null)
  const [videos, setVideos] = useState<Video[]>([])
  const [adminUser, setAdminUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [hideComments, setHideComments] = useState(false)

  const videoIdFromUrl = searchParams?.get('videoId')
  const focusCommentId = searchParams?.get('commentId') ?? undefined

  const clientDisplayName = searchParams?.get('client') ?? undefined

  const fetchData = useCallback(async () => {
    try {
      const data = await apiFetch(`/api/projects/${projectId}/share-admin`)
      setProject(data.project)
      setVideos(data.videos || [])
      setAdminUser(data.adminUser)
    } catch (err) {
      console.error('Failed to fetch share page data:', err)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (projectId) {
      fetchData()
    }
  }, [projectId, fetchData])

  const readyVideos = videos.filter(v => v.status === 'READY')

  const videosByName = readyVideos.reduce((acc, video) => {
    if (!acc[video.name]) {
      acc[video.name] = []
    }
    acc[video.name].push(video)
    return acc
  }, {} as Record<string, Video[]>)

  const selectedVideoFromUrl = videoIdFromUrl
    ? readyVideos.find(v => v.id === videoIdFromUrl)
    : null

  const firstVideoName = Object.keys(videosByName)[0]
  const firstVideo = videosByName[firstVideoName]?.[0]

  const [selectedVideo, setSelectedVideo] = useState<Video | null>(
    selectedVideoFromUrl || firstVideo || null
  )

  useEffect(() => {
    if (readyVideos.length > 0) {
      if (videoIdFromUrl) {
        const foundVideo = readyVideos.find(v => v.id === videoIdFromUrl)
        if (foundVideo) {
          setSelectedVideo(foundVideo)
        }
      } else if (!selectedVideo && firstVideo) {
        setSelectedVideo(firstVideo)
      }
    }
  }, [videoIdFromUrl, readyVideos, selectedVideo, firstVideo])

  const handleVideoSelect = (video: Video) => {
    setSelectedVideo(video)
    const newParams = new URLSearchParams(searchParams?.toString() || '')
    newParams.set('videoId', video.id)
    newParams.delete('commentId')
    router.push(`${pathname}?${newParams.toString()}`)
  }

  const allVersionsOfSelected = selectedVideo
    ? videosByName[selectedVideo.name] || []
    : []

  const latestVersion = allVersionsOfSelected.length > 0
    ? allVersionsOfSelected.reduce((latest, current) =>
        new Date(current.uploadedAt) > new Date(latest.uploadedAt) ? current : latest
      )
    : null

  const isLatestVersion = selectedVideo?.id === latestVersion?.id

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-lg">{t('loading')}</div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <h2 className="text-xl font-semibold mb-2">{t('projectNotFound')}</h2>
            <p className="text-muted-foreground mb-4">{t('projectNotFoundDescription')}</p>
            <Link href="/studio/projects">
              <Button>
                <ArrowLeft className="w-4 h-4 mr-2" />
                {t('backToProjects')}
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link href={`/studio/projects/${projectId}`}>
              <Button variant="ghost" size="sm">
                <ArrowLeft className="w-4 h-4 mr-2" />
                {t('backToProject')}
              </Button>
            </Link>
            <h1 className="text-xl font-semibold">{project.title}</h1>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageToggle />
            <ReviewLoginActions />
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6">
        {readyVideos.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <p className="text-center text-muted-foreground">{t('noVideosReady')}</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-8 space-y-4">
                {selectedVideo && (
                  <>
                    <VideoPlayer
                      key={selectedVideo.id}
                      videoId={selectedVideo.id}
                      videoUrl={selectedVideo.hlsUrl || selectedVideo.url || ''}
                      thumbnailUrl={selectedVideo.thumbnailUrl}
                      duration={selectedVideo.duration}
                      aspectRatio={selectedVideo.aspectRatio || '16:9'}
                      versionLabel={selectedVideo.versionLabel}
                      approved={selectedVideo.approved}
                      approvedAt={selectedVideo.approvedAt}
                      projectStatus={project.status}
                      isAdminView={true}
                      showApproveButton={false}
                      mp4Url={selectedVideo.url}
                      mp4ConversionQueued={selectedVideo.mp4ConversionQueued}
                      onApprovalChange={fetchData}
                    />

                    {allVersionsOfSelected.length > 1 && (
                      <Card>
                        <CardContent className="pt-4">
                          <h3 className="font-semibold mb-3">{t('allVersions')}</h3>
                          <ThumbnailReel
                            videos={allVersionsOfSelected}
                            selectedVideoId={selectedVideo.id}
                            onVideoSelect={handleVideoSelect}
                            showApprovalBadge={true}
                            showLatestBadge={true}
                          />
                        </CardContent>
                      </Card>
                    )}

                    {!isLatestVersion && project.restrictCommentsToLatestVersion && (
                      <Card className="border-warning bg-warning/5">
                        <CardContent className="pt-4">
                          <p className="text-sm text-warning-foreground">
                            {t('commentsRestrictedToLatest')}
                          </p>
                        </CardContent>
                      </Card>
                    )}
                  </>
                )}
              </div>

              <div className="lg:col-span-4">
                <Card>
                  <CardContent className="pt-4">
                    <h3 className="font-semibold mb-3">{t('allVideos')}</h3>
                    <ThumbnailGrid
                      videos={Object.values(videosByName).map(versions =>
                        versions.reduce((latest, current) =>
                          new Date(current.uploadedAt) > new Date(latest.uploadedAt) ? current : latest
                        )
                      )}
                      selectedVideoId={selectedVideo?.id}
                      onVideoSelect={handleVideoSelect}
                      showApprovalBadge={true}
                    />
                  </CardContent>
                </Card>
              </div>
            </div>

            {selectedVideo && (
              <div className={hideComments ? 'hidden' : ''}>
                <CommentSection
                  projectId={projectId}
                  videoId={selectedVideo.id}
                  videoName={selectedVideo.name}
                  versionLabel={selectedVideo.versionLabel}
                  focusCommentId={focusCommentId}
                  clientName={clientDisplayName}
                  clientEmail={project.recipients?.[0]?.email}
                  isApproved={project.status === 'APPROVED'}
                  restrictToLatestVersion={project.restrictCommentsToLatestVersion}
                  videos={readyVideos}
                  isAdminView={true}
                  smtpConfigured={project.smtpConfigured}
                  isPasswordProtected={!!project.sharePassword}
                  adminUser={adminUser}
                  recipients={project.recipients || []}
                  shareToken={null}
                  showShortcutsButton={true}
                  timestampDisplayMode="AUTO"
                  mobileCollapsible={true}
                  initialMobileCollapsed={true}
                  onToggleVisibility={() => setHideComments(!hideComments)}
                  showToggleButton={false}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
