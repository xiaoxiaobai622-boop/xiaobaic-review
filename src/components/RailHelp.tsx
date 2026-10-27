'use client'

import { useState } from 'react'
import { BookOpen, CircleHelp, ExternalLink, MessageCircle } from 'lucide-react'
import RailPanel from '@/components/RailPanel'
import { cn } from '@/lib/utils'

const HELP_DOC_URL = 'https://scnqe74t5owc.feishu.cn/wiki/UOxownMcRiBLeekZwcEc3BBAnc2?from=from_copylink'

/**
 * 窄栏那枚「?」：以前是个外链，点了直接新开飞书；现在开一块栏面，里面两件事——
 * 帮助文档（还是那份飞书 wiki，只是从入口挪进来）和联系客服（客服微信码）。
 */
export default function RailHelp({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)

  return (
    <RailPanel
      name="help"
      label="帮助"
      closeLabel="关闭帮助"
      open={open}
      onOpenChange={setOpen}
      trigger={(
        <button
          type="button"
          aria-label="帮助"
          title="帮助"
          className={cn(
            className,
            open ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-accent-foreground',
          )}
        >
          <CircleHelp className="h-[20px] w-[20px]" aria-hidden="true" />
        </button>
      )}
    >
      <div className="flex-1 overflow-y-auto">
        <a
          data-rail-help-doc
          href={HELP_DOC_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-start gap-3 border-t border-border px-3 py-3 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
        >
          <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              帮助文档
              <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
              上传、批注、分享与团队设置的使用说明
            </span>
          </span>
        </a>

        <section data-rail-help-support className="border-t border-border px-3 py-3">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <MessageCircle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            联系客服
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">扫码添加客服微信</p>
          {/* 原图 888×1128，面板里按宽度铺满：二维码本身在 2x 屏上也够清楚，不另做裁切。 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/support/wechat-support.jpg"
            width={888}
            height={1128}
            alt="客服微信二维码"
            className="mt-3 w-full rounded-lg border border-border"
          />
        </section>
      </div>
    </RailPanel>
  )
}
