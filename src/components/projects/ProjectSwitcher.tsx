'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Loader2, Search } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { apiFetch } from '@/lib/api-client'
import { useViewportClamp } from '@/hooks/useViewportClamp'

interface SwitchProject {
  id: string
  title: string
  projectCode?: string | null
}

interface ProjectSwitcherProps {
  currentProjectId: string
  currentTitle: string
}

export default function ProjectSwitcher({ currentProjectId, currentTitle }: ProjectSwitcherProps) {
  const t = useTranslations('videoUi')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [projects, setProjects] = useState<SwitchProject[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const loadedRef = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useViewportClamp(popupRef, open)

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 20)
    return () => window.clearTimeout(focusTimer)
  }, [open])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  useEffect(() => {
    if (!open || loadedRef.current) return
    loadedRef.current = true
    setLoading(true)
    setError(false)
    apiFetch('/api/projects')
      .then(async (response) => {
        if (!response.ok) throw new Error('failed')
        const data = await response.json()
        const list = Array.isArray(data.projects) ? data.projects : Array.isArray(data) ? data : []
        setProjects(list.map((project: any) => ({
          id: project.id,
          title: project.title || project.name || project.projectCode || project.id,
          projectCode: project.projectCode,
        })))
      })
      .catch(() => {
        loadedRef.current = false
        setError(true)
      })
      .finally(() => setLoading(false))
  }, [open])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return projects
    return projects.filter((project) =>
      project.title.toLowerCase().includes(q) ||
      (project.projectCode || '').toLowerCase().includes(q)
    )
  }, [projects, query])

  const choose = (project: SwitchProject) => {
    setOpen(false)
    setQuery('')
    if (project.id !== currentProjectId) router.push(`/studio/projects/${project.id}`)
  }

  return (
    <div className="relative min-w-0" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-sm font-semibold text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t('switchProject')}
      >
        <span className="max-w-[14rem] truncate">{currentTitle}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div
          ref={popupRef}
          role="dialog"
          aria-label={t('switchProject')}
          className="absolute left-0 top-full z-50 mt-1 w-[320px] max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-elevation-lg"
        >
          <div className="border-b border-border/70 p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('searchProjects')}
                className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-10 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span className="pointer-events-none absolute right-2.5 top-2 text-[10px] text-muted-foreground">⌘K</span>
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            {loading ? (
              <p className="flex items-center gap-2 px-2 py-3 text-[12px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />{t('searchProjects')}
              </p>
            ) : error ? (
              <div className="px-2 py-3">
                <p className="text-[12px] text-destructive">{t('loadFailed')}</p>
                <button
                  type="button"
                  onClick={() => { loadedRef.current = false; setOpen(false); window.setTimeout(() => setOpen(true), 0) }}
                  className="mt-2 text-[12px] text-primary hover:underline"
                >
                  {t('retry')}
                </button>
              </div>
            ) : visible.length === 0 ? (
              <p className="px-2 py-3 text-[12px] text-muted-foreground">{t('noMatchingAssets')}</p>
            ) : (
              visible.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => choose(project)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-[12.5px] hover:bg-accent ${
                    project.id === currentProjectId ? 'font-semibold text-foreground' : 'text-foreground'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{project.title}</span>
                  {project.projectCode && (
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{project.projectCode}</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
