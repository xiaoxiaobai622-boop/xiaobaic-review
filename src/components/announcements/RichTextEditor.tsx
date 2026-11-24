'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import {
  Bold,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Pilcrow,
  Quote,
  Redo2,
  Undo2,
} from 'lucide-react'
import { appNotice, appPrompt } from '@/components/AppDialogProvider'
import { ANNOUNCEMENT_IMAGE_ACCEPT, ANNOUNCEMENT_IMAGE_ACCEPT_LABEL, ANNOUNCEMENT_IMAGE_MAX_LABEL } from '@/lib/announcements/image'
import { ANNOUNCEMENT_CONTENT_MAX } from '@/lib/announcements/constants'
import { isSafeAnnouncementUrl } from '@/lib/announcements/url'
import { uploadAnnouncementImage } from '@/lib/announcements/upload-client'
import { cn } from '@/lib/utils'
import styles from './rich-text.module.css'

function ToolButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  )
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export default function RichTextEditor({
  initialHtml,
  onChange,
  disabled = false,
}: {
  initialHtml: string
  onChange: (html: string, plainText: string) => void
  disabled?: boolean
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
        },
      }),
      Image.configure({ inline: false, allowBase64: false }),
    ],
    content: initialHtml,
    editorProps: {
      attributes: {
        class: cn(styles.body, styles.editor),
        'aria-label': '新增功能正文',
        'data-rich-text-editable': 'true',
      },
    },
    onUpdate: ({ editor: current }) => {
      const plainText = current.getText().replace(/\s+/g, ' ').trim().slice(0, ANNOUNCEMENT_CONTENT_MAX)
      onChange(current.getHTML(), plainText)
    },
  })

  useEffect(() => {
    if (editor) editor.setEditable(!disabled)
  }, [disabled, editor])

  const run = (command: (instance: NonNullable<typeof editor>) => void) => {
    if (!editor || disabled) return
    command(editor)
  }

  const insertLink = async () => {
    if (!editor || disabled) return
    const value = await appPrompt({
      title: '插入链接',
      message: '输入 http/https 或站内 / 开头的路径',
      defaultValue: 'https://',
      inputLabel: '链接地址',
      confirmLabel: '插入',
      cancelLabel: '取消',
      required: true,
    })
    if (!value) return
    const url = value.trim()
    if (!isSafeAnnouncementUrl(url)) {
      appNotice({ tone: 'error', message: '链接只允许 http/https 或站内相对路径' })
      return
    }
    if (editor.state.selection.empty) {
      editor.chain().focus().insertContent(`<a href="${htmlEscape(url)}">${htmlEscape(url)}</a>`).run()
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
    }
  }

  const chooseInlineImage = () => {
    if (!editor || disabled || uploading) return
    fileRef.current?.click()
  }

  const uploadInlineImage = async (file: File | undefined) => {
    if (!file || !editor || disabled) return
    setError(null)
    setUploading(true)
    try {
      const url = await uploadAnnouncementImage(file)
      editor.chain().focus().setImage({ src: url }).run()
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '正文图片上传失败，请稍后重试')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const toolbarDisabled = disabled || !editor

  return (
    <div data-rich-text-editor className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/25 px-1.5 py-1">
        <ToolButton label="小标题" disabled={toolbarDisabled} onClick={() => run((ed) => { ed.chain().focus().toggleHeading({ level: 2 }).run() })}><Heading2 className="h-4 w-4" aria-hidden /></ToolButton>
        <ToolButton label="三级标题" disabled={toolbarDisabled} onClick={() => run((ed) => { ed.chain().focus().toggleHeading({ level: 3 }).run() })}><Heading3 className="h-4 w-4" aria-hidden /></ToolButton>
        <ToolButton label="正文段落" disabled={toolbarDisabled} onClick={() => run((ed) => { ed.chain().focus().setParagraph().run() })}><Pilcrow className="h-4 w-4" aria-hidden /></ToolButton>
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <ToolButton label="加粗" disabled={toolbarDisabled} onClick={() => run((ed) => { ed.chain().focus().toggleBold().run() })}><Bold className="h-4 w-4" aria-hidden /></ToolButton>
        <ToolButton label="斜体" disabled={toolbarDisabled} onClick={() => run((ed) => { ed.chain().focus().toggleItalic().run() })}><Italic className="h-4 w-4" aria-hidden /></ToolButton>
        <ToolButton label="无序列表" disabled={toolbarDisabled} onClick={() => run((ed) => { ed.chain().focus().toggleBulletList().run() })}><List className="h-4 w-4" aria-hidden /></ToolButton>
        <ToolButton label="有序列表" disabled={toolbarDisabled} onClick={() => run((ed) => { ed.chain().focus().toggleOrderedList().run() })}><ListOrdered className="h-4 w-4" aria-hidden /></ToolButton>
        <ToolButton label="引用" disabled={toolbarDisabled} onClick={() => run((ed) => { ed.chain().focus().toggleBlockquote().run() })}><Quote className="h-4 w-4" aria-hidden /></ToolButton>
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <ToolButton label="插入链接" disabled={toolbarDisabled} onClick={() => void insertLink()}><Link2 className="h-4 w-4" aria-hidden /></ToolButton>
        <ToolButton label="上传正文图片" disabled={toolbarDisabled || uploading} onClick={chooseInlineImage}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ImagePlus className="h-4 w-4" aria-hidden />}
        </ToolButton>
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <ToolButton label="撤销" disabled={toolbarDisabled} onClick={() => run((ed) => { ed.chain().focus().undo().run() })}><Undo2 className="h-4 w-4" aria-hidden /></ToolButton>
        <ToolButton label="重做" disabled={toolbarDisabled} onClick={() => run((ed) => { ed.chain().focus().redo().run() })}><Redo2 className="h-4 w-4" aria-hidden /></ToolButton>
        <span className="ml-auto hidden text-[10px] text-muted-foreground sm:inline">
          {ANNOUNCEMENT_IMAGE_ACCEPT_LABEL} · 正文图片最大 {ANNOUNCEMENT_IMAGE_MAX_LABEL}
        </span>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={ANNOUNCEMENT_IMAGE_ACCEPT}
        aria-label="上传正文图片"
        className="sr-only"
        disabled={disabled || uploading}
        onChange={(event) => void uploadInlineImage(event.target.files?.[0])}
      />

      <div className="relative">
        <EditorContent editor={editor} />
        {editor?.isEmpty ? (
          <span className="pointer-events-none absolute left-4 top-3 text-sm text-muted-foreground" aria-hidden>
            写正文：小标题、加粗、列表、引用、链接和图片…
          </span>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="border-t border-destructive/30 bg-destructive-visible px-3 py-1.5 text-[11px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}