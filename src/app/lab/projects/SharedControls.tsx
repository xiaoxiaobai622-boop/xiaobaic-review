'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { PasswordInput } from '@/components/ui/password-input'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { appNotice, appPrompt } from '@/components/AppDialogProvider'
import CommentInput from '@/components/CommentInput'

export default function SharedControls() {
  const [disabled, setDisabled] = useState(false)
  const [result, setResult] = useState('')
  const [notice, setNotice] = useState(0)
  const [comment, setComment] = useState('这一条批注故意写得很长，用来检查输入框最后一行文字会不会被底部的表情、时间码和发送按钮挡住视线。'.repeat(2))
  return (
    <main data-shared-controls className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto flex max-w-lg flex-col gap-5">
        <h1 className="text-xl font-semibold">共用控件 · 本地样本</h1>
        <p className="text-sm text-muted-foreground">仅验证真实控件，不保存数据或发送请求。</p>
        <label className="flex items-center gap-2 text-sm"><Switch checked={disabled} onCheckedChange={setDisabled} />禁用样本控件</label>
        <label className="grid gap-2 text-sm">样本名称<Input placeholder="输入名称" disabled={disabled} /></label>
        <label className="grid gap-2 text-sm">样本密码<PasswordInput defaultValue="local-sample" disabled={disabled} /></label>
        <label className="grid gap-2 text-sm">样本描述<Textarea placeholder="输入描述" disabled={disabled} /></label>
        <Select defaultValue="review" disabled={disabled}>
          <SelectTrigger aria-label="样本状态"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="review">审阅中</SelectItem>
            <SelectItem value="locked" disabled>暂不可用</SelectItem>
            <SelectItem value="complete">已完成</SelectItem>
            <SelectItem value="long">很长的样本名称，用来检查窄屏内容是否仍能完整显示且不会超出屏幕边界</SelectItem>
          </SelectContent>
        </Select>
        <Dialog>
          <DialogTrigger asChild><Button data-control-dialog-trigger disabled={disabled}>打开样本弹窗</Button></DialogTrigger>
          <DialogContent data-control-dialog>
            <DialogTitle>样本弹窗</DialogTitle>
            <DialogDescription>验证展开关闭、键盘焦点与嵌套下拉框。</DialogDescription>
            <Input aria-label="弹窗名称" placeholder="名称" />
            <Select defaultValue="one"><SelectTrigger aria-label="弹窗选项"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="one">第一项</SelectItem><SelectItem value="two">第二项</SelectItem></SelectContent></Select>
            <DialogClose asChild><Button variant="outline">关闭样本弹窗</Button></DialogClose>
          </DialogContent>
        </Dialog>
        <TooltipProvider delayDuration={0}>
          <Tooltip><TooltipTrigger asChild><Button variant="outline" disabled={disabled}>查看提示</Button></TooltipTrigger><TooltipContent>样本提示文字</TooltipContent></Tooltip>
        </TooltipProvider>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => { appNotice({ message: `样本消息 ${notice + 1}`, tone: 'success' }); setNotice(notice + 1) }}>显示消息</Button>
          <Button variant="outline" onClick={async () => { const value = await appPrompt({ title: '样本输入', message: '只在此页显示结果', required: true, inputLabel: '名称' }); setResult(value === null ? '已取消' : value) }}>必填输入</Button>
        </div>
        <section aria-labelledby="composer-sample" className="rounded-lg border border-border bg-card p-3">
          <h2 id="composer-sample" className="mb-2 text-sm font-semibold">批注输入框 · 长文本</h2>
          <CommentInput
            newComment={comment}
            onCommentChange={setComment}
            onSubmit={() => {}}
            loading={false}
            selectedTimestamp={null}
            selectedVideoFps={25}
            replyingToComment={null}
            onCancelReply={() => {}}
            currentVideoRestricted={false}
            commentsDisabled={false}
            showCategoryPicker={false}
            visibility="PUBLIC"
            onVisibilityChange={() => {}}
            sendInsideComposer
          />
        </section>
        <output aria-label="样本结果" className="break-words text-sm">{result}</output>
      </div>
    </main>
  )
}
