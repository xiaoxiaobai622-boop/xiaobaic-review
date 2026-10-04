'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Trash2, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InitialsAvatar } from '@/components/InitialsAvatar'
import { ProjectOverlay } from '@/components/ProjectOverlay'
import { appAlert, appConfirm } from '@/components/AppDialogProvider'
import { apiDelete, apiFetch, apiPost } from '@/lib/api-client'

/**
 * 「这行的人是凭什么进来的」——三句不同的话，撤的权限只给第三种：
 * 角色与团队范围那两种，删掉授权行也不会让人出去，所以那两枚按钮只会被禁用（对标那面靠
 * 一条「设为受限」开关说的话，本站没有那一列，只能把这三种由来写在每一行脸上）。
 */
type MemberSource = 'teamAdmin' | 'allProjects' | 'assigned'

interface MemberRow {
  id: string
  name: string | null
  avatarUrl: string | null
  email: string | null
  phone: string | null
  source: MemberSource
  canRemove: boolean
}

interface CandidateRow {
  id: string
  name: string | null
  avatarUrl: string | null
  email: string | null
  phone: string | null
}

interface ProjectMembersPanelProps {
  projectId: string
  /** 窗头那句要念项目名：页面已经握着它，不必再取一遍详情接口。 */
  projectTitle: string
  onClose: () => void
  /** 名单一变就通知页面重取项目详情：身份块那行人数与这扇窗不许各说各话。 */
  onMembersChange: () => void
}

export function ProjectMembersPanel({ projectId, projectTitle, onClose, onMembersChange }: ProjectMembersPanelProps) {
  const t = useTranslations('projects')
  const tc = useTranslations('common')
  const [members, setMembers] = useState<MemberRow[] | null>(null)
  const [candidates, setCandidates] = useState<CandidateRow[]>([])
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const response = await apiFetch(`/api/projects/${projectId}/members`)
      if (!response.ok) throw new Error(`members ${response.status}`)
      const data = await response.json()
      setMembers(data.members ?? [])
      setCandidates(data.candidates ?? [])
      setCanManage(Boolean(data.canManage))
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    load()
  }, [load])

  // 写完就地重取这一份名单，再让页面重取项目详情：两处读数都从接口来，界面不自己算。
  const refresh = useCallback(async () => {
    await load()
    onMembersChange()
  }, [load, onMembersChange])

  const filteredCandidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return candidates
    return candidates.filter((row) => [row.name, row.phone, row.email].some((v) => typeof v === 'string' && v.toLowerCase().includes(q)))
  }, [candidates, query])

  const addCandidate = async (candidate: CandidateRow) => {
    if (busyId) return
    setBusyId(candidate.id)
    try {
      await apiPost(`/api/projects/${projectId}/members`, { userId: candidate.id })
      await refresh()
      setNotice(t('projectMembersAdded', { name: candidate.name || tc('none') }))
    } catch {
      await appAlert({ message: tc('errorTryAgain'), tone: 'error' })
    } finally {
      setBusyId(null)
    }
  }

  const removeMember = async (member: MemberRow) => {
    if (busyId) return
    const name = member.name || tc('none')
    const ok = await appConfirm({
      message: t('projectMembersRemoveConfirm', { name }),
      confirmLabel: tc('remove'),
      cancelLabel: tc('cancel'),
      tone: 'destructive',
    })
    if (!ok) return

    setBusyId(member.id)
    try {
      await apiDelete(`/api/projects/${projectId}/members/${member.id}`)
      await refresh()
      setNotice(t('projectMembersRemoved', { name }))
    } catch {
      await appAlert({ message: tc('errorTryAgain'), tone: 'error' })
    } finally {
      setBusyId(null)
    }
  }

  const contactOf = (row: { phone: string | null; email: string | null }) =>
    [row.phone, row.email].filter(Boolean).join(' · ')

  const firstLoad = loading && members === null
  const count = members?.length ?? 0

  return (
    <ProjectOverlay
      tutorial="project-members"
      title={t('projectMembersTitle', { title: projectTitle })}
      subtitle={members ? t('projectMemberCount', { count }) : undefined}
      onClose={onClose}
      width={560}
    >
      <div className="px-3 py-3 sm:px-4 lg:px-6">
        {firstLoad ? (
          <p className="py-6 text-[14px] text-muted-foreground">{tc('loading')}</p>
        ) : failed && !members ? (
          <div className="flex items-center gap-3 py-6">
            <p className="text-[14px] text-muted-foreground">{tc('errorTryAgain')}</p>
            <Button variant="outline" size="sm" onClick={load}>{tc('retry')}</Button>
          </div>
        ) : (
          <>
            <section aria-label={t('projectMembersSection')}>
              <h3 className="text-[12px] font-medium text-muted-foreground">{t('projectMembersSection')}</h3>
              <ul className="mt-1 divide-y divide-border">
                {(members ?? []).map((member) => {
                  const contact = contactOf(member)
                  return (
                    <li key={member.id} data-tutorial="project-member-row" className="flex items-center gap-[10px] py-[7px]">
                      <span className="shrink-0">
                        <InitialsAvatar name={member.name} src={member.avatarUrl} size="sm" isInternal />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium text-foreground">{member.name || tc('none')}</span>
                        {contact ? (
                          <span data-tutorial="project-member-contact" className="block truncate text-[12px] text-muted-foreground">{contact}</span>
                        ) : null}
                      </span>
                      <span data-tutorial="project-member-source" className="shrink-0 text-[12px] text-muted-foreground">
                        {member.source === 'teamAdmin'
                          ? t('projectMembersSourceAdmin')
                          : member.source === 'allProjects'
                            ? t('projectMembersSourceAllProjects')
                            : t('projectMembersSourceAssigned')}
                      </span>
                      {/* 只有第三种由来撤得动：撤掉授权行才是真的把门关上。前两种给 disabled＋原因，
                          而不是藏起来——藏起来会让人以为这些人不该在名单上。 */}
                      {canManage ? (
                        <button
                          type="button"
                          data-tutorial="project-member-remove"
                          onClick={() => removeMember(member)}
                          disabled={!member.canRemove || busyId !== null}
                          title={member.canRemove ? undefined : t('projectMembersRemoveBlockedHint')}
                          aria-label={tc('remove')}
                          className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent [&_svg]:h-4 [&_svg]:w-4"
                        >
                          <Trash2 aria-hidden="true" />
                        </button>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
              {notice ? <p className="py-[6px] text-[12px] text-muted-foreground">{notice}</p> : null}
            </section>

            {canManage ? (
              <section className="mt-3 border-t border-border pt-3" aria-label={t('projectMembersAddSection')}>
                <h3 className="text-[12px] font-medium text-muted-foreground">{t('projectMembersAddSection')}</h3>
                <Input
                  data-tutorial="project-members-search"
                  className="mt-2"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('projectMembersSearchPlaceholder')}
                  aria-label={t('projectMembersSearchPlaceholder')}
                />
                {filteredCandidates.length > 0 ? (
                  <ul className="mt-1 divide-y divide-border">
                    {filteredCandidates.map((candidate) => {
                      const contact = contactOf(candidate)
                      return (
                        <li key={candidate.id} className="flex items-center gap-[10px] py-[7px]">
                          <span className="shrink-0">
                            <InitialsAvatar name={candidate.name} src={candidate.avatarUrl} size="sm" isInternal />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-medium text-foreground">{candidate.name || tc('none')}</span>
                            {contact ? <span className="block truncate text-[12px] text-muted-foreground">{contact}</span> : null}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            data-tutorial="project-member-add"
                            onClick={() => addCandidate(candidate)}
                            disabled={busyId !== null}
                          >
                            <UserPlus />
                            {tc('add')}
                          </Button>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p data-tutorial="project-members-empty" className="py-3 text-[12px] text-muted-foreground">
                    {candidates.length === 0 ? t('projectMembersAllAdded') : t('projectMembersNoCandidates')}
                  </p>
                )}
              </section>
            ) : null}
          </>
        )}
      </div>
    </ProjectOverlay>
  )
}
