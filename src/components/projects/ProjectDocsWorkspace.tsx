'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, FileText, Loader2, Plus, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api-client'

const DOCS_API = 'https://office.vidx.cn/docs-api'

interface ProjectDoc {
  id: string
  name: string
  ext: string
  size: number
  updatedAt: number
}

const EXT_LABEL: Record<string, string> = { docx: 'DOCX', xlsx: 'XLSX', pptx: 'PPTX' }

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(ms: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms))
}

async function fetchDocsToken(projectId: string, purpose: 'api' | 'editor', docId?: string) {
  const params = new URLSearchParams({ projectId, purpose })
  if (docId) params.set('docId', docId)
  const response = await apiFetch(`/api/docs/token?${params.toString()}`)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || '获取文档令牌失败')
  return data.token as string
}

export function ProjectDocsWorkspace({ projectId, resetKey }: { projectId: string; resetKey: number }) {
  const [docs, setDocs] = useState<ProjectDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'create' | 'upload' | null>(null)
  const [newType, setNewType] = useState('docx')
  const [editing, setEditing] = useState<{ doc: ProjectDoc; token: string } | null>(null)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const token = await fetchDocsToken(projectId, 'api')
      const response = await fetch(`${DOCS_API}/api/docs?projectId=${encodeURIComponent(projectId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      setDocs(Array.isArray(data.docs) ? data.docs : [])
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取文档列表失败')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setEditing(null)
  }, [resetKey])

  async function openDoc(doc: ProjectDoc) {
    setError('')
    try {
      const token = await fetchDocsToken(projectId, 'editor', doc.id)
      setEditing({ doc, token })
    } catch (err) {
      setError(err instanceof Error ? err.message : '打开文档失败')
    }
  }

  async function downloadDoc(doc: ProjectDoc) {
    try {
      const token = await fetchDocsToken(projectId, 'editor', doc.id)
      window.location.href = `${DOCS_API}/files/${doc.id}.${doc.ext}?download=1&token=${encodeURIComponent(token)}`
    } catch (err) {
      setError(err instanceof Error ? err.message : '下载失败')
    }
  }

  async function createDoc() {
    if (busy) return
    setBusy('create')
    setError('')
    try {
      const token = await fetchDocsToken(projectId, 'api')
      const response = await fetch(
        `${DOCS_API}/api/docs/new?type=${encodeURIComponent(newType)}&projectId=${encodeURIComponent(projectId)}`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
      )
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '创建失败')
      await load()
      await openDoc(data.doc)
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
    } finally {
      setBusy(null)
    }
  }

  async function uploadFile(file: File) {
    if (busy) return
    setBusy('upload')
    setError('')
    try {
      const token = await fetchDocsToken(projectId, 'api')
      const params = new URLSearchParams({ name: file.name, projectId })
      const response = await fetch(`${DOCS_API}/api/docs?${params.toString()}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: file,
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '上传失败')
      await load()
      await openDoc(data.doc)
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败')
    } finally {
      setBusy(null)
    }
  }

  async function deleteDoc(doc: ProjectDoc) {
    if (!window.confirm(`确定删除「${doc.name}」？`)) return
    try {
      const token = await fetchDocsToken(projectId, 'api')
      const response = await fetch(`${DOCS_API}/api/docs/${doc.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error('删除失败')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    }
  }

  if (editing) {
    return (
      <div className="absolute inset-0 z-20 overflow-hidden bg-popover">
        <iframe
          key={`${editing.doc.id}-${editing.token}`}
          src={`${DOCS_API}/docs/${editing.doc.id}?embed=1&token=${encodeURIComponent(editing.token)}`}
          title={editing.doc.name}
          allow="clipboard-read; clipboard-write"
          className="h-full w-full"
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <span className="flex-shrink-0 rounded-md bg-foreground/5 p-1.5 dark:bg-foreground/10">
            <FileText className="h-4 w-4 text-primary" />
          </span>
          文档
          <span className="text-sm font-normal text-muted-foreground">{docs.length}</span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={newType}
            onChange={(event) => setNewType(event.target.value)}
            aria-label="新建文件类型"
            className="h-9 rounded-md border border-border bg-background px-2 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="docx">文档</option>
            <option value="xlsx">表格</option>
            <option value="pptx">演示</option>
          </select>
          <Button variant="outline" size="sm" onClick={() => void createDoc()} disabled={busy !== null} className="gap-1.5">
            {busy === 'create' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            新建
          </Button>
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={busy !== null} className="gap-1.5">
            {busy === 'upload' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            上传文件
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".docx,.xlsx,.pptx"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void uploadFile(file)
            }}
          />
        </div>
      </div>

      {error ? (
        <div className="mb-3 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载中…
        </div>
      ) : docs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-16 text-center">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">还没有文档</p>
          <p className="mt-1 text-sm text-muted-foreground">上传一个 Office 文件，或直接新建。</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {docs.map((doc) => (
            <div key={doc.id} className="group relative">
              <button
                type="button"
                data-doc-card={doc.id}
                onClick={() => void openDoc(doc)}
                className="block w-full rounded-lg border border-border/70 bg-card p-2.5 text-left shadow-elevation-md transition-colors hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex aspect-[16/9] items-center justify-center rounded-md bg-muted/40">
                  <div className="text-center">
                    <FileText className="mx-auto h-6 w-6 text-muted-foreground" />
                    <span className="mt-1 block text-[10px] font-semibold tracking-wide text-muted-foreground">
                      {EXT_LABEL[doc.ext] ?? doc.ext.toUpperCase()}
                    </span>
                  </div>
                </div>
                <div className="mt-2.5 min-w-0 px-0.5">
                  <div className="truncate text-[13px] font-medium">{doc.name}</div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {formatTime(doc.updatedAt)} · {formatSize(doc.size)}
                  </div>
                </div>
              </button>
              <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <button
                  type="button"
                  aria-label={`下载 ${doc.name}`}
                  onClick={() => void downloadDoc(doc)}
                  className="grid h-7 w-7 place-items-center rounded bg-background/90 text-muted-foreground shadow-sm hover:text-foreground"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`删除 ${doc.name}`}
                  onClick={() => void deleteDoc(doc)}
                  className="grid h-7 w-7 place-items-center rounded bg-background/90 text-muted-foreground shadow-sm hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
