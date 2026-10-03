'use client'

import { useParams } from 'next/navigation'
import { ProjectSettingsPanel } from '@/components/ProjectSettingsPanel'

/**
 * 这条路由只剩一层壳：内容全在 ProjectSettingsPanel 那一份里（项目页浮的是同一个组件）。
 * 留着是因为别人存过书签、也从通知里跳进来，直链不能死。
 */
export default function ProjectSettingsPage() {
  const projectId = useParams()?.id as string
  return <ProjectSettingsPanel projectId={projectId} variant="page" />
}
