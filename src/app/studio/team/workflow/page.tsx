'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, CircleDot, GitBranch, Info } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { apiFetch } from '@/lib/api-client'

const steps = [
  { name: '待审阅', description: '项目已创建，等待团队开始审阅。', status: 'IN_REVIEW' },
  { name: '审阅中', description: '团队成员正在查看视频并提交批注。', status: 'IN_REVIEW' },
  { name: '意见汇总完毕', description: '批注已整理，准备确认最终版本。', status: 'IN_REVIEW' },
  { name: '通过', description: '项目已完成审阅，可进入交付。', status: 'APPROVED' },
]

export default function TeamWorkflowPage() {
  const [projects, setProjects] = useState<Array<{ status: string }>>([])
  useEffect(() => { apiFetch('/api/projects').then(async (response) => { if (response.ok) setProjects((await response.json()).projects || []) }) }, [])
  const approved = useMemo(() => projects.filter((project) => project.status === 'APPROVED').length, [projects])
  return <div className="space-y-5"><div><h1 className="text-2xl font-semibold tracking-normal">流程管理</h1><p className="mt-1 text-sm text-muted-foreground">统一团队项目的审阅阶段和交付节奏。</p></div><Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><GitBranch className="h-4 w-4 text-primary" />默认审阅流程</CardTitle></CardHeader><CardContent><div className="space-y-0">{steps.map((step, index) => <div key={step.name} className="relative flex gap-4 pb-7 last:pb-0"><div className="relative flex w-8 shrink-0 justify-center"><span className={`z-10 flex h-8 w-8 items-center justify-center rounded-full border ${index === steps.length - 1 ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600' : 'border-primary/30 bg-primary-visible text-primary'}`}>{index === steps.length - 1 ? <Check className="h-4 w-4" /> : <CircleDot className="h-4 w-4" />}</span>{index < steps.length - 1 && <span className="absolute top-8 h-full w-px bg-border" aria-hidden="true" />}</div><div className="pt-1"><p className="text-sm font-medium">{step.name}</p><p className="mt-1 text-xs text-muted-foreground">{step.description}</p></div></div>)}</div></CardContent></Card><Card><CardHeader><CardTitle className="text-base">流程说明</CardTitle></CardHeader><CardContent><div className="flex gap-3 rounded-lg border border-border bg-muted/30 p-4"><Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p className="text-sm leading-6 text-muted-foreground">这是当前团队的新建项目默认流程。项目状态会在项目管理和审阅页面中同步显示；已通过项目：<span className="font-medium text-foreground">{approved}</span> 个。</p></div></CardContent></Card></div>
}
