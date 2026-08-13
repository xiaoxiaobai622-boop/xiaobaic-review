'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { useSearchParams, usePathname, useRouter } from 'next/navigation'
import VideoPlayer from '@/components/VideoPlayer'
import CommentSection from '@/components/CommentSection'
import ThumbnailGrid from '@/components/ThumbnailGrid'
import ThumbnailReel from '@/components/ThumbnailReel'
import { OTPInput } from '@/components/OTPInput'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Button } from '@/components/ui/button'
import { Lock, Check, Mail, KeyRound } from 'lucide-react'
import BrandLogo from '@/components/BrandLogo'
import { loadShareToken, saveShareToken } from '@/lib/share-token-store'
import { loadPortalSession } from '@/app/portal/portalSession'
import ThemeToggle from '@/components/ThemeToggle'
import LanguageToggle from '@/components/LanguageToggle'
import PrivacyBanner, { PRIVACY_STORAGE_KEY } from '@/components/PrivacyBanner'
import ReverseShareUploadPanel from '@/components/ReverseShareUploadPanel'
import SharePhotoSection from '@/components/SharePhotoSection'
import ShareViewToggle, { loadShareViewMode, type ShareViewMode } from '@/components/ShareViewToggle'
import ReviewLoginActions from '@/components/ReviewLoginActions'

interface SharePageClientProps {
  token: string
}

export default function SharePageClient({ token }: SharePageClientProps) {
  const t = useTranslations('share')
  const tc = useTranslations('common')
  const searchParams = useSearchParams()
  const collectionMode = searchParams?.get('mode') === 'collect'
  const pathname = usePathname()
  const router = useRouter()

  const urlTimestamp = searchParams?.get('t') ? parseFloat(searchParams.get('t')!) : null
  const urlVideoName = searchParams?.get('video') || null
  const urlVersion = searchParams?.get('version') ? parseInt(searchParams.get('version')!, 10) : null
  const urlFocusCommentId = searchParams?.get('comment') || null

  const [focusCommentId, setFocusCommentId] = useState<string | null>(urlFocusCommentId)
  const [isPasswordProtected, setIsPasswordProtected] = useState<boolean | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isGuest, setIsGuest] = useState(false)
  const [authMode, setAuthMode] = useState<string>('PASSWORD')
  const [guestMode, setGuestMode] = useState(false)
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [authenticatedEmail, setAuthenticatedEmail] = useState<string | null>(null) // Track OTP-authenticated email
  const [authenticatedName, setAuthenticatedName] = useState<string | null>(null) // Track OTP-authenticated name
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sendingOtp, setSendingOtp] = useState(false)
  const [error, setError] = useState('')
  const [project, setProject] = useState<any>(null)
  const [comments, setComments] = useState<any[]>([])
  const [_commentsLoading, setCommentsLoading] = useState(false)
  const [_companyName, setCompanyName] = useState('Studio')
  const [defaultQuality, setDefaultQuality] = useState<'720p' | '1080p' | '2160p'>('720p')
  const [activeVideoName, setActiveVideoName] = useState<string>('')
  const [activeVideos, setActiveVideos] = useState<any[]>([])
  const [activeVideosRaw, setActiveVideosRaw] = useState<any[]>([])
  const [tokensLoading, setTokensLoading] = useState(false)
  const [initialSeekTime, setInitialSeekTime] = useState<number | null>(null)
  const [initialVideoIndex, setInitialVideoIndex] = useState<number>(0)
  const [shareToken, setShareToken] = useState<string | null>(null)
  const [hideComments, setHideComments] = useState(false)
  const [viewState, setViewState] = useState<'grid' | 'player'>('grid')
  const [thumbnailsByName, setThumbnailsByName] = useState<Map<string, string>>(new Map())
  const [thumbnailsLoading, setThumbnailsLoading] = useState(true)
  const [viewMode, setViewMode] = useState<ShareViewMode>('grid')
  const [albumCount, setAlbumCount] = useState(0)
  const [reviewAuthenticated, setReviewAuthenticated] = useState(false)
  const [loginOpenSignal, setLoginOpenSignal] = useState(0)

  const handleWechatIdentity = useCallback((identity: { name: string | null } | null) => {
    setReviewAuthenticated(Boolean(identity))
    if (identity?.name) setAuthenticatedName(identity.name)
  }, [])

  const requireReviewLogin = useCallback(() => {
    setLoginOpenSignal((value) => value + 1)
  }, [])

  useEffect(() => { setViewMode(loadShareViewMode()) }, [])
  const storageKey = token || ''
  const tokenCacheRef = useRef<Map<string, any>>(new Map())
  const inFlightTokenRequestsRef = useRef<Map<string, Promise<string>>>(new Map())

  /** Read GDPR analytics consent from localStorage */
  const getConsentHeader = (): Record<string, string> => {
    try {
      const stored = localStorage.getItem(PRIVACY_STORAGE_KEY)
      if (stored === 'true') return { 'X-Analytics-Consent': 'true' }
      if (stored === 'declined') return { 'X-Analytics-Consent': 'false' }
    } catch { /* ignore */ }
    return {}
  }

  useEffect(() => {
    if (!storageKey) return
    const stored = loadShareToken(storageKey)
    if (stored) {
      setShareToken(stored)
    }
  }, [storageKey])

  // Server extracts recipientId from token - client never decodes token
  useEffect(() => {
    if (!project?.authenticatedRecipientId || !project?.recipients?.length) return
    const recipient = project.recipients.find((r: any) => r.id === project.authenticatedRecipientId)
    if (recipient?.email) {
      if (!authenticatedEmail) setAuthenticatedEmail(recipient.email)
      if (!authenticatedName && recipient.name) setAuthenticatedName(recipient.name)
    }
  }, [project?.authenticatedRecipientId, project?.recipients, authenticatedEmail, authenticatedName])

  useEffect(() => {
    if (!authenticatedEmail || authenticatedName || !project?.recipients?.length) return
    const recipient = project.recipients.find(
      (r: any) => r.email?.toLowerCase() === authenticatedEmail.toLowerCase()
    )
    if (recipient?.name) setAuthenticatedName(recipient.name)
  }, [authenticatedEmail, authenticatedName, project?.recipients])

  const fetchComments = useCallback(async () => {
    if (!token || !shareToken) return

    setCommentsLoading(true)
    try {
      const response = await fetch(`/api/share/${token}/comments`, {
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${shareToken}`
        }
      })
      if (response.ok) {
        const commentsData = await response.json()
        setComments(commentsData)
      }
    } catch (error) {
    } finally {
      setCommentsLoading(false)
    }
  }, [token, shareToken])

  useEffect(() => {
    const handleCommentPosted = (e: CustomEvent) => {
      if (e.detail?.comments) {
        setComments(e.detail.comments)
      } else {
        fetchComments()
      }
    }

    const handleCommentDeleted = () => {
      fetchComments()
    }

    window.addEventListener('commentPosted', handleCommentPosted as EventListener)
    window.addEventListener('commentDeleted', handleCommentDeleted)

    return () => {
      window.removeEventListener('commentPosted', handleCommentPosted as EventListener)
      window.removeEventListener('commentDeleted', handleCommentDeleted)
    }
  }, [fetchComments])

  // Keep comments and timeline markers current when multiple reviewers are
  // working in separate browsers.
  useEffect(() => {
    if (!shareToken || !project || project.hideFeedback || isGuest) return
    const interval = window.setInterval(() => {
      void fetchComments()
    }, 5000)
    return () => window.clearInterval(interval)
  }, [fetchComments, isGuest, project, shareToken])

  const fetchProjectData = async (tokenOverride?: string | null) => {
    try {
      const authToken = tokenOverride || shareToken
      const projectResponse = await fetch(`/api/share/${token}`, {
        cache: 'no-store',
        headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), ...getConsentHeader() }
      })

      // Recover from stale/expired stored share token
      if (projectResponse.status === 401 && authToken) {
        saveShareToken(storageKey, null)
        setShareToken(null)
        return
      }

      if (projectResponse.ok) {
        const projectData = await projectResponse.json()

        if (projectData.shareToken) {
          setShareToken(projectData.shareToken)
          saveShareToken(storageKey, projectData.shareToken)
        } else if (tokenOverride) {
          setShareToken(tokenOverride)
          saveShareToken(storageKey, tokenOverride)
        }
        setProject(projectData)

        tokenCacheRef.current.clear()

        if (!projectData.hideFeedback) {
          fetchComments()
        }
      }
    } catch (error) {
    }
  }

  // Company name and default quality loaded from project settings

  useEffect(() => {
    let isMounted = true

    async function loadProject() {
      try {
        const response = await fetch(`/api/share/${token}`, {
          cache: 'no-store',
          headers: { ...(shareToken ? { Authorization: `Bearer ${shareToken}` } : {}), ...getConsentHeader() }
        })

        if (!isMounted) return

        if (response.status === 401) {
          saveShareToken(storageKey, null)

          if (shareToken) {
            setShareToken(null)
            return
          }

          const data = await response.json()

          // Portal-issued session: exchange for a project-scoped share token.
          // Server re-checks recipient membership — the JWT alone is not authoritative.
          const portalToken = loadPortalSession()
          if (portalToken) {
            try {
              const claimResponse = await fetch(`/api/share/${token}/portal-claim`, {
                method: 'POST',
                cache: 'no-store',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${portalToken}`,
                  ...getConsentHeader(),
                },
              })
              if (claimResponse.ok) {
                const claimData = await claimResponse.json()
                if (claimData.shareToken) {
                  setShareToken(claimData.shareToken)
                  saveShareToken(storageKey, claimData.shareToken)
                  setIsAuthenticated(true)
                  setIsGuest(false)
                  return
                }
              }
            } catch {
              // fall through to normal auth gate
            }
          }

          if (data.authMode === 'NONE' && data.guestMode) {
            try {
              const guestResponse = await fetch(`/api/share/${token}/guest`, {
                method: 'POST',
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json', ...getConsentHeader() },
              })
              if (guestResponse.ok) {
                const guestData = await guestResponse.json()
                if (guestData.shareToken) {
                  // Setting the token re-runs this effect (shareToken is in deps).
                  // Don't recurse here — the closure's shareToken is stale (null)
                  // and a recursive call would re-trigger the same 401 → guest path.
                  setShareToken(guestData.shareToken)
                  saveShareToken(storageKey, guestData.shareToken)
                  setIsGuest(true)
                  setIsAuthenticated(true)
                  return
                }
              }
            } catch {
              // fall through
            }
          }

          setIsPasswordProtected(true)
          setIsAuthenticated(false)
          setAuthMode(data.authMode || 'PASSWORD')
          setGuestMode(data.guestMode || false)
          return
        }

        if (response.status === 403 || response.status === 404) {
          return
        }

        if (response.ok) {
          const projectData = await response.json()
          if (projectData.shareToken) {
            setShareToken(projectData.shareToken)
            saveShareToken(storageKey, projectData.shareToken)
          }
          if (isMounted) {
            setProject(projectData)
            setIsPasswordProtected(!!projectData.recipients && projectData.recipients.length > 0)
            setIsAuthenticated(true)
            setIsGuest(projectData.isGuest || false)

            if (projectData.settings) {
              setCompanyName(projectData.settings.companyName || 'Studio')
              setDefaultQuality(projectData.previewResolution || projectData.settings.defaultPreviewResolution || '720p')
            }

            if (!projectData.hideFeedback) {
              fetchComments()
            }
          }
        }
      } catch (error) {
      }
    }

    loadProject()

    return () => {
      isMounted = false
    }
  }, [token, shareToken, storageKey, fetchComments])

  useEffect(() => {
    if (project?.videosByName) {
      const videoNames = Object.keys(project.videosByName)
      if (videoNames.length === 0) return

      if (!activeVideoName) {
        let videoNameToUse: string | null = null

        if (urlVideoName && project.videosByName[urlVideoName]) {
          videoNameToUse = urlVideoName
        }
        else {
          const savedVideoName = sessionStorage.getItem('approvedVideoName')
          if (savedVideoName) {
            sessionStorage.removeItem('approvedVideoName')
            if (project.videosByName[savedVideoName]) {
              videoNameToUse = savedVideoName
            }
          }
        }

        if (!videoNameToUse) {
          videoNameToUse = videoNames[0]
        }

        setActiveVideoName(videoNameToUse)

        const videos = project.videosByName[videoNameToUse]
        setActiveVideosRaw(videos)

        // If URL specifies a version, calculate the index
        if (urlVersion !== null && videos) {
          const targetIndex = videos.findIndex((v: any) => v.version === urlVersion)
          if (targetIndex !== -1) {
            setInitialVideoIndex(targetIndex)
          }
        }

        if (urlTimestamp !== null) {
          setInitialSeekTime(urlTimestamp)
        }
      } else {
        const videos = project.videosByName[activeVideoName]
        if (videos) {
          setActiveVideosRaw(videos)
        }
      }
    }
  }, [project?.videosByName, activeVideoName, urlVideoName, urlVersion, urlTimestamp])

  // De-dupes concurrent identical token requests (the thumbnail grid and active-video effects overlap).
  const fetchVideoToken = useCallback(async (videoId: string, quality: string): Promise<string> => {
    if (!shareToken) return ''

    const requestKey = `${shareToken}:${videoId}:${quality}`
    const inFlight = inFlightTokenRequestsRef.current.get(requestKey)
    if (inFlight) return inFlight

    const requestPromise = (async () => {
      const response = await fetch(`/api/share/${token}/video-token?videoId=${videoId}&quality=${quality}`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${shareToken}` },
      })
      if (!response.ok) return ''
      const data = await response.json()
      return data.token || ''
    })().finally(() => {
      inFlightTokenRequestsRef.current.delete(requestKey)
    })

    inFlightTokenRequestsRef.current.set(requestKey, requestPromise)
    return requestPromise
  }, [shareToken, token])

  const fetchTokensForVideos = useCallback(async (videos: any[]) => {
    if (!shareToken) return videos

    return Promise.all(
      videos.map(async (video: any) => {
        const cacheKey = `${shareToken}:${video.id}`
        const cached = tokenCacheRef.current.get(cacheKey)
        if (cached) {
          return cached
        }

        try {
          let streamToken720p = ''
          let streamToken1080p = ''
          let streamToken2160p = ''
          let downloadToken = null

          if (video.approved) {
              const [token720, token1080, token2160, originalToken] = await Promise.all([
                fetchVideoToken(video.id, '720p'),
                fetchVideoToken(video.id, '1080p'),
                fetchVideoToken(video.id, '2160p'),
                fetchVideoToken(video.id, 'original'),
              ])
              streamToken720p = token720
              streamToken1080p = token1080
              streamToken2160p = token2160
              downloadToken = originalToken
          } else {
            const [token720, token1080, token2160] = await Promise.all([
              fetchVideoToken(video.id, '720p'),
              fetchVideoToken(video.id, '1080p'),
              fetchVideoToken(video.id, '2160p'),
            ])
            streamToken720p = token720
            streamToken1080p = token1080
            streamToken2160p = token2160
          }

          let thumbnailUrl = null
          if (video.thumbnailPath) {
            const thumbToken = await fetchVideoToken(video.id, 'thumbnail')
            if (thumbToken) {
              thumbnailUrl = `/api/content/${thumbToken}`
            }
          }

          const tokenized = {
            ...video,
            streamUrl720p: streamToken720p ? `/api/content/${streamToken720p}` : '',
            streamUrl1080p: streamToken1080p ? `/api/content/${streamToken1080p}` : '',
            streamUrl2160p: streamToken2160p ? `/api/content/${streamToken2160p}` : '',
            downloadUrl: downloadToken ? `/api/content/${downloadToken}?download=true` : null,
            thumbnailUrl,
          }

          // Only cache successful tokenization results.
          // Avoid caching empty URLs from transient failures on first load.
          if (tokenized.streamUrl720p || tokenized.streamUrl1080p || tokenized.streamUrl2160p || tokenized.downloadUrl || tokenized.thumbnailUrl) {
            tokenCacheRef.current.set(cacheKey, tokenized)
          }
          return tokenized
        } catch (error) {
          return video
        }
      })
    )
  }, [shareToken, fetchVideoToken])

  useEffect(() => {
    let isMounted = true

    async function loadTokens() {
      if (!activeVideosRaw || activeVideosRaw.length === 0) {
        setTokensLoading(false)
        return
      }
      if (!shareToken) {
        setTokensLoading(true)
        return
      }
      setTokensLoading(true)
      const tokenized = await fetchTokensForVideos(activeVideosRaw)
      if (isMounted) {
        setActiveVideos(tokenized)
      }
      setTokensLoading(false)
    }

    loadTokens()

    return () => {
      isMounted = false
    }
  }, [activeVideosRaw, shareToken, fetchTokensForVideos])

  useEffect(() => {
    let isMounted = true

    async function fetchThumbnails() {
      if (!project?.videosByName || !shareToken) {
        return
      }

      setThumbnailsLoading(true)
      const newThumbnails = new Map<string, string>()

      try {
        await Promise.all(
          Object.entries(project.videosByName as Record<string, any[]>).map(async ([name, videos]) => {
            // Find a video with a thumbnail
            const videoWithThumb = videos.find((v: any) => v.thumbnailPath)
            if (videoWithThumb) {
              const thumbToken = await fetchVideoToken(videoWithThumb.id, 'thumbnail')
              if (thumbToken && isMounted) {
                newThumbnails.set(name, `/api/content/${thumbToken}`)
              }
            }
          })
        )

        if (isMounted) {
          setThumbnailsByName(newThumbnails)
        }
      } catch (error) {
        // Failed to load thumbnails
      } finally {
        if (isMounted) {
          setThumbnailsLoading(false)
        }
      }
    }

    fetchThumbnails()

    return () => {
      isMounted = false
    }
  }, [project?.videosByName, shareToken, fetchVideoToken])

  useEffect(() => {
    if (!project?.videosByName) return

    if (urlVideoName && project.videosByName[urlVideoName]) {
      setViewState('player')
      return
    }

    setViewState('grid')
  }, [project?.videosByName, urlVideoName])

  const handleVideoSelect = useCallback((videoName: string) => {
    setActiveVideoName(videoName)
    setActiveVideosRaw(project.videosByName[videoName])
    setViewState('player')

    const params = new URLSearchParams(searchParams?.toString() || '')
    params.set('video', videoName)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [project?.videosByName, searchParams, pathname, router])

  const handleBackToGrid = useCallback(() => {
    setViewState('grid')

    const params = new URLSearchParams(searchParams?.toString() || '')
    params.delete('video')
    const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname
    router.replace(newUrl || '', { scroll: false })
  }, [searchParams, pathname, router])

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault()
    if (!email) return

    setSendingOtp(true)
    setError('')

    try {
      const response = await fetch(`/api/share/${token}/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      const data = await response.json()

      if (response.ok) {
        setOtpSent(true)
        setError('')
      } else {
        setError(data.error || t('failedToSendCode'))
      }
    } catch (error) {
      setError(tc('errorTryAgain'))
    } finally {
      setSendingOtp(false)
    }
  }

  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email || !otp) return

    setLoading(true)
    setError('')

    try {
      const response = await fetch(`/api/share/${token}/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getConsentHeader() },
        body: JSON.stringify({ email, code: otp }),
      })

      if (response.ok) {
        const data = await response.json()
        if (data.shareToken) {
          setShareToken(data.shareToken)
          saveShareToken(storageKey, data.shareToken)
        }
        setIsAuthenticated(true)
        setIsGuest(false)
        setAuthenticatedEmail(email)
      } else {
        // Generic error to prevent email enumeration
        setError(t('invalidCode'))
      }
    } catch (error) {
      setError(tc('errorTryAgain'))
    } finally {
      setLoading(false)
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const response = await fetch(`/api/share/${token}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getConsentHeader() },
        body: JSON.stringify({ password }),
      })

      if (response.ok) {
        const data = await response.json()
        if (data.shareToken) {
          setShareToken(data.shareToken)
          saveShareToken(storageKey, data.shareToken)
        }
        setIsAuthenticated(true)
        setIsGuest(false)
      } else {
        setError(t('incorrectPassword'))
      }
    } catch (error) {
      setError(tc('error'))
    } finally {
      setLoading(false)
    }
  }

  async function handleGuestEntry() {
    setLoading(true)
    setError('')

    try {
      const response = await fetch(`/api/share/${token}/guest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getConsentHeader() },
      })

      if (response.ok) {
        const data = await response.json()
        if (data.shareToken) {
          setShareToken(data.shareToken)
          saveShareToken(storageKey, data.shareToken)
        }
        setIsAuthenticated(true)
        setIsGuest(true)
      } else {
        setError(t('unableToAccessGuest'))
      }
    } catch (error) {
      setError(tc('error'))
    } finally {
      setLoading(false)
    }
  }

  if (isPasswordProtected === null) {
    return (
      <div className="flex-1 min-h-0 bg-background flex items-center justify-center">
        <p className="text-muted-foreground">{tc('loading')}</p>
      </div>
    )
  }

  if (isPasswordProtected && !isAuthenticated) {
    return (
      <div className="flex-1 min-h-0 bg-background flex items-center justify-center p-4">
        <div className="fixed top-3 right-3 z-20 flex items-center gap-2">
          <LanguageToggle />
          <ThemeToggle />
        </div>
        <div className="w-full max-w-md flex flex-col items-center gap-4">
          <BrandLogo height={64} className="mx-auto" />
          <Card className="bg-card border-border w-full">
            <CardHeader className="text-center space-y-3">
              <div className="flex justify-center">
                <Lock className="w-12 h-12 text-muted-foreground" />
              </div>
              <CardTitle className="text-foreground">{t('authRequired')}</CardTitle>
              <p className="text-muted-foreground text-sm mt-2">
                {authMode === 'PASSWORD' && t('passwordPrompt')}
                {authMode === 'OTP' && t('otpPrompt')}
                {authMode === 'BOTH' && t('bothPrompt')}
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              {(authMode === 'PASSWORD' || authMode === 'BOTH') && !otpSent && (
                <div className="space-y-4">
                  {authMode === 'BOTH' && (
                    <div className="flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-muted-foreground" />
                    <p className="text-sm font-medium text-foreground">{t('password')}</p>
                  </div>
                )}
                <form onSubmit={handlePasswordSubmit} className="space-y-4">
                  <PasswordInput
                    placeholder={t('enterPassword')}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoFocus={authMode === 'PASSWORD'}
                  />
                  <Button
                    type="submit"
                    variant="default"
                    size="default"
                    disabled={loading || !password}
                    className="w-full"
                  >
                    <Check className="w-4 h-4 mr-2" />
                    {loading ? t('verifying') : tc('submit')}
                  </Button>
                </form>
              </div>
            )}

            {authMode === 'BOTH' && !otpSent && (
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border"></div>
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">{tc('or')}</span>
                </div>
              </div>
            )}

            {(authMode === 'OTP' || authMode === 'BOTH') && (
              <div className="space-y-4">
                {authMode === 'BOTH' && (
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-muted-foreground" />
                    <p className="text-sm font-medium text-foreground">{t('emailVerification')}</p>
                  </div>
                )}
                {!otpSent ? (
                  <form onSubmit={handleSendOtp} className="space-y-4">
                    <Input
                      type="email"
                      placeholder={t('enterEmail')}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoFocus={authMode === 'OTP'}
                      required
                    />
                    <Button
                      type="submit"
                      variant="default"
                      size="default"
                      disabled={sendingOtp || !email}
                      className="w-full"
                    >
                      <Mail className="w-4 h-4 mr-2" />
                      {sendingOtp ? t('sendingCode') : t('sendCode')}
                    </Button>
                  </form>
                ) : (
                  <form onSubmit={handleOtpSubmit} className="space-y-4">
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground text-center">
                        {t('codePrompt', { email })}
                      </p>
                      <OTPInput
                        value={otp}
                        onChange={setOtp}
                        disabled={loading}
                        autoFocus
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="default"
                        onClick={() => {
                          setOtpSent(false)
                          setOtp('')
                          setError('')
                        }}
                        className="flex-1"
                      >
                        {tc('back')}
                      </Button>
                      <Button
                        type="submit"
                        variant="default"
                        size="default"
                        disabled={loading || otp.length !== 6}
                        className="flex-1"
                      >
                        <Check className="w-4 h-4 mr-2" />
                        {loading ? t('verifying') : t('verify')}
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {error && (
              <div className="p-3 bg-destructive-visible border border-destructive-visible rounded-lg">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            {guestMode && !otpSent && (
              <>
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-border"></div>
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">{t('notRecipient')}</span>
                  </div>
                </div>
                <Button
                  type="button"
                  size="default"
                  onClick={handleGuestEntry}
                  disabled={loading}
                  className="w-full bg-warning text-warning-foreground hover:bg-warning/90 shadow-elevation hover:shadow-elevation-lg hover:-translate-y-0.5 active:translate-y-0 active:shadow-elevation transition-all duration-200"
                >
                  {t('continueAsGuest')}
                </Button>
              </>
            )}
            <div className="border-t border-border pt-4">
              <ReviewLoginActions onIdentityChange={handleWechatIdentity} openSignal={loginOpenSignal} />
            </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex-1 min-h-0 bg-background flex items-center justify-center p-4">
        <Card className="bg-card border-border">
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">{t('projectNotFound')}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (collectionMode && !isGuest && project.allowReverseShare && shareToken) {
    return (
      <ReverseShareUploadPanel
        shareToken={shareToken}
        shareSlug={token}
        projectName={project.title}
        maxFiles={project.settings?.maxReverseShareFiles ?? 10}
        variant="embedded"
      />
    )
  }

  // Filter to READY videos first
  let readyVideos = activeVideos.filter((v: any) => v.status === 'READY')

  const activeVideoIds = new Set(activeVideos.map((v: any) => v.id))
  const filteredComments = comments.filter((comment: any) => {
    return !comment.videoId || activeVideoIds.has(comment.videoId)
  })
  const displayClientName = project.clientName?.trim().toLowerCase() === 'client'
    ? t('clientFallback')
    : project.clientName

  if (viewState === 'grid') {
    return (
      <>
      <div className="fixed inset-0 bg-background flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-background/95 backdrop-blur-sm z-20 flex-shrink-0">
          <div className="flex items-center gap-2" data-tutorial="grid-actions" />

          <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2">
            {!isGuest && project.allowReverseShare && shareToken && (
              <ReverseShareUploadPanel
                shareToken={shareToken}
                shareSlug={token}
                projectName={project.title}
                maxFiles={project.settings?.maxReverseShareFiles ?? 10}
                triggerLabel={t('uploadLink')}
              />
            )}
            <ReviewLoginActions onIdentityChange={handleWechatIdentity} compact openSignal={loginOpenSignal} />
            <ShareViewToggle viewMode={viewMode} onChange={setViewMode} />
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="w-full px-3 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
            {(() => {
              return (
                <ThumbnailGrid
                  videosByName={project.videosByName}
                  thumbnailsByName={thumbnailsByName}
                  thumbnailsLoading={thumbnailsLoading}
                  onVideoSelect={handleVideoSelect}
                  projectTitle={project.title}
                  projectDescription={isGuest ? undefined : project.description}
                  allowAssetDownload={project.allowAssetDownload}
                  viewMode={viewMode}
                  albumCount={albumCount}
                  comments={comments}
                />
              )
            })()}
            {project.hasPhotos && project.id && shareToken && (
              <SharePhotoSection
                projectId={project.id}
                shareToken={shareToken}
                allowPhotoDownload={project.allowPhotoDownload && !isGuest}
                viewMode={viewMode}
                onAlbumCount={setAlbumCount}
              />
            )}
          </div>
          <div className="pb-4 text-center">
            <a
              href="https://www.vitransfer.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
            >
              {tc('poweredBy')}
            </a>
          </div>
        </div>
      </div>

      {/* Privacy Disclosure Banner */}
      {project.settings?.privacyDisclosureEnabled && (
        <PrivacyBanner customText={project.settings.privacyDisclosureText} slug={token} shareToken={shareToken} />
      )}
      </>
    )
  }

  // Whether to show comment panel
  const showCommentPanel = !project.hideFeedback && !isGuest

  return (
    <div className="flex min-h-screen flex-col bg-background lg:fixed lg:inset-0 lg:overflow-hidden">
      {/* Thumbnail Reel */}
        <ThumbnailReel
          videosByName={project.videosByName}
          thumbnailsByName={thumbnailsByName}
          activeVideoName={activeVideoName}
          onVideoSelect={handleVideoSelect}
          onBackToGrid={handleBackToGrid}
          showBackButton={true}
          showCommentToggle={!project.hideFeedback && !isGuest}
          isCommentPanelVisible={!hideComments}
          onToggleCommentPanel={() => setHideComments(!hideComments)}
          comments={comments}
          trailingAction={
            <div className="flex items-center gap-1">
              <ReviewLoginActions onIdentityChange={handleWechatIdentity} compact openSignal={loginOpenSignal} />
            </div>
          }
        />

      {/* Main Content Area */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 sm:p-3 lg:flex-row lg:gap-0 lg:p-0">
        {readyVideos.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-4">
            <Card className="bg-card border-border">
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">
                  {tokensLoading ? t('loadingVideo') : t('noVideosReady')}
                </p>
              </CardContent>
            </Card>
          </div>
        ) : (
          <>
            {/* Video Player */}
            <div data-tutorial="video-player" className={`flex min-w-0 flex-col bg-muted/30 lg:h-full lg:min-h-0 lg:flex-1 lg:p-3 ${showCommentPanel ? 'lg:flex-[2] 2xl:flex-[2.5]' : ''}`}>
              <VideoPlayer
                videos={readyVideos}
                projectId={project.id}
                projectStatus={project.status}
                defaultQuality={defaultQuality}
                projectTitle={project.title}
                projectDescription={isGuest ? null : project.description}
                clientName={isGuest ? null : displayClientName}
                isPasswordProtected={isPasswordProtected || false}
                watermarkEnabled={project.watermarkEnabled}
                activeVideoName={activeVideoName}
                onApprove={isGuest ? undefined : fetchProjectData}
                authenticatedEmail={authenticatedEmail}
                authenticatedName={authenticatedName}
                initialSeekTime={initialSeekTime}
                initialVideoIndex={initialVideoIndex}
                isAdmin={false}
                isGuest={isGuest}
                allowAssetDownload={project.allowAssetDownload}
                clientCanApprove={project.clientCanApprove}
                shareToken={shareToken}
                comments={!project.hideFeedback && !isGuest ? filteredComments : []}
                timestampDisplayMode="AUTO"
                onCommentFocus={(commentId) => setFocusCommentId(commentId)}
                usePreviewForApprovedPlayback={project.usePreviewForApprovedPlayback}
                fillContainer={true}
              />
              <div id="review-comment-composer" className="lg:mt-auto" />
            </div>

            {showCommentPanel && (
              <div data-tutorial="comments" className="flex max-h-[calc(100vh-56px)] flex-col overflow-hidden bg-card lg:max-h-full lg:w-[360px] lg:flex-none lg:border-l lg:border-border/70">
                <CommentSection
                  projectId={project.id}
                  projectSlug={token}
                  comments={filteredComments}
                  focusCommentId={focusCommentId}
                  clientName={displayClientName}
                  clientEmail={project.clientEmail}
                  isApproved={project.status === 'APPROVED'}
                  restrictToLatestVersion={project.restrictCommentsToLatestVersion}
                  videos={readyVideos}
                  isAdminView={false}
                  smtpConfigured={project.smtpConfigured}
                  isPasswordProtected={isPasswordProtected || false}
                  recipients={project.recipients || []}
                  shareToken={shareToken}
                  showShortcutsButton={true}
                  timestampDisplayMode="AUTO"
                  mobileCollapsible={true}
                  initialMobileCollapsed={true}
                  authenticatedEmail={authenticatedEmail}
                  authenticatedName={authenticatedName}
                  allowClientAssetUpload={project.allowClientAssetUpload || false}
                  maxCommentAttachments={project.settings?.maxCommentAttachments ?? 10}
                  onToggleVisibility={() => setHideComments(!hideComments)}
                  showToggleButton={false}
                  isReviewAuthenticated={reviewAuthenticated}
                  onRequireLogin={requireReviewLogin}
                />
              </div>
            )}
          </>
        )}
      </div>

      {project.settings?.privacyDisclosureEnabled && (
        <PrivacyBanner customText={project.settings.privacyDisclosureText} slug={token} shareToken={shareToken} />
      )}
    </div>
  )
}
